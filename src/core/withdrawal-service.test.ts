import { beforeAll, describe, expect, it } from 'vitest'
import { sha3_256 } from '@noble/hashes/sha3'
import { Hash, SettlementContract, Zenon, settlement } from 'znn-typescript-sdk'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import { SettlementWriteService } from './settlement-write-service'
import { RelayRefusedError, WithdrawalService } from './withdrawal-service'
import type { WithdrawalDeps } from './withdrawal-service'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const cat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]))
const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
const u64 = (n: number) => cat(u32(Math.floor(n / 2 ** 32)), u32(n >>> 0))
const sha = (...p: Uint8Array[]) => sha3_256(cat(...p))

const ZNN_ASSET = '00'.repeat(22) + '14e66318c6318c6318c6'
const RECIPIENT = new Uint8Array(20).fill(7)
RECIPIENT[0] = 0

/** A 133-byte kind 1 withdrawal message (SPEC 27.4). */
function withdrawal(index: number, opts: { kind?: number; payloadLen?: number } = {}): Uint8Array {
  const amount = new Uint8Array(32)
  amount[31] = 9
  return cat(
    new Uint8Array(32).fill(0xc0), u64(index), u32(0), Uint8Array.of(opts.kind ?? 1), RECIPIENT,
    Uint8Array.from(Buffer.from(ZNN_ASSET, 'hex')), amount, u32(opts.payloadLen ?? 0)
  )
}

// A two-message batch: root = H(0x01 || leaf0 || leaf1), leaf = H(0x00 || message).
const m0 = withdrawal(1)
const m1 = withdrawal(2)
const leaf0 = sha(Uint8Array.of(0), m0)
const leaf1 = sha(Uint8Array.of(0), m1)
const root = sha(Uint8Array.of(1), leaf0, leaf1)
const proof0 = cat(u32(1), Uint8Array.of(1), leaf1) // the sibling is the right node

const ID0 = 'a0'.repeat(32)

interface Rig {
  service: WithdrawalService
  sent: AccountBlockTemplate[]
  state: {
    items: Record<string, unknown>[]
    pages: number
    proof: { batchId: number; outboxRoot: string; message: string; inclusionProof: string }
    processed: Set<string>
    queue: string[]
    pause: { global: { relayPaused: boolean } | null; domains: { domainId: number; relayPaused: boolean }[] }
    settlementRoot: Hash | null
    batchMissing: boolean
    batchReads: number
  }
}

function rig(): Rig {
  const sent: AccountBlockTemplate[] = []
  const state: Rig['state'] = {
    items: [],
    pages: 1,
    proof: { batchId: 5, outboxRoot: hex(root), message: hex(m0), inclusionProof: hex(proof0) },
    processed: new Set(),
    queue: [],
    pause: { global: null, domains: [] },
    settlementRoot: new Hash(Buffer.from(root)),
    batchMissing: false,
    batchReads: 0,
  }
  const writer = new SettlementWriteService({ getZenon: () => Zenon.getInstance(), ensureInitialized: async () => undefined })
  const deps: WithdrawalDeps = {
    gateway: {
      client: async () =>
        ({
          getOutbox: async (filter: { cursor?: string | null }) => {
            const page = filter.cursor ? Number(filter.cursor) : 0
            const size = Math.ceil(state.items.length / state.pages) || 1
            return {
              items: state.items.slice(page * size, (page + 1) * size),
              nextCursor: page + 1 < state.pages ? String(page + 1) : null,
            }
          },
          getOutboxProof: async () => state.proof,
        }) as never,
    },
    reads: {
      isOutboxProcessed: async (id) => state.processed.has(id.toString()),
      getReleaseQueue: async () => ({ list: state.queue.map((id) => ({ outboxId: Hash.parse(id) })) }),
      getPauseState: async () => state.pause as never,
      getBatch: async () => (state.batchReads++, state.batchMissing || !state.settlementRoot ? null : { outboxRoot: state.settlementRoot }),
    },
    writer,
    wallet: {
      send: async (template) => {
        sent.push(template)
        return { hash: 'cd'.repeat(32) }
      },
    },
  }
  return { service: new WithdrawalService(deps), sent, state }
}

const sighash = (name: string) => SettlementContract.abi.getSighash(name).replace(/^0x/, '')

beforeAll(() => Zenon.setChainID(1))

describe('WithdrawalService relay', () => {
  it('proves the SDK rebuilds this batch root from the message and its proof', () => {
    expect(settlement.outboxProofRoot(m0, proof0).toString()).toBe(hex(root))
  })

  it('builds a RelayMessage for a proof that rebuilds the recorded root', async () => {
    const r = rig()
    const { template, batchId } = await r.service.prepareRelay(1, ID0)
    expect(batchId).toBe(5)
    expect(Buffer.from(template.data).toString('hex').startsWith(sighash('RelayMessage'))).toBe(true)
  })

  it('sends the relay through the wallet', async () => {
    const r = rig()
    expect(await r.service.relay(1, ID0)).toBe('cd'.repeat(32))
    expect(r.sent).toHaveLength(1)
  })

  it('refuses before any send when the proof does not rebuild the named root', async () => {
    const r = rig()
    const tampered = Uint8Array.from(proof0)
    tampered[10] ^= 1
    r.state.proof.inclusionProof = hex(tampered)
    await expect(r.service.relay(1, ID0)).rejects.toThrow(/does not rebuild the outbox root/)
    expect(r.sent).toHaveLength(0)
  })

  it('refuses when the root differs from the one Settlement recorded', async () => {
    const r = rig()
    r.state.settlementRoot = new Hash(Buffer.from(sha(Uint8Array.of(9))))
    await expect(r.service.relay(1, ID0)).rejects.toThrow(/does not match the one Settlement recorded/)
    expect(r.sent).toHaveLength(0)
  })

  it('refuses when Settlement does not know the batch', async () => {
    const r = rig()
    r.state.batchMissing = true
    await expect(r.service.relay(1, ID0)).rejects.toThrow(/no batch 5/)
  })

  it('refuses a malformed proof', async () => {
    const r = rig()
    r.state.proof.inclusionProof = hex(cat(proof0, Uint8Array.of(0)))
    await expect(r.service.relay(1, ID0)).rejects.toThrow(RelayRefusedError)
    await expect(r.service.relay(1, ID0)).rejects.toThrow(/malformed/)
    expect(r.sent).toHaveLength(0)
  })

  it('refuses a malformed proof before reading Settlement\'s batch entry', async () => {
    const r = rig()
    r.state.proof.inclusionProof = hex(cat(proof0, Uint8Array.of(0)))
    await expect(r.service.prepareRelay(1, ID0)).rejects.toThrow(RelayRefusedError)
    expect(r.state.batchReads).toBe(0)
  })

  it('refuses a message that is not a withdrawal Settlement registers', async () => {
    const r = rig()
    r.state.proof.message = hex(withdrawal(1, { kind: 0 }))
    await expect(r.service.relay(1, ID0)).rejects.toThrow(/Settlement would reject this message/)
    r.state.proof.message = hex(withdrawal(1, { payloadLen: 4 }))
    await expect(r.service.relay(1, ID0)).rejects.toThrow(/empty payload/)
    expect(r.sent).toHaveLength(0)
  })
})

describe('WithdrawalService.release', () => {
  it('sends the ReleaseWithdrawals crank', async () => {
    const r = rig()
    await r.service.release(1)
    expect(Buffer.from(r.sent[0].data).toString('hex').startsWith(sighash('ReleaseWithdrawals'))).toBe(true)
  })
})
