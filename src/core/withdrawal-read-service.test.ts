import { describe, expect, it } from 'vitest'
import { Hash } from 'znn-typescript-sdk'
import { OutboxProofError, WithdrawalReadService } from './withdrawal-read-service'
import { result } from '../../test/replay-client'

const ZNN_ASSET = '00'.repeat(22) + '14e66318c6318c6318c6'

interface Rig {
  service: WithdrawalReadService
  state: {
    items: Record<string, unknown>[]
    pages: number
    filters: Record<string, unknown>[]
    processed: Set<string>
    queue: string[]
    pause: { global: { relayPaused: boolean } | null; domains: { domainId: number; relayPaused: boolean }[] }
    proof: Record<string, unknown>
    batchRoot: string | null
    queueReads: number
    processedReads: number
    batchReads: number
  }
}

function rig(): Rig {
  const state: Rig['state'] = {
    items: [],
    pages: 1,
    filters: [],
    processed: new Set(),
    queue: [],
    pause: { global: null, domains: [] },
    proof: result('outbox getOutboxProof 0'),
    batchRoot: result<{ outboxRoot: string }>('outbox getOutboxProof 0').outboxRoot,
    queueReads: 0,
    processedReads: 0,
    batchReads: 0,
  }
  const service = new WithdrawalReadService({
    gateway: {
      client: async () =>
        ({
          getOutboxProof: async () => state.proof,
          getOutbox: async (filter: { cursor?: string | null }) => {
            state.filters.push(filter)
            const page = filter.cursor ? Number(filter.cursor) : 0
            const size = Math.ceil(state.items.length / state.pages) || 1
            return {
              items: state.items.slice(page * size, (page + 1) * size),
              nextCursor: page + 1 < state.pages ? String(page + 1) : null,
            }
          },
        }) as never,
    },
    reads: {
      isOutboxProcessed: async (id) => {
        state.processedReads++
        return state.processed.has(id.toString())
      },
      getReleaseQueue: async () => {
        state.queueReads++
        return { list: state.queue.map((id) => ({ outboxId: Hash.parse(id) })) }
      },
      getPauseState: async () => state.pause as never,
      getBatch: async () => {
        state.batchReads++
        return state.batchRoot ? { outboxRoot: Hash.parse(state.batchRoot) } : null
      },
    },
  })
  return { service, state }
}

const item = (outboxId: string, kind = 'L1_WITHDRAWAL') => ({ outboxId, kind, batchId: 5, verified: true, recipient: 'z1q', assetId: ZNN_ASSET, amount: '9' })

describe('WithdrawalReadService.list', () => {
  it('keeps only L1 withdrawals and names each one\'s state', async () => {
    const r = rig()
    r.state.items = [item('01'.repeat(32)), item('02'.repeat(32)), item('03'.repeat(32)), item('04'.repeat(32), 'L2_DELIVERY')]
    r.state.processed = new Set(['02'.repeat(32), '03'.repeat(32)])
    r.state.queue = ['02'.repeat(32)]
    const { withdrawals: list } = await r.service.list(1, 'z1q')
    expect(list.map((w) => [w.item.outboxId[0] + w.item.outboxId[1], w.state])).toEqual([
      ['01', 'relayable'],
      ['02', 'queued'],
      ['03', 'released'],
    ])
  })

  it('follows the cursor across pages', async () => {
    const r = rig()
    r.state.items = [item('01'.repeat(32)), item('02'.repeat(32)), item('03'.repeat(32))]
    r.state.pages = 3
    const list = await r.service.list(1, 'z1q')
    expect(list.withdrawals).toHaveLength(3)
    expect(list.more).toBe(false)
  })

  it('asks for the domain\'s outbox without a recipient', async () => {
    const r = rig()
    r.state.items = [{ ...item('01'.repeat(32)), recipient: 'z1other' }, item('02'.repeat(32))]
    const list = await r.service.list(1)
    expect(r.state.filters[0]).not.toHaveProperty('recipient')
    expect(list.withdrawals.map((w) => w.item.recipient)).toEqual(['z1other', 'z1q'])
    expect(list.more).toBe(false)
  })

  it('passes the recipient when given', async () => {
    const r = rig()
    await r.service.list(1, 'z1q')
    expect(r.state.filters[0]).toMatchObject({ recipient: 'z1q' })
  })

  it('stops once it holds more than the withdrawal limit', async () => {
    const r = rig()
    r.state.items = Array.from({ length: 250 }, (_, i) => item(i.toString(16).padStart(64, '0')))
    r.state.pages = 5
    const list = await r.service.list(1)
    expect(r.state.filters).toHaveLength(3)
    expect(list.withdrawals).toHaveLength(100)
    expect(list.more).toBe(true)
    expect(r.state.processedReads).toBe(100)
  })

  it('stops after the page limit', async () => {
    const r = rig()
    r.state.items = Array.from({ length: 6 }, (_, i) => item(i.toString(16).padStart(64, '0'), 'L2_DELIVERY'))
    r.state.pages = 6
    const list = await r.service.list(1)
    expect(r.state.filters).toHaveLength(5)
    expect(list.withdrawals).toEqual([])
    expect(list.more).toBe(true)
  })

  it('applies the withdrawal limit with a recipient too', async () => {
    const r = rig()
    r.state.items = Array.from({ length: 250 }, (_, i) => item(i.toString(16).padStart(64, '0')))
    r.state.pages = 5
    const list = await r.service.list(1, 'z1q')
    expect(r.state.filters).toHaveLength(3)
    expect(r.state.filters.every((f) => f.recipient === 'z1q')).toBe(true)
    expect(list.withdrawals).toHaveLength(100)
    expect(list.more).toBe(true)
  })

  it('reports no more when the outbox ends within the limits', async () => {
    const r = rig()
    r.state.items = Array.from({ length: 100 }, (_, i) => item(i.toString(16).padStart(64, '0')))
    r.state.pages = 2
    const list = await r.service.list(1)
    expect(r.state.filters).toHaveLength(2)
    expect(list.withdrawals).toHaveLength(100)
    expect(list.more).toBe(false)
  })

  it('reads one more page when exactly the limit is held and a cursor remains', async () => {
    const r = rig()
    r.state.items = Array.from({ length: 150 }, (_, i) => item(i.toString(16).padStart(64, '0')))
    r.state.pages = 3
    const list = await r.service.list(1)
    expect(r.state.filters).toHaveLength(3)
    expect(list.withdrawals).toHaveLength(100)
    expect(list.more).toBe(true)
  })

  it('returns nothing when the outbox holds no withdrawal', async () => {
    const r = rig()
    r.state.items = [item('04'.repeat(32), 'L2_DELIVERY')]
    expect(await r.service.list(1, 'z1q')).toEqual({ withdrawals: [], more: false })
  })
})

describe('WithdrawalReadService.relayPaused', () => {
  it('is true for a global pause or this domain\'s pause, and false otherwise', async () => {
    const r = rig()
    expect(await r.service.relayPaused(1)).toBe(false)
    r.state.pause = { global: { relayPaused: true }, domains: [] }
    expect(await r.service.relayPaused(1)).toBe(true)
    r.state.pause = { global: null, domains: [{ domainId: 2, relayPaused: true }] }
    expect(await r.service.relayPaused(1)).toBe(false)
    r.state.pause = { global: null, domains: [{ domainId: 1, relayPaused: true }] }
    expect(await r.service.relayPaused(1)).toBe(true)
  })
})

describe('WithdrawalReadService.statesOf', () => {
  it('marks an unverified withdrawal pending without reading Settlement', async () => {
    const r = rig()
    const states = await r.service.statesOf(1, [{ ...item('01'.repeat(32)), verified: false }] as never)
    expect(states.get('01'.repeat(32))).toBe('pending')
    expect(r.state.processedReads).toBe(0)
    expect(r.state.queueReads).toBe(0)
  })

  it('gives other kinds no entry', async () => {
    const r = rig()
    const states = await r.service.statesOf(1, [item('04'.repeat(32), 'L2_DELIVERY')] as never)
    expect(states.size).toBe(0)
  })

  it('mixes pending and verified states', async () => {
    const r = rig()
    r.state.processed = new Set(['02'.repeat(32)])
    const states = await r.service.statesOf(1, [
      { ...item('01'.repeat(32)), verified: false },
      item('02'.repeat(32)),
      item('03'.repeat(32)),
    ] as never)
    expect([...states.entries()].sort()).toEqual([
      ['01'.repeat(32), 'pending'],
      ['02'.repeat(32), 'released'],
      ['03'.repeat(32), 'relayable'],
    ])
  })

  it('agrees with list for the same items', async () => {
    const r = rig()
    r.state.items = [item('01'.repeat(32)), item('02'.repeat(32))]
    r.state.processed = new Set(['02'.repeat(32)])
    r.state.queue = ['02'.repeat(32)]
    const listed = (await r.service.list(1, 'z1q')).withdrawals
    const states = await r.service.statesOf(1, r.state.items as never)
    expect(listed.map((w) => [w.item.outboxId, w.state])).toEqual([...states.entries()])
  })
})

describe('WithdrawalReadService.checkProof', () => {
  it('returns a verified proof that matches the Settlement entry', async () => {
    const r = rig()
    const proof = await r.service.checkProof(r.state.proof.outboxId as string)
    expect(proof.verified).toBe(true)
    expect(r.state.batchReads).toBe(1)
  })

  it('skips the Settlement entry for an unverified proof', async () => {
    const r = rig()
    r.state.proof = { ...r.state.proof, verified: false }
    r.state.batchRoot = null
    const proof = await r.service.checkProof(r.state.proof.outboxId as string)
    expect(proof.verified).toBe(false)
    expect(r.state.batchReads).toBe(0)
  })

  it('still rebuilds the root for an unverified proof', async () => {
    const r = rig()
    r.state.proof = { ...r.state.proof, verified: false, outboxRoot: '00'.repeat(32) }
    await expect(r.service.checkProof('x')).rejects.toThrow(/does not rebuild the outbox root/)
  })

  it('throws when the proof does not rebuild the named root', async () => {
    const r = rig()
    r.state.proof = { ...r.state.proof, outboxRoot: '00'.repeat(32) }
    await expect(r.service.checkProof('x')).rejects.toThrow(OutboxProofError)
    expect(r.state.batchReads).toBe(0)
  })

  it('throws before reading Settlement when the proof is malformed', async () => {
    const r = rig()
    r.state.proof = { ...r.state.proof, inclusionProof: (r.state.proof.inclusionProof as string) + '00' }
    await expect(r.service.checkProof('x')).rejects.toThrow(/malformed/)
    expect(r.state.batchReads).toBe(0)
  })

  it('throws when Settlement holds a different root', async () => {
    const r = rig()
    r.state.batchRoot = '11'.repeat(32)
    await expect(r.service.checkProof('x')).rejects.toThrow(/does not match the one Settlement recorded/)
  })

  it('throws when Settlement has no entry for a verified proof', async () => {
    const r = rig()
    r.state.batchRoot = null
    await expect(r.service.checkProof('x')).rejects.toThrow(/Settlement has no batch 0/)
  })
})
