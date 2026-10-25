import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { Address, ZNN_ZTS, settlement } from 'znn-typescript-sdk'
import { parseInterface } from 'zeno-client'
import type { ContractInterface } from 'zeno-client'
import { useSettings } from './useSettings'
import type { RunnerReceipt } from '../local-runner'
import { DRY_RUN_SENDER, useDryRun } from './useDryRun'

const fixture = (name: string) => readFileSync(join(__dirname, '../../../test/fixtures', name))
const vault = () => parseInterface(JSON.parse(fixture('vault.interface.json').toString('utf8')))
const MODULE = Uint8Array.from(fixture('vault.wasm'))
const CONTRACT = 'ab'.repeat(32)
const RECIPIENT = 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'
const ZNN_ASSET = settlement.assetIdFromZts(ZNN_ZTS).toString()

// SHA3-256 of the event name and canonical encodings, computed independently of zeno-client.
const DEPOSITED_TOPIC = 'c051ad8548248b8eb443710f48ac39cd1fa8bc890227edc63abb664fe1ddb6f9'
const WITHDRAW_SELECTOR = '24b2e5fc'
const DEPOSITED_1000_DATA = '00000000000000000000000000000000000000000000000000000000000003e8'
const INSUFFICIENT_BALANCE_REVERT =
  '11'.repeat(32) +
  '0000000000000000000000000000000000000000000000000000000000000005' +
  '0000000000000000000000000000000000000000000000000000000000000003'

const receipt = (over: Partial<RunnerReceipt> = {}): RunnerReceipt => ({
  status: 'SUCCESS',
  gasUsed: 100,
  abortCode: 0,
  contractId: CONTRACT,
  codeHash: '22'.repeat(32),
  returnData: '',
  events: [],
  outbox: [],
  stateDiff: [],
  claimedDeposit: '0',
  ...over,
})
const ok = (r: RunnerReceipt, extra: Record<string, unknown> = {}) => ({
  ok: true,
  receipt: r,
  ...extra,
})
const deployOk = ok(receipt(), { contractId: CONTRACT })

type Post = { commands: Record<string, unknown>[] }

/** Answers the version call, then each POST from `answers` in order. */
function stubRunner(answers: unknown[][] | Promise<unknown[]>[]) {
  const posts: Post[] = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/version')) {
      return new Response(
        JSON.stringify({ version: '1.0.0', revision: 'abcdef0123456789', modified: false })
      )
    }
    posts.push(JSON.parse(init?.body as string))
    const answer = await answers[posts.length - 1]
    return new Response(JSON.stringify({ results: answer }))
  })
  vi.stubGlobal('fetch', fn)
  return { posts, fn }
}

function make(iface: ContractInterface | null = vault()) {
  const bytes = shallowRef<Uint8Array | null>(MODULE)
  const ifc = shallowRef<ContractInterface | null>(iface)
  return { bytes, ifc, run: useDryRun(bytes, ifc) }
}

describe('useDryRun', () => {
  beforeEach(async () => {
    await useSettings().reset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sends the deploy, the storage purchase, the deposit and the call', async () => {
    const { posts } = stubRunner([
      [deployOk],
      [deployOk, ok(receipt()), ok(receipt()), ok(receipt())],
    ])
    const { run } = make()
    run.addStep('deposit')
    run.steps.value[0].amount = '1000'
    run.addStep('call')
    run.selectMethod(run.steps.value[1].id, 'withdraw')
    run.steps.value[1].argTexts = [ZNN_ASSET, '400', RECIPIENT]
    await run.run()
    expect(run.error.value).toBeNull()
    expect(posts).toHaveLength(2)
    expect(posts[0].commands).toHaveLength(1)
    const [deploy, storage, deposit, call] = posts[1].commands
    expect(deploy).toMatchObject({ op: 'deploy', metadata: 'immutable', sender: DRY_RUN_SENDER })
    expect(deploy.module).toBe(Buffer.from(MODULE).toString('hex'))
    expect(storage).toEqual({
      op: 'buyStorage',
      sender: DRY_RUN_SENDER,
      contractId: CONTRACT,
      bytes: 65536,
    })
    expect(deposit).toEqual({
      op: 'deposit',
      sender: DRY_RUN_SENDER,
      contractId: CONTRACT,
      asset: ZNN_ASSET,
      amount: '1000',
    })
    expect(call).toEqual({
      op: 'call',
      sender: DRY_RUN_SENDER,
      contractId: CONTRACT,
      payload:
        WITHDRAW_SELECTOR +
        ZNN_ASSET +
        BigInt(400).toString(16).padStart(64, '0') +
        Buffer.from(Address.parse(RECIPIENT).getBytes()).toString('hex'),
    })
    expect(run.rows.value.map((r) => r.label)).toEqual([
      'Deploy',
      'Buy 65536 bytes of storage',
      'Deposit',
      'Call withdraw',
    ])
    expect(run.version.value?.version).toBe('1.0.0')
  })

  it('decodes a Deposited event and names a reverted call', async () => {
    const deposited = {
      contractId: CONTRACT,
      inputIndex: 2,
      eventIndex: 0,
      topics: [DEPOSITED_TOPIC, 'aa'.repeat(32), 'bb'.repeat(32)],
      data: DEPOSITED_1000_DATA,
    }
    const reverted = receipt({
      status: 'REVERT',
      abortCode: 1,
      returnData: INSUFFICIENT_BALANCE_REVERT,
    })
    stubRunner([
      [deployOk],
      [deployOk, ok(receipt()), ok(receipt({ events: [deposited] })), ok(reverted)],
    ])
    const { run } = make()
    run.addStep('deposit')
    run.steps.value[0].amount = '1000'
    run.addStep('call')
    run.steps.value[1].argTexts = [ZNN_ASSET, '5', RECIPIENT]
    await run.run()
    expect(run.rows.value[2].details?.events[0].decoded?.name).toBe('Deposited')
    const last = run.rows.value[3].details
    expect(last?.status).toBe('REVERT')
    expect(last?.error?.name).toBe('InsufficientBalance')
    expect(last?.error?.fields).toEqual({
      asset: new Uint8Array(32).fill(0x11),
      requested: 5n,
      available: 3n,
    })
  })

  it('shows only the deploy row when the first deploy fails and sends no second request', async () => {
    const { posts } = stubRunner([
      [ok(receipt({ status: 'ABORT', abortCode: 3 }), { contractId: undefined })],
    ])
    const { run } = make()
    await run.run()
    expect(posts).toHaveLength(1)
    expect(run.rows.value).toHaveLength(1)
    expect(run.rows.value[0].label).toBe('Deploy')
  })

  it('shows a halt result as kind and message', async () => {
    stubRunner([[{ ok: false, error: { kind: 'halt', message: 'the executor stopped' } }]])
    const { run } = make()
    await run.run()
    expect(run.rows.value[0].error).toBe('halt: the executor stopped')
  })

  it('flags an unreachable runner and shows no rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
    )
    const { run } = make()
    await run.run()
    expect(run.unreachable.value).toBe(true)
    expect(run.rows.value).toEqual([])
  })

  it('sends nothing when a step has a bad amount', async () => {
    const { fn } = stubRunner([])
    const { run } = make()
    run.addStep('deposit')
    run.steps.value[0].amount = '0'
    await run.run()
    expect(fn).not.toHaveBeenCalled()
    expect(run.error.value).toBe(
      'Step 1: Enter the deposit in base units, a whole number above zero.'
    )
  })

  it('sends a raw payload in lowercase hex when there is no interface', async () => {
    const { posts } = stubRunner([[deployOk], [deployOk, ok(receipt()), ok(receipt())]])
    const { run } = make(null)
    run.addStep('call')
    run.steps.value[0].payloadHex = '0xAABB'
    await run.run()
    expect(posts[1].commands[2]).toMatchObject({ op: 'call', payload: 'aabb' })
    expect(run.rows.value[2].label).toBe('Call (raw payload)')
  })

  it('drops the results of a run when the interface changes while it is pending', async () => {
    let release!: (value: unknown[]) => void
    const second = new Promise<unknown[]>((resolve) => (release = resolve))
    stubRunner([Promise.resolve([deployOk]), second])
    const { run, ifc } = make()
    const running = run.run()
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(3))
    ifc.value = vault()
    release([deployOk, ok(receipt())])
    await running
    expect(run.rows.value).toEqual([])
  })

  it('sends the steps as validated when they are edited during the run', async () => {
    let release!: (value: unknown[]) => void
    const first = new Promise<unknown[]>((resolve) => (release = resolve))
    const { posts } = stubRunner([first, Promise.resolve([deployOk, ok(receipt()), ok(receipt())])])
    const { run } = make()
    run.addStep('deposit')
    run.steps.value[0].amount = '1000'
    const running = run.run()
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    run.steps.value[0].amount = 'abc'
    release([deployOk])
    await running
    expect(posts[1].commands[2]).toMatchObject({ op: 'deposit', amount: '1000' })
    expect(run.error.value).toBeNull()
  })

  it('encodes the argument texts as validated when a text is edited in place during the run', async () => {
    let release!: (value: unknown[]) => void
    const first = new Promise<unknown[]>((resolve) => (release = resolve))
    const { posts } = stubRunner([first, Promise.resolve([deployOk, ok(receipt()), ok(receipt())])])
    const { run } = make()
    run.addStep('call')
    run.selectMethod(run.steps.value[0].id, 'withdraw')
    run.steps.value[0].argTexts = [ZNN_ASSET, '400', RECIPIENT]
    const running = run.run()
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    run.steps.value[0].argTexts[1] = 'abc'
    release([deployOk])
    await running
    expect(posts[1].commands[2].payload).toContain('0'.repeat(61) + '190')
    expect(run.error.value).toBeNull()
  })

  it('reports a second deploy that answers a different contract id and still shows the rows', async () => {
    const other = ok(receipt(), { contractId: 'cd'.repeat(32) })
    stubRunner([[deployOk], [other, ok(receipt()), ok(receipt())]])
    const { run } = make()
    run.addStep('deposit')
    run.steps.value[0].amount = '1000'
    await run.run()
    expect(run.error.value).toBe('zeno-exec gave a different contract id on the second run.')
    expect(run.rows.value).toHaveLength(3)
  })

  it('reuses no step id after a removal', () => {
    const { run } = make()
    run.addStep('deposit')
    const first = run.steps.value[0].id
    run.removeStep(first)
    run.addStep('deposit')
    expect(run.steps.value[0].id).not.toBe(first)
  })

  it('sends amounts as exact decimal strings without leading zeros', async () => {
    const big = '18446744073709551616'
    const { posts } = stubRunner([
      [deployOk],
      [deployOk, ok(receipt()), ok(receipt()), ok(receipt())],
    ])
    const { run } = make(null)
    run.addStep('deposit')
    run.steps.value[0].amount = `  000${big}  `
    run.addStep('call')
    run.steps.value[1].amount = '0007'
    await run.run()
    expect(run.error.value).toBeNull()
    const [, , deposit, call] = posts[1].commands
    expect(deposit.amount).toBe(big)
    expect(call.deposit).toEqual({ asset: ZNN_ASSET, amount: '7' })
  })

  it('sends no deposit member for a call whose amount is empty or zero', async () => {
    const { posts } = stubRunner([
      [deployOk],
      [deployOk, ok(receipt()), ok(receipt()), ok(receipt())],
    ])
    const { run } = make(null)
    run.addStep('call')
    run.addStep('call')
    run.steps.value[1].amount = '0'
    await run.run()
    const [, , empty, zero] = posts[1].commands
    expect(empty).not.toHaveProperty('deposit')
    expect(zero).not.toHaveProperty('deposit')
  })
})
