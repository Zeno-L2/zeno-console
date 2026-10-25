import { beforeAll, describe, expect, it } from 'vitest'
import { GatewayVerificationError, NotFoundError, ResponseSizeError } from 'zeno-client'
import type { ReceiptResult } from 'zeno-client'
import { Hash, SETTLEMENT_ADDRESS, SettlementContract, TokenStandard, Zenon } from 'znn-typescript-sdk'
import { SettlementWriteService } from './settlement-write-service'
import {
  MissingSendError,
  NODE_BEHIND_LIMIT_MS,
  NodeReadError,
  TxTrackerService,
  bindingsChecked,
  createsDomainInput,
  fieldsChecked,
  isRefusedStatus,
} from './tx-tracker-service'
import type { ReceiptCheck, TrackState, TrackerDeps } from './tx-tracker-service'

const HASH = 'ab'.repeat(32)
const receipt = (tag: ReceiptResult['tag']) => ({ tag, sendHash: HASH, domainId: 1, batchId: 0, receipt: { status: 'SUCCESS' } }) as unknown as ReceiptResult

interface Rig {
  tracker: TxTrackerService
  state: {
    block: { received: boolean; refused?: boolean; confirmedAt?: number; createsInput?: boolean } | null
    blockError?: Error
    receipt: ReceiptResult | Error
    pushed: (() => void)[]
    sleeps: number
    receiptReads: number
    gatewayDown: boolean
    verifyCalls: ReceiptResult[]
    /** The next `client()` call returns a new client object, like a reconnect. */
    reconnect: () => void
    verify: (sendHash: string, receipt: ReceiptResult) => Promise<boolean>
    now: number
  }
}

function rig(onSleep?: (n: number, state: Rig['state']) => void): Rig {
  const state: Rig['state'] = { block: null, receipt: new NotFoundError('not found', -32004), pushed: [], sleeps: 0, receiptReads: 0,
    gatewayDown: false,
    verifyCalls: [],
    reconnect: () => {
      current = null
    },
    verify: async (_h, r) => r.tag !== 'pending',
    now: 0,
  }
  let current: object | null = null
  const deps: TrackerDeps = {
    ledger: {
      getSend: async () => {
        if (state.blockError) throw state.blockError
        return state.block && { createsInput: true, ...state.block }
      },
    },
    gateway: {
      client: async () => {
        if (state.gatewayDown) throw new Error('gateway unreachable')
        current ??= {
          getReceipt: async () => {
            state.receiptReads++
            if (state.receipt instanceof Error) throw state.receipt
            return state.receipt
          },
          verifyReceipt: async (hash: string, r: ReceiptResult) => {
            state.verifyCalls.push(r)
            return state.verify(hash, r)
          },
          subscribe: async (_kind: string, _params: unknown[], handler: () => void) => {
            state.pushed.push(handler)
            return async () => undefined
          },
        }
        return current as never
      },
    },
    // A real macrotask turn, so a loop that polls cannot starve the test.
    sleep: async () => {
      state.sleeps++
      onSleep?.(state.sleeps, state)
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    pollIntervalMs: 1,
    now: () => state.now,
  }
  return { tracker: new TxTrackerService(deps), state }
}

describe('TxTrackerService.snapshot', () => {
  it('knows nothing about a hash the node and gateway have not seen', async () => {
    const r = rig()
    const s = await r.tracker.snapshot(HASH)
    expect(s.stage).toBe('unknown')
    expect(s.error).toBeUndefined()
  })

  it('reports a published send, then a received one', async () => {
    const r = rig()
    r.state.block = { received: false, confirmedAt: 90 }
    expect((await r.tracker.snapshot(HASH)).stage).toBe('published')
    r.state.block = { received: true, confirmedAt: 90 }
    const s = await r.tracker.snapshot(HASH)
    expect(s.stage).toBe('received')
    expect(s.confirmedAt).toBe(90)
  })

  it('ends an L1-only send at Received without reading the gateway', async () => {
    const r = rig()
    r.state.block = { received: true, createsInput: false }
    const s = await r.tracker.snapshot(HASH)
    expect(s.stage).toBe('received')
    expect(s.l1Only).toBe(true)
    expect(r.state.receiptReads).toBe(0)
  })

  it('reports a send Settlement refused as refused, for an L1-only send and an input send alike', async () => {
    for (const createsInput of [false, true]) {
      const r = rig()
      r.state.block = { received: true, refused: true, createsInput }
      const s = await r.tracker.snapshot(HASH)
      expect(s.refused).toBe(true)
      expect(s.error).toContain('Settlement refused this send')
      expect(r.state.receiptReads).toBe(0)
    }
  })

  it('maps the receipt tag to executed, submitted and finalized', async () => {
    const r = rig()
    r.state.block = { received: true }
    for (const [tag, stage] of [['pending', 'executed'], ['latest', 'submitted'], ['finalized', 'finalized']] as const) {
      r.state.receipt = receipt(tag)
      const s = await r.tracker.snapshot(HASH)
      expect(s.stage).toBe(stage)
      expect(s.receipt?.tag).toBe(tag)
      expect(s.proof).toEqual({ state: tag === 'pending' ? 'bound' : 'verified' })
    }
  })

  it('takes a receipt as proof the send was received even when the node read lags', async () => {
    const r = rig()
    r.state.block = null
    r.state.receipt = receipt('latest')
    const s = await r.tracker.snapshot(HASH)
    expect(s.stage).toBe('submitted')
    expect(s.proof).toEqual({ state: 'verified' })
  })

  it('keeps the last stage and records the error when the gateway is down', async () => {
    const r = rig()
    r.state.block = { received: true }
    r.state.gatewayDown = true
    const s = await r.tracker.snapshot(HASH)
    expect(s.stage).toBe('received')
    expect(s.error).toBe('gateway unreachable')
  })

  it('records a node read failure', async () => {
    const r = rig()
    r.state.blockError = new Error('node unreachable')
    const s = await r.tracker.snapshot(HASH)
    expect(s.error).toBe('node unreachable')
  })
})

describe('TxTrackerService.follow', () => {
  const collect = (r: Rig) => {
    const seen: TrackState[] = []
    const stop = r.tracker.follow(HASH, (s) => seen.push(s))
    return { seen, stop }
  }
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('polls through each stage and stops when the receipt is finalized', async () => {
    const r = rig((n, state) => {
      state.block = { received: true }
      state.receipt = receipt(n === 1 ? 'pending' : n === 2 ? 'latest' : 'finalized')
    })
    r.state.block = { received: false }
    const { seen } = collect(r)
    await settle()
    expect(seen.map((s) => s.stage)).toEqual(['published', 'executed', 'submitted', 'finalized'])
    expect(r.state.sleeps).toBe(3)
  })

  it('stops following an L1-only send once it is received', async () => {
    const r = rig((_n, state) => {
      state.block = { received: true, createsInput: false }
    })
    r.state.block = { received: false, createsInput: false }
    const { seen } = collect(r)
    await settle()
    expect(seen.map((s) => s.stage)).toEqual(['published', 'received'])
    expect(r.state.sleeps).toBe(1)
  })

  it('stops following a send Settlement refused', async () => {
    const r = rig((_n, state) => {
      state.block = { received: true, refused: true, createsInput: true }
    })
    r.state.block = { received: false, createsInput: true }
    const { seen } = collect(r)
    await settle()
    expect(seen.map((s) => s.refused)).toEqual([undefined, true])
    expect(r.state.sleeps).toBe(1)
  })

  it('refreshes at once when the gateway pushes a receipt notification', async () => {
    const slow = rig()
    // A long poll interval: only a push can wake the loop.
    const tracker = new TxTrackerService({
      ...(slow.tracker as unknown as { deps: TrackerDeps }).deps,
      sleep: () => new Promise(() => undefined),
    })
    const seen: TrackState[] = []
    slow.state.block = { received: true }
    tracker.follow(HASH, (s) => seen.push(s))
    await settle()
    expect(seen).toHaveLength(1)
    slow.state.receipt = receipt('finalized')
    slow.state.pushed[0]()
    await settle()
    expect(seen.map((s) => s.stage)).toEqual(['received', 'finalized'])
  })

  it('stops reporting after the stop function is called', async () => {
    const r = rig()
    const { seen, stop } = collect(r)
    await settle()
    const before = seen.length
    stop()
    r.state.pushed[0]?.()
    await settle()
    expect(seen.length).toBe(before)
  })
})

describe('TxTrackerService receipt check', () => {
  const R = receipt('latest')
  const R2 = { ...receipt('latest'), gasUsed: 2 } as unknown as ReceiptResult
  const FIN = receipt('finalized')
  const err = (check: string, detail = 'x') => new GatewayVerificationError('zeno_getReceipt', check as never, detail)
  const at = async (r: Rig, now: number, rc: ReceiptResult) => {
    r.state.now = now
    r.state.receipt = rc
    r.state.block = { received: true }
    return r.tracker.snapshot(HASH)
  }
  const proofOf = (s: TrackState) => s.proof as ReceiptCheck & { reason?: string; bindingsChecked?: boolean }
  /**
   * `verify` rejects with `error` when `when` matches the receipt, and
   * returns `otherwise` for any other.
   */
  const throwing = (r: Rig, error: Error, when: (rc: ReceiptResult) => boolean = () => true, otherwise = true) => {
    r.state.verify = async (_h, rc) => {
      if (when(rc)) throw error
      return otherwise
    }
  }

  it('fails a contradiction and stays at the node stage', async () => {
    const r = rig()
    r.state.block = { received: true }
    r.state.receipt = R
    throwing(r, err('receipt leaf'))
    const s = await r.tracker.snapshot(HASH)
    expect(s.stage).toBe('received')
    expect(s.proof).toEqual({ state: 'failed', reason: 'zeno_getReceipt: receipt leaf failed: x' })
    r.state.receipt = receipt('pending')
    throwing(r, err('sender binding'))
    const p = await r.tracker.snapshot(HASH)
    expect(p.stage).toBe('received')
    expect(p.proof?.state).toBe('failed')
  })

  it('waits on a missing batch with the bindings checked', async () => {
    const r = rig()
    r.state.block = { received: true }
    r.state.receipt = R
    throwing(r, err('batch root'))
    const s = await r.tracker.snapshot(HASH)
    expect(s.stage).toBe('received')
    expect(proofOf(s).state).toBe('waiting')
    expect(proofOf(s).reason).toMatch(/no batch 0 for domain 1/)
    expect(proofOf(s).bindingsChecked).toBe(true)
  })

  it('waits on a missing send with the bindings unchecked', async () => {
    const r = rig()
    r.state.block = { received: true }
    r.state.receipt = R
    throwing(r, new MissingSendError())
    const s = await r.tracker.snapshot(HASH)
    expect(s.stage).toBe('received')
    expect(proofOf(s).state).toBe('waiting')
    expect(proofOf(s).reason).toMatch(/does not show this send/)
    expect(proofOf(s).bindingsChecked).toBe(false)
  })

  it('holds a finalized receipt at submitted while the node lacks finality', async () => {
    const r = rig()
    r.state.block = { received: true }
    r.state.receipt = FIN
    throwing(r, err('finality'), (rc) => rc.tag === 'finalized')
    const s = await r.tracker.snapshot(HASH)
    expect(s.stage).toBe('submitted')
    expect(proofOf(s).state).toBe('waiting')
    expect(proofOf(s).reason).toMatch(/as finalized/)
    expect(s.proof).toMatchObject({ latestChecked: true })
    expect(r.state.verifyCalls.map((c) => c.tag)).toEqual(['finalized', 'latest'])
    await r.tracker.snapshot(HASH)
    expect(r.state.verifyCalls).toHaveLength(3)

    const bad = rig()
    bad.state.block = { received: true }
    bad.state.receipt = FIN
    bad.state.verify = async (_h, rc) => {
      throw rc.tag === 'finalized' ? err('finality') : err('receipt leaf')
    }
    const b = await bad.tracker.snapshot(HASH)
    expect(b.stage).toBe('received')
    expect(proofOf(b).state).toBe('failed')
    expect(proofOf(b).reason).toMatch(/receipt leaf/)
    expect(b.proof).not.toHaveProperty('latestChecked')
  })

  describe('node-behind limit', () => {
    it('fails a missing batch at the limit and recovers when the node catches up', async () => {
      const r = rig()
      throwing(r, err('batch root'))
      expect((await at(r, 0, R)).proof?.state).toBe('waiting')
      expect((await at(r, NODE_BEHIND_LIMIT_MS - 1, R)).proof?.state).toBe('waiting')
      const failed = proofOf(await at(r, NODE_BEHIND_LIMIT_MS, R))
      expect(failed.state).toBe('failed')
      expect(failed.reason).toMatch(/after 2 minutes/)
      expect(failed.reason).toMatch(/never accepted/)
      r.state.verify = async () => true
      const s = await at(r, NODE_BEHIND_LIMIT_MS + 1, R)
      expect(s.proof?.state).toBe('verified')
      expect(s.stage).toBe('submitted')
    })

    it('does not restart the clock when the receipt changes', async () => {
      const r = rig()
      throwing(r, err('batch root'))
      expect((await at(r, 0, R)).proof?.state).toBe('waiting')
      expect((await at(r, 120_000, R2)).proof?.state).toBe('failed')
    })

    it('does not restart the clock for a pending receipt', async () => {
      const r = rig()
      throwing(r, err('batch root'), (rc) => rc.tag === 'latest', false)
      expect((await at(r, 0, R)).proof?.state).toBe('waiting')
      expect((await at(r, 60_000, receipt('pending'))).proof?.state).toBe('bound')
      expect((await at(r, 120_000, R)).proof?.state).toBe('failed')
    })

    it('does not restart the clock after the send passed once', async () => {
      const r = rig()
      throwing(r, err('batch root'))
      expect((await at(r, 0, R)).proof?.state).toBe('waiting')
      r.state.verify = async () => true
      expect((await at(r, 60_000, R)).proof?.state).toBe('verified')
      throwing(r, err('batch root'))
      expect((await at(r, 130_000, R2)).proof?.state).toBe('waiting')
    })

    it('starts a new clock when the cause moves from the send to the batch', async () => {
      const r = rig()
      throwing(r, new MissingSendError())
      expect((await at(r, 0, R)).proof?.state).toBe('waiting')
      throwing(r, err('batch root'))
      const s = await at(r, 130_000, R)
      expect(proofOf(s).state).toBe('waiting')
      expect(proofOf(s).reason).toMatch(/no batch 0/)
    })

    it('fails a held finalized receipt at the limit', async () => {
      const r = rig()
      throwing(r, err('finality'), (rc) => rc.tag === 'finalized')
      const first = await at(r, 0, FIN)
      expect(first.proof?.state).toBe('waiting')
      expect(first.stage).toBe('submitted')
      const last = await at(r, 120_000, FIN)
      expect(proofOf(last).state).toBe('failed')
      expect(proofOf(last).reason).toMatch(/claim that the batch is final is false/)
      expect(last.stage).toBe('submitted')
      expect(last.proof).toMatchObject({ latestChecked: true })
    })

    it('fails a missing send at the limit', async () => {
      const r = rig()
      throwing(r, new MissingSendError())
      expect((await at(r, 0, R)).proof?.state).toBe('waiting')
      const s = await at(r, 120_000, R)
      expect(proofOf(s).state).toBe('failed')
      expect(proofOf(s).reason).toMatch(/never saw/)
    })

    it('does not clear the clock when latest and finalized receipts alternate', async () => {
      const r = rig()
      throwing(r, err('finality'), (rc) => rc.tag === 'finalized')
      expect((await at(r, 0, R)).proof?.state).toBe('verified')
      expect((await at(r, 10_000, FIN)).proof?.state).toBe('waiting')
      expect((await at(r, 60_000, R)).proof?.state).toBe('verified')
      expect((await at(r, 130_000, FIN)).proof?.state).toBe('failed')
    })

    it('starts the finality clock apart from an earlier batch wait', async () => {
      const r = rig()
      throwing(r, err('batch root'))
      expect((await at(r, 0, R)).proof?.state).toBe('waiting')
      throwing(r, err('finality'), (rc) => rc.tag === 'finalized')
      for (const now of [130_000, 249_999]) {
        const s = await at(r, now, FIN)
        expect(s.proof?.state).toBe('waiting')
        expect(s.stage).toBe('submitted')
      }
      expect((await at(r, 250_000, FIN)).proof?.state).toBe('failed')
    })
  })

  describe('gateway read failure', () => {
    const sidecar = () => new NotFoundError('sidecar not found', -32004)

    it('waits, then fails at the limit, with the bindings checked and no caching', async () => {
      const r = rig()
      throwing(r, sidecar())
      const first = await at(r, 0, R)
      expect(first.proof).toEqual({
        state: 'waiting',
        reason: "The gateway did not serve batch 0's receipt data: sidecar not found. The console checks again on the next read.",
        bindingsChecked: true,
      })
      expect(first.stage).toBe('received')
      expect((await at(r, NODE_BEHIND_LIMIT_MS - 1, R)).proof?.state).toBe('waiting')
      expect(r.state.verifyCalls).toHaveLength(2)
      expect((await at(r, NODE_BEHIND_LIMIT_MS, R)).proof).toEqual({
        state: 'failed',
        reason: "The gateway still has not served batch 0's receipt data after 2 minutes, so the receipt cannot be checked.",
      })
      r.state.verify = async () => true
      expect((await at(r, NODE_BEHIND_LIMIT_MS + 1, R)).proof?.state).toBe('verified')
    })

    it('treats an over-limit body as a gateway read failure', async () => {
      const r = rig()
      throwing(r, new ResponseSizeError('zeno_getReceiptSidecar', 64))
      expect(proofOf(await at(r, 0, R)).reason).toMatch(/did not serve batch 0's receipt data/)
      expect((await at(r, NODE_BEHIND_LIMIT_MS, R)).proof?.state).toBe('failed')
    })

    it('fails under the finality hold without marking the latest copy checked', async () => {
      const r = rig()
      r.state.verify = async (_h, rc) => {
        throw rc.tag === 'finalized' ? err('finality') : sidecar()
      }
      const first = await at(r, 0, FIN)
      expect(first.proof?.state).toBe('waiting')
      expect(first.proof).not.toHaveProperty('latestChecked')
      expect(first.stage).toBe('received')
      const last = await at(r, NODE_BEHIND_LIMIT_MS, FIN)
      expect(last.proof?.state).toBe('failed')
      expect(last.proof).not.toHaveProperty('latestChecked')
    })

    it('shares the batch clock with a missing batch', async () => {
      const r = rig()
      throwing(r, err('batch root'))
      await at(r, 0, R)
      throwing(r, sidecar())
      expect((await at(r, NODE_BEHIND_LIMIT_MS, R)).proof?.state).toBe('failed')
    })

    it('waits with no limit when the node read fails', async () => {
      const r = rig()
      throwing(r, new NodeReadError(new Error('node unreachable')))
      const expected = {
        state: 'waiting',
        reason: 'The receipt could not be checked: node unreachable',
        bindingsChecked: false,
      }
      expect((await at(r, 0, R)).proof).toEqual(expected)
      expect((await at(r, 300_000, R)).proof).toEqual(expected)
      expect(r.state.verifyCalls).toHaveLength(2)
    })
  })

  it('caches a definite outcome for an identical receipt only', async () => {
    const r = rig()
    r.state.block = { received: true }
    r.state.receipt = R
    await r.tracker.snapshot(HASH)
    await r.tracker.snapshot(HASH)
    expect(r.state.verifyCalls).toHaveLength(1)
    r.state.receipt = R2
    await r.tracker.snapshot(HASH)
    expect(r.state.verifyCalls).toHaveLength(2)
    await r.tracker.snapshot('cd'.repeat(32))
    expect(r.state.verifyCalls).toHaveLength(3)

    const leaf = rig()
    leaf.state.block = { received: true }
    leaf.state.receipt = R
    throwing(leaf, err('receipt leaf'))
    await leaf.tracker.snapshot(HASH)
    await leaf.tracker.snapshot(HASH)
    expect(leaf.state.verifyCalls).toHaveLength(1)

    const pending = rig()
    pending.state.block = { received: true }
    pending.state.receipt = receipt('pending')
    await pending.tracker.snapshot(HASH)
    await pending.tracker.snapshot(HASH)
    expect(pending.state.verifyCalls).toHaveLength(1)

    const reconnect = rig()
    reconnect.state.block = { received: true }
    reconnect.state.receipt = R
    await reconnect.tracker.snapshot(HASH)
    reconnect.state.reconnect()
    await reconnect.tracker.snapshot(HASH)
    expect(reconnect.state.verifyCalls).toHaveLength(2)

    for (const error of [err('batch root'), new MissingSendError()]) {
      const wait = rig()
      wait.state.block = { received: true }
      wait.state.receipt = R
      throwing(wait, error)
      await wait.tracker.snapshot(HASH)
      await wait.tracker.snapshot(HASH)
      expect(wait.state.verifyCalls).toHaveLength(2)
    }
  })

  it('follows a finalized receipt through the finality hold', async () => {
    let finalizedCalls = 0
    const r = rig()
    r.state.block = { received: true }
    r.state.receipt = FIN
    r.state.verify = async (_h, rc) => {
      if (rc.tag === 'finalized' && ++finalizedCalls <= 2) throw err('finality')
      return true
    }
    const seen: TrackState[] = []
    r.tracker.follow(HASH, (s) => seen.push(s))
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen.map((s) => s.stage)).toEqual(['submitted', 'submitted', 'finalized'])
    expect(r.state.sleeps).toBe(2)
  })
})

describe('bindingsChecked', () => {
  it('is true once the domain and sender matched the node', () => {
    expect(bindingsChecked({ state: 'verified' })).toBe(true)
    expect(bindingsChecked({ state: 'bound' })).toBe(true)
    expect(bindingsChecked({ state: 'waiting', reason: 'x', bindingsChecked: true })).toBe(true)
    expect(bindingsChecked({ state: 'waiting', reason: 'x', bindingsChecked: false })).toBe(false)
    expect(bindingsChecked({ state: 'failed', reason: 'x' })).toBe(false)
    expect(bindingsChecked(undefined)).toBe(false)
  })
})

describe('fieldsChecked', () => {
  it('is true for verified and for a held latest copy that passed', () => {
    expect(fieldsChecked({ state: 'verified' })).toBe(true)
    expect(fieldsChecked({ state: 'waiting', reason: 'x', bindingsChecked: true, latestChecked: true })).toBe(true)
    expect(fieldsChecked({ state: 'failed', reason: 'x', latestChecked: true })).toBe(true)
    expect(fieldsChecked({ state: 'waiting', reason: 'x', bindingsChecked: true })).toBe(false)
    expect(fieldsChecked({ state: 'failed', reason: 'x' })).toBe(false)
    expect(fieldsChecked({ state: 'bound' })).toBe(false)
    expect(fieldsChecked(undefined)).toBe(false)
  })
})

describe('createsDomainInput', () => {
  const writer = new SettlementWriteService({ getZenon: () => Zenon.getInstance(), ensureInitialized: async () => undefined })
  const contract = Hash.parse('11'.repeat(32))
  const to = (t: { toAddress: { toString(): string }; data: Uint8Array }) => createsDomainInput(t.toAddress.toString(), t.data)

  beforeAll(() => Zenon.setChainID(1))

  it('knows which sends queue a domain input', () => {
    const call = writer.callL2(1, contract, 1000n, Uint8Array.of(1, 2, 3))
    expect(to(call)).toBe(true)
    expect(to(writer.deposit(1, contract, 1000n, TokenStandard.parse('zts1znnxxxxxxxxxxxxx9z4ulx'), 5n))).toBe(true)
    expect(to(writer.pause(1, false, 1, true))).toBe(false)
    expect(to(writer.relayMessage(1, 1, Uint8Array.of(1), Uint8Array.of(2)))).toBe(false)
    expect(to(writer.releaseWithdrawals(1))).toBe(false)
    expect(createsDomainInput('z1qother', call.data)).toBe(false)
    expect(createsDomainInput(SETTLEMENT_ADDRESS.toString(), call.data.slice(0, 3))).toBe(false)
  })

  it('is true for each of the eight sends that queue a domain input', () => {
    for (const name of ['Deposit', 'CallL2', 'DeployContractStart', 'DeployContractChunk', 'DeployContractFinalize', 'UpgradeContract', 'TransferContractOwnership', 'BuyStorage']) {
      const data = Buffer.concat([Buffer.from(SettlementContract.abi.getSighash(name).replace(/^0x/, ''), 'hex'), Buffer.alloc(8)])
      expect(createsDomainInput(SETTLEMENT_ADDRESS.toString(), data), name).toBe(true)
    }
  })

  it('is false for every other Settlement method', () => {
    const inputs = ['Deposit', 'CallL2', 'DeployContractStart', 'DeployContractChunk', 'DeployContractFinalize', 'UpgradeContract', 'TransferContractOwnership', 'BuyStorage']
    const others = Object.keys(SettlementContract.abi.functions)
      .map((signature) => signature.split('(')[0])
      .filter((name) => !inputs.includes(name))
    expect(others).toEqual(expect.arrayContaining(['Update', 'CollectReward', 'SubmitBatch', 'Pause']))
    for (const name of others) {
      const data = Buffer.concat([Buffer.from(SettlementContract.abi.getSighash(name).replace(/^0x/, ''), 'hex'), Buffer.alloc(8)])
      expect(createsDomainInput(SETTLEMENT_ADDRESS.toString(), data), name).toBe(false)
    }
  })
})

describe('isRefusedStatus', () => {
  const status = (n: number) => {
    const data = Buffer.alloc(8)
    data.writeBigUInt64BE(BigInt(n))
    return data
  }

  it('reads the 8-byte big-endian status the VM writes: 1 succeeded, 2 failed', () => {
    expect(isRefusedStatus(status(1))).toBe(false)
    expect(isRefusedStatus(status(2))).toBe(true)
    expect(isRefusedStatus(status(0))).toBe(true)
  })

  it('counts missing or malformed data as refused', () => {
    expect(isRefusedStatus(new Uint8Array())).toBe(true)
    expect(isRefusedStatus(Uint8Array.of(1))).toBe(true)
  })
})

