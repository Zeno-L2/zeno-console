import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hash, SettlementContract, Zenon, settlement } from 'znn-typescript-sdk'
import type { AccountBlockTemplate, SettlementDeployRecord } from 'znn-typescript-sdk'
import { DeployService, journalId } from './deploy-service'
import type { DeployDeps, DeployJournal } from './deploy-service'
import { SettlementWriteService } from './settlement-write-service'
import { WalletError } from './wallet-provider'

const DEPLOYER = 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'
const MODULE = Uint8Array.from({ length: 40_000 }, (_, i) => (i * 7) % 251) // 3 chunks
const METADATA = new Uint8Array(23)

class MemoryStorage {
  data = new Map<string, unknown>()
  async get<T>(key: string) {
    return (this.data.has(key) ? structuredClone(this.data.get(key)) : null) as T | null
  }
  async set<T>(key: string, value: T) {
    this.data.set(key, structuredClone(value))
  }
  async remove(key: string) {
    this.data.delete(key)
  }
}

interface Rig {
  service: DeployService
  deps: DeployDeps
  sent: AccountBlockTemplate[]
  storage: MemoryStorage
  state: {
    record: Partial<SettlementDeployRecord> | null
    /** Called on each poll to move the record along. */
    onPoll?: (polls: number) => void
    polls: number
    failSendAt: Set<number>
    balance: bigint
    periphery: { znnPerByteOfBytecode: bigint } | null
    domain: { status: number } | null
    sleeps: number
  }
}

const planOf = (writer: SettlementWriteService, upgrade = false) =>
  writer.planDeploy({
    module: MODULE,
    metadata: upgrade ? new Uint8Array(0) : METADATA,
    znnPerByteOfBytecode: 100n,
    availablePlasma: 1_000_000,
  })

function rig(): Rig {
  const zenonService = { getZenon: () => Zenon.getInstance(), ensureInitialized: async () => undefined }
  const writer = new SettlementWriteService(zenonService)
  const sent: AccountBlockTemplate[] = []
  const storage = new MemoryStorage()
  const state: Rig['state'] = {
    record: null,
    polls: 0,
    failSendAt: new Set(),
    balance: 10n ** 12n,
    periphery: { znnPerByteOfBytecode: 100n },
    domain: { status: 0 },
    sleeps: 0,
  }
  const deps: DeployDeps = {
    reads: {
      getDomain: async () => state.domain,
      getPeripheryConfig: async () => state.periphery,
      getDeployRecords: async () => {
        state.polls++
        state.onPoll?.(state.polls)
        return { list: state.record ? [state.record as SettlementDeployRecord] : [] }
      },
    },
    accounts: { getBalance: async () => state.balance },
    writer,
    wallet: {
      send: async (template) => {
        const index = sent.length
        if (state.failSendAt.has(index)) {
          state.failSendAt.delete(index)
          throw new WalletError('The request was rejected in the wallet.', 'rejected', 4001)
        }
        sent.push(template)
        return { hash: String(index).padStart(64, '0') }
      },
    },
    storage,
    sleep: async () => {
      state.sleeps++
    },
    pollIntervalMs: 1,
    maxPolls: 5,
  }
  return { service: new DeployService(deps), deps, sent, storage, state }
}

const record = (codeHash: Hash, received: number, expired = false): Partial<SettlementDeployRecord> => ({
  codeHash,
  receivedCount: received,
  isExpired: expired,
})

/** Which Settlement method a sent template calls, by matching its calldata. */
function sendNames(sent: AccountBlockTemplate[]): string[] {
  return sent.map((t) => {
    const selector = Buffer.from(t.data).subarray(0, 4).toString('hex')
    return NAMES[selector] ?? selector
  })
}

let NAMES: Record<string, string> = {}

beforeAll(async () => {
  Zenon.setChainID(1)
  NAMES = {}
  for (const name of ['DeployContractStart', 'DeployContractChunk', 'DeployContractFinalize', 'UpgradeContract']) {
    NAMES[SettlementContract.abi.getSighash(name).replace(/^0x/, '')] = name
  }
})

describe('DeployService', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('preflight', () => {
    it('passes for a funded account on an active domain with prices set', async () => {
      const r = rig()
      expect(await r.service.preflight({ domainId: 1, deployer: DEPLOYER, fee: 1000n })).toEqual([])
    })

    it('blocks when the periphery price is unset', async () => {
      const r = rig()
      r.state.periphery = null
      const problems = await r.service.preflight({ domainId: 1, deployer: DEPLOYER, fee: 1n })
      expect(problems.map((p) => p.kind)).toEqual(['peripheryUnset'])
    })

    it('blocks a paused domain, an unknown domain and a short balance', async () => {
      const r = rig()
      r.state.domain = { status: settlement.DomainStatus.PAUSED }
      r.state.balance = 5n
      const paused = await r.service.preflight({ domainId: 1, deployer: DEPLOYER, fee: 10n })
      expect(paused.map((p) => p.kind).sort()).toEqual(['domainPaused', 'insufficientZnn'])
      r.state.domain = null
      const unknown = await r.service.preflight({ domainId: 9, deployer: DEPLOYER, fee: 1n })
      expect(unknown.map((p) => p.kind)).toContain('unknownDomain')
    })
  })

  describe('journals', () => {
    it('begins a journal with one step per send and saves it', async () => {
      const r = rig()
      const plan = planOf(r.deps.writer as SettlementWriteService)
      const journal = await r.service.begin({ kind: 'deploy', domainId: 1, deployer: DEPLOYER, plan, metadata: METADATA })
      expect(journal.steps.map((s) => s.id)).toEqual(['start', 'chunk-0', 'chunk-1', 'chunk-2', 'finalize'])
      expect(journal.id).toBe(journalId(1, DEPLOYER, plan.codeHash.toString()))
      expect(journal.fee).toBe((40_000n * 100n).toString())
      expect((await r.service.journals()).map((j) => j.id)).toEqual([journal.id])
      expect((await r.service.journal(journal.id))?.codeHash).toBe(plan.codeHash.toString())
      await r.service.remove(journal.id)
      expect(await r.service.journals()).toEqual([])
    })

    it('names the upgrade step for an upgrade', async () => {
      const r = rig()
      const plan = planOf(r.deps.writer as SettlementWriteService, true)
      const journal = await r.service.begin({
        kind: 'upgrade', domainId: 1, deployer: DEPLOYER, plan, metadata: new Uint8Array(0), contractId: '11'.repeat(32),
      })
      expect(journal.steps[journal.steps.length - 1].kind).toBe('upgrade')
    })
  })

  describe('run', () => {
    const start = async (r: Rig, upgrade = false) => {
      const plan = planOf(r.deps.writer as SettlementWriteService, upgrade)
      const journal = await r.service.begin({
        kind: upgrade ? 'upgrade' : 'deploy',
        domainId: 1,
        deployer: DEPLOYER,
        plan,
        metadata: upgrade ? new Uint8Array(0) : METADATA,
        contractId: upgrade ? '11'.repeat(32) : undefined,
      })
      return { plan, journal }
    }

    it('sends start, every chunk in order, then finalize with the fee', async () => {
      const r = rig()
      const { plan, journal } = await start(r)
      r.state.record = record(plan.codeHash, 3)
      expect(await r.service.run(journal, plan)).toBe('submitted')
      expect(sendNames(r.sent)).toEqual([
        'DeployContractStart',
        'DeployContractChunk',
        'DeployContractChunk',
        'DeployContractChunk',
        'DeployContractFinalize',
      ])
      expect(BigInt(r.sent[4].amount as bigint)).toBe(plan.fee)
      expect(journal.steps.every((s) => s.status === 'published')).toBe(true)
      expect(journal.steps[0].hash).toBe('0'.repeat(64))
    })

    it('sends start, chunks and finalize to the journal domain and polls its records', async () => {
      const r = rig()
      const writer = r.deps.writer as SettlementWriteService
      const seen: Record<string, number[]> = { start: [], chunk: [], finalize: [], upgrade: [] }
      for (const name of ['start', 'chunk', 'finalize', 'upgrade'] as const) {
        const original = writer[name].bind(writer) as (...args: unknown[]) => AccountBlockTemplate
        vi.spyOn(writer, name).mockImplementation(((...args: unknown[]) => {
          seen[name].push(args[0] as number)
          return original(...args)
        }) as never)
      }
      const polled: number[] = []
      const reads = r.deps.reads as { getDeployRecords: (d: number, a: string) => Promise<unknown> }
      const original = reads.getDeployRecords
      reads.getDeployRecords = (d, a) => {
        polled.push(d)
        return original(d, a)
      }
      const plan = planOf(writer)
      const journal = await r.service.begin({ kind: 'deploy', domainId: 2, deployer: DEPLOYER, plan, metadata: METADATA })
      expect(journal.id).toBe(journalId(2, DEPLOYER, plan.codeHash.toString()))
      r.state.record = record(plan.codeHash, 3)
      expect(await r.service.run(journal, plan)).toBe('submitted')
      expect(seen.start).toEqual([2])
      expect(seen.chunk).toEqual([2, 2, 2])
      expect(seen.finalize).toEqual([2])
      expect(polled.length).toBeGreaterThan(0)
      expect(new Set(polled)).toEqual(new Set([2]))
    })

    it('sends the upgrade to the journal domain', async () => {
      const r = rig()
      const writer = r.deps.writer as SettlementWriteService
      const seen: number[] = []
      const original = writer.upgrade.bind(writer)
      vi.spyOn(writer, 'upgrade').mockImplementation(((...args: Parameters<typeof original>) => {
        seen.push(args[0])
        return original(...args)
      }) as never)
      const plan = planOf(writer, true)
      const journal = await r.service.begin({
        kind: 'upgrade', domainId: 3, deployer: DEPLOYER, plan, metadata: new Uint8Array(0), contractId: '11'.repeat(32),
      })
      r.state.record = record(plan.codeHash, 3)
      await r.service.run(journal, plan)
      expect(seen).toEqual([3])
    })

    it('waits for Settlement to receive every chunk before it finalizes', async () => {
      const r = rig()
      const { plan, journal } = await start(r)
      r.state.record = record(plan.codeHash, 1)
      r.state.onPoll = (polls) => {
        r.state.record = record(plan.codeHash, polls >= 3 ? 3 : 1)
      }
      expect(await r.service.run(journal, plan)).toBe('submitted')
      expect(r.state.sleeps).toBe(2)
      expect(sendNames(r.sent).at(-1)).toBe('DeployContractFinalize')
    })

    it('fails the last step when the chunks are not received in time', async () => {
      const r = rig()
      const { plan, journal } = await start(r)
      r.state.record = record(plan.codeHash, 1)
      expect(await r.service.run(journal, plan)).toBe('failed')
      const last = journal.steps[journal.steps.length - 1]
      expect(last.status).toBe('failed')
      expect(last.error).toMatch(/every chunk/)
      expect(sendNames(r.sent)).not.toContain('DeployContractFinalize')
    })

    it('stops at a rejected send and continues from it on the next run', async () => {
      const r = rig()
      const { plan, journal } = await start(r)
      r.state.record = record(plan.codeHash, 3)
      r.state.failSendAt.add(2) // the third send: chunk 1
      expect(await r.service.run(journal, plan)).toBe('failed')
      expect(journal.steps.map((s) => s.status)).toEqual(['published', 'published', 'failed', 'waiting', 'waiting'])
      expect(journal.steps[2].error).toBe('The request was rejected in the wallet.')
      expect(sendNames(r.sent)).toEqual(['DeployContractStart', 'DeployContractChunk'])

      expect(await r.service.run(journal, plan)).toBe('submitted')
      expect(sendNames(r.sent)).toEqual([
        'DeployContractStart',
        'DeployContractChunk',
        'DeployContractChunk',
        'DeployContractChunk',
        'DeployContractFinalize',
      ])
    })

    it('persists the journal after every step', async () => {
      const r = rig()
      const { plan, journal } = await start(r)
      r.state.record = record(plan.codeHash, 3)
      const seen: string[] = []
      await r.service.run(journal, plan, { onUpdate: (j) => seen.push(j.steps.map((s) => s.status[0]).join('')) })
      expect(seen.length).toBeGreaterThan(5)
      const saved = (await r.service.journal(journal.id)) as DeployJournal
      expect(saved.steps.every((s) => s.status === 'published')).toBe(true)
    })

    it('sends the upgrade with the contract id and the fee', async () => {
      const r = rig()
      const { plan, journal } = await start(r, true)
      r.state.record = record(plan.codeHash, 3)
      expect(await r.service.run(journal, plan)).toBe('submitted')
      const last = r.sent[r.sent.length - 1]
      expect(sendNames([last])).toEqual(['UpgradeContract'])
      expect(BigInt(last.amount as bigint)).toBe(plan.fee)
    })

    it('refuses a plan that does not match the journal', async () => {
      const r = rig()
      const { plan, journal } = await start(r)
      const other = r.deps.writer as SettlementWriteService
      const different = other.planDeploy({
        module: Uint8Array.of(1, 2, 3),
        metadata: METADATA,
        znnPerByteOfBytecode: 100n,
        availablePlasma: 0,
      })
      await expect(r.service.run(journal, different)).rejects.toThrow(/code hash differs/)
      expect(plan.codeHash.toString()).toBe(journal.codeHash)
    })
  })

  describe('resume', () => {
    const journalWith = async (r: Rig, published: number, upgrade = false) => {
      const plan = planOf(r.deps.writer as SettlementWriteService, upgrade)
      const journal = await r.service.begin({
        kind: upgrade ? 'upgrade' : 'deploy', domainId: 1, deployer: DEPLOYER, plan,
        metadata: upgrade ? new Uint8Array(0) : METADATA, contractId: upgrade ? '11'.repeat(32) : undefined,
      })
      journal.steps.slice(0, published).forEach((s, i) => {
        s.status = 'published'
        s.hash = String(i).padStart(64, 'a')
      })
      return { plan, journal }
    }

    it('resends only the steps that were not published while the record lives', async () => {
      const r = rig()
      const { plan, journal } = await journalWith(r, 2) // start and chunk 0 published
      r.state.record = record(plan.codeHash, 3)
      journal.steps[2].status = 'failed'
      expect(await r.service.resume(journal, plan)).toBe('submitted')
      expect(sendNames(r.sent)).toEqual(['DeployContractChunk', 'DeployContractChunk', 'DeployContractFinalize'])
    })

    it('resumes in the journal domain', async () => {
      const r = rig()
      const writer = r.deps.writer as SettlementWriteService
      const chunkDomains: number[] = []
      const original = writer.chunk.bind(writer)
      vi.spyOn(writer, 'chunk').mockImplementation(((...args: Parameters<typeof original>) => {
        chunkDomains.push(args[0])
        return original(...args)
      }) as never)
      const plan = planOf(writer)
      const journal = await r.service.begin({ kind: 'deploy', domainId: 4, deployer: DEPLOYER, plan, metadata: METADATA })
      journal.steps[0].status = 'published'
      journal.steps[0].hash = 'a'.repeat(64)
      r.state.record = record(plan.codeHash, 3)
      expect(await r.service.resume(journal, plan)).toBe('submitted')
      expect(chunkDomains).toEqual([4, 4, 4])
    })

    it('restarts every step when the record expired', async () => {
      const r = rig()
      const { plan, journal } = await journalWith(r, 3)
      r.state.record = record(plan.codeHash, 2, true)
      r.state.onPoll = (polls) => {
        // The first poll is resume's own read. After it, the restarted deploy
        // has created a fresh record that receives all chunks.
        if (polls > 1) r.state.record = record(plan.codeHash, 3)
      }
      expect(await r.service.resume(journal, plan)).toBe('submitted')
      expect(sendNames(r.sent)[0]).toBe('DeployContractStart')
      expect(sendNames(r.sent)).toHaveLength(5)
    })

    it('restarts every step for an unfinished journal when the chain has no record', async () => {
      const r = rig()
      const { plan, journal } = await journalWith(r, 3)
      r.state.record = null
      r.state.onPoll = (polls) => {
        if (polls > 1) r.state.record = record(plan.codeHash, 3)
      }
      expect(await r.service.resume(journal, plan)).toBe('submitted')
      expect(sendNames(r.sent)).toEqual([
        'DeployContractStart', 'DeployContractChunk', 'DeployContractChunk', 'DeployContractChunk', 'DeployContractFinalize',
      ])
    })

    it('restarts when there is no record and the last step was not published', async () => {
      const r = rig()
      const { plan, journal } = await journalWith(r, 2)
      r.state.record = null
      r.state.onPoll = (polls) => {
        if (polls > 1) r.state.record = record(plan.codeHash, 3)
      }
      expect(await r.service.resume(journal, plan)).toBe('submitted')
      expect(sendNames(r.sent)[0]).toBe('DeployContractStart')
    })

    it('reports a deploy as submitted when the last step was published and the record is gone', async () => {
      const r = rig()
      const { plan, journal } = await journalWith(r, 5)
      r.state.record = null
      expect(await r.service.resume(journal, plan)).toBe('submitted')
      expect(r.sent).toHaveLength(0)
    })
  })
})
