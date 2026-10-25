import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { TooltipProvider } from 'nom-ui'
import { ZNN_ZTS, settlement } from 'znn-typescript-sdk'
import { parseInterface } from 'zeno-client'
import { useSettings } from '@/core'
import { serveCommand } from '@/core/local-runner'
import DryRunPanel from './DryRunPanel.vue'

const fixture = (name: string) => readFileSync(join(__dirname, '../../test/fixtures', name))
const vault = () => parseInterface(JSON.parse(fixture('vault.interface.json').toString('utf8')))
const MODULE = Uint8Array.from(fixture('vault.wasm'))
const ZNN_ASSET = settlement.assetIdFromZts(ZNN_ZTS).toString()
const CONTRACT = 'ab'.repeat(32)

// SHA3-256 of the event name and canonical encodings, computed independently of zeno-client.
const DEPOSITED_TOPIC = 'c051ad8548248b8eb443710f48ac39cd1fa8bc890227edc63abb664fe1ddb6f9'
const DEPOSITED_1000_DATA = '00000000000000000000000000000000000000000000000000000000000003e8'

const receipt = (over: Record<string, unknown> = {}) => ({
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
const ok = (r: unknown, extra: Record<string, unknown> = {}) => ({ ok: true, receipt: r, ...extra })

function render(props: Record<string, unknown> = {}) {
  const wrapper = mount({
    render: () =>
      h(TooltipProvider, null, () =>
        h(DryRunPanel, { moduleBytes: MODULE, iface: vault(), ...props } as never)
      ),
  })
  return wrapper
}

const click = async (w: ReturnType<typeof mount>, label: string) => {
  const button = w.findAll('button').find((b) => b.text() === label)
  if (!button) throw new Error(`no ${label} button`)
  await button.trigger('click')
  await flushPromises()
}

describe('DryRunPanel', () => {
  beforeEach(async () => {
    await useSettings().reset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the start command when the runner does not answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
    )
    const w = render()
    await click(w, 'Run')
    expect(w.text()).toContain('zeno-exec is not answering')
    expect(w.find('pre').text()).toBe(serveCommand(window.location.origin, useSettings().settings.value.localRunnerUrl))
  })

  it('adds --listen to the start command for a runner URL on another local port', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
    )
    await useSettings().update({ localRunnerUrl: 'http://127.0.0.1:9000' })
    const w = render()
    await click(w, 'Run')
    expect(w.find('pre').text()).toContain('--listen 127.0.0.1:9000')
  })

  it('shows the allow-origin flag when the console runs on a LAN origin', async () => {
    const happy = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM
    const original = window.location.href
    happy.setURL('http://192.168.1.5:5173/deploy')
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
      )
      const w = render()
      await click(w, 'Run')
      expect(w.find('pre').text()).toBe('zeno-exec serve --allow-origin http://192.168.1.5:5173')
    } finally {
      happy.setURL(original)
    }
  })

  it('shows a step problem only after the first run attempt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const w = render()
    await click(w, 'Add deposit')
    expect(w.text()).not.toContain('Enter the deposit in base units')
    await click(w, 'Run')
    expect(w.text()).toContain('Enter the deposit in base units')
  })

  it('gives each call step its own argument ids', async () => {
    const w = render()
    await click(w, 'Add call')
    await click(w, 'Add call')
    const ids = w.findAll('[id$="-arg-asset"]').map((e) => e.attributes('id'))
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('offers the withdraw arguments for a call and the asset id for a deposit', async () => {
    const w = render()
    await click(w, 'Add call')
    expect(w.text()).toContain('withdraw')
    expect(w.text()).toContain('l1_recipient')
    await click(w, 'Add deposit')
    expect(w.text()).toContain(ZNN_ASSET)
  })

  it('shows each row of a successful run with its status and the decoded event', async () => {
    const deposited = {
      contractId: CONTRACT,
      inputIndex: 2,
      eventIndex: 0,
      topics: [DEPOSITED_TOPIC, 'aa'.repeat(32), 'bb'.repeat(32)],
      data: DEPOSITED_1000_DATA,
    }
    const deploy = ok(receipt(), { contractId: CONTRACT })
    const answers = [[deploy], [deploy, ok(receipt()), ok(receipt({ events: [deposited] }))]]
    let posts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/v1/version')
          ? new Response(
              JSON.stringify({ version: '1.0.0', revision: 'abcdef0123456789', modified: false })
            )
          : new Response(JSON.stringify({ results: answers[posts++] }))
      )
    )
    const w = render()
    await click(w, 'Add deposit')
    await w.find('#step-1-amount').setValue('1000')
    await click(w, 'Run')
    await vi.waitFor(() => expect(w.text()).toContain('Deposited'))
    expect(w.text()).toContain('Deploy')
    expect(w.text()).toContain('Buy 65536 bytes of storage')
    expect(w.text()).toContain('Deposit')
    expect(w.text()).toContain('SUCCESS')
    expect(w.text()).toContain('zeno-exec 1.0.0 (abcdef012345)')
  })
})
