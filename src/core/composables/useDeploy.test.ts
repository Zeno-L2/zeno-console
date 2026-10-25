import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Zenon } from 'znn-typescript-sdk'
import { sha3 } from 'zeno-client'
import { AccountService } from '../account-service'
import { SettlementService } from '../settlement-service'
import { DeployService, createDeployService } from '../deploy-service'
import { StubProvider } from '../stub-provider'
import { setDeployService, useDeploy } from './useDeploy'
import { useSettings } from './useSettings'
import { useWalletProvider } from './useWalletProvider'

const ADDRESS = 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'
const file = (bytes: Uint8Array, name = 'm.wasm') => new File([bytes as BlobPart], name)
const MODULE = Uint8Array.from({ length: 40_000 }, (_, i) => (i * 3) % 251)
const fixture = (name: string) => readFileSync(join(__dirname, '../../../test/fixtures', name))

const getDeployRecords = vi.fn<(domainId: number, deployer: string) => Promise<{ list: unknown[] }>>(async () => ({ list: [] }))

function mockReads(opts: { periphery?: { znnPerByteOfBytecode: bigint } | null; balance?: bigint; domainStatus?: number } = {}) {
  const periphery = 'periphery' in opts ? opts.periphery : { znnPerByteOfBytecode: 100n }
  vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
    getPeripheryConfig: async () => periphery,
    getDomain: async () => ({ status: opts.domainStatus ?? 0 }),
    getDeployRecords: getDeployRecords as never,
  } as unknown as SettlementService)
  vi.spyOn(AccountService, 'getInstance').mockReturnValue({
    getPlasma: async () => ({ currentPlasma: 500_000 }),
    getBalance: async () => opts.balance ?? 10n ** 12n,
  } as unknown as AccountService)
}

describe('useDeploy', () => {
  beforeEach(async () => {
    Zenon.setChainID(1)
    const stub = new StubProvider()
    stub.results.getAccounts = [ADDRESS]
    window.zenon = stub
    await useWalletProvider().connect()
    useDeploy().reset()
    useDeploy().configureUpgrade(null)
    setDeployService(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    getDeployRecords.mockClear()
    setDeployService(null)
    delete window.zenon
  })

  it('loads a module and reports its hash', async () => {
    const d = useDeploy()
    await d.loadModule(file(MODULE))
    expect(d.loadError.value).toBeNull()
    expect(d.moduleHash.value).toBe(Buffer.from(sha3(MODULE)).toString('hex'))
  })

  it('rejects a module above the size limit', async () => {
    const d = useDeploy()
    await d.loadModule(file(new Uint8Array(256 * 1024 + 1)))
    expect(d.loadError.value).toMatch(/above the 262144 byte limit/)
    expect(d.moduleBytes.value).toBeNull()
  })

  it('rejects an interface file that belongs to another module', async () => {
    const d = useDeploy()
    await d.loadModule(file(MODULE))
    const iface = { interface_version: 1, encoding: 'zeno-selector-v1', code_hash: '00'.repeat(32), methods: [], on_deposit: null, events: [], errors: [], storage: [] }
    await d.loadInterface(file(new TextEncoder().encode(JSON.stringify(iface)), 'm.interface.json'))
    expect(d.interfaceError.value).toMatch(/different module/)
  })

  it('rejects an interface file the domain does not accept', async () => {
    const d = useDeploy()
    d.acceptedEncodings.value = ['other-v1']
    await d.loadModule(file(MODULE))
    const iface = {
      interface_version: 1, encoding: 'zeno-selector-v1', code_hash: Buffer.from(sha3(MODULE)).toString('hex'),
      methods: [], on_deposit: null, events: [], errors: [], storage: [],
    }
    await d.loadInterface(file(new TextEncoder().encode(JSON.stringify(iface))))
    expect(d.interfaceError.value).toMatch(/does not accept the zeno-selector-v1/)
    d.acceptedEncodings.value = null
  })

  it('accepts the reference vault module with its interface file', async () => {
    const d = useDeploy()
    d.acceptedEncodings.value = ['zeno-selector-v1']
    const interfaceJson = fixture('vault.interface.json')
    await d.loadModule(file(fixture('vault.wasm')))
    await d.loadInterface(file(interfaceJson, 'vault.interface.json'))
    expect(d.loadError.value).toBeNull()
    expect(d.interfaceError.value).toBeNull()
    expect(d.moduleHash.value).toBe(JSON.parse(interfaceJson.toString('utf8')).code_hash)
    d.acceptedEncodings.value = null
  })

  it('reports an interface file that is not valid', async () => {
    const d = useDeploy()
    await d.loadModule(file(MODULE))
    await d.loadInterface(file(new TextEncoder().encode('{"interface_version": 3}')))
    expect(d.interfaceError.value).toMatch(/not supported/)
  })

  it('plans the deploy and moves to review with no preflight problem', async () => {
    mockReads()
    const d = useDeploy()
    await d.loadModule(file(MODULE))
    await d.buildPlan(1)
    expect(d.error.value).toBeNull()
    expect(d.plan.value?.chunkCount).toBe(3)
    expect(d.plan.value?.fee).toBe(40_000n * 100n)
    expect(d.availablePlasma.value).toBe(500_000)
    expect(d.problems.value).toEqual([])
    expect(d.step.value).toBe(3)
  })

  it('blocks the review when the periphery price is unset', async () => {
    mockReads({ periphery: null })
    const d = useDeploy()
    await d.loadModule(file(MODULE))
    await d.buildPlan(1)
    expect(d.problems.value.map((p) => p.kind)).toContain('peripheryUnset')
    expect(d.blocked.value).toBe(true)
  })

  it('blocks the review when the account cannot pay the fee', async () => {
    mockReads({ balance: 1n })
    const d = useDeploy()
    await d.loadModule(file(MODULE))
    await d.buildPlan(1)
    expect(d.problems.value.map((p) => p.kind)).toContain('insufficientZnn')
  })

  it('plans an upgrade with empty metadata', async () => {
    mockReads()
    const d = useDeploy()
    d.configureUpgrade('11'.repeat(32))
    await d.loadModule(file(MODULE))
    await d.buildPlan(1)
    expect(d.mode.value).toBe('upgrade')
    expect(d.plan.value?.metadataHash.toString()).toBe(Buffer.from(sha3(new Uint8Array(0))).toString('hex'))
  })

  it('needs a connected wallet and a module to plan', async () => {
    const d = useDeploy()
    await d.buildPlan(1)
    expect(d.error.value).toBe('Load a module first.')
  })

  it('maps journal steps to stepper items', async () => {
    mockReads()
    const d = useDeploy()
    await d.loadModule(file(MODULE))
    await d.buildPlan(1)
    const svc = createDeployService({
      reads: SettlementService.getInstance() as never,
      accounts: { getBalance: async () => 1n },
    })
    setDeployService(svc)
    d.journal.value = await svc.begin({
      kind: 'deploy', domainId: 1, deployer: ADDRESS, plan: d.plan.value!, metadata: new Uint8Array(23),
    })
    d.journal.value.steps[0].status = 'published'
    d.journal.value.steps[0].hash = 'ab'.repeat(32)
    d.journal.value.steps[1].status = 'approving'
    d.journal.value.steps[2].status = 'failed'
    d.journal.value.steps[2].error = 'The request was rejected in the wallet.'
    const items = d.stepItems.value
    expect(items.map((i) => i.state)).toEqual(['done', 'active', 'failed', 'waiting', 'waiting'])
    expect(items[0].title).toBe('Start deploy')
    expect(items[1].title).toBe('Chunk 1 of 3')
    expect(items[2].description).toBe('The request was rejected in the wallet.')
    expect(items[4].title).toBe('Finalize')
    expect(svc).toBeInstanceOf(DeployService)
  })

  describe('domain of a deploy', () => {
    function fakeService(stored: { status: string }[] | null = null) {
      const calls = { preflight: [] as number[], begin: [] as number[], journal: [] as string[], resumed: [] as unknown[] }
      const journalOf = (domainId: number) => ({ id: `${domainId}:j`, domainId, steps: [] }) as never
      const svc = {
        journals: async () => [],
        preflight: async (input: { domainId: number }) => {
          calls.preflight.push(input.domainId)
          return []
        },
        journal: async (id: string) => {
          calls.journal.push(id)
          return stored ? ({ id, domainId: 2, steps: stored }) as never : null
        },
        begin: async (input: { domainId: number }) => {
          calls.begin.push(input.domainId)
          return journalOf(input.domainId)
        },
        resume: async (j: unknown) => {
          calls.resumed.push(j)
          return 'submitted'
        },
      }
      setDeployService(svc as unknown as DeployService)
      return calls
    }

    it('checks the plan against the reviewed domain, not the settings domain', async () => {
      mockReads()
      const calls = fakeService()
      useSettings().settings.value = { ...useSettings().settings.value, domainId: 9 }
      const d = useDeploy()
      await d.loadModule(file(MODULE))
      await d.buildPlan(2)
      expect(calls.preflight).toEqual([2])
      expect(d.plannedDomainId.value).toBe(2)
      useSettings().settings.value = { ...useSettings().settings.value, domainId: 1 }
    })

    it('sends to the planned domain after the settings domain changes', async () => {
      mockReads()
      const calls = fakeService()
      const d = useDeploy()
      await d.loadModule(file(MODULE))
      await d.buildPlan(2)
      useSettings().settings.value = { ...useSettings().settings.value, domainId: 5 }
      await d.send()
      expect(calls.begin).toEqual([2])
      expect(calls.journal[0].startsWith('2:')).toBe(true)
      expect(d.step.value).toBe(5)
      useSettings().settings.value = { ...useSettings().settings.value, domainId: 1 }
    })

    it('starts a new journal when the stored one finished', async () => {
      mockReads()
      const calls = fakeService([{ status: 'published' }, { status: 'published' }])
      const d = useDeploy()
      await d.loadModule(file(MODULE))
      await d.buildPlan(2)
      await d.send()
      expect(calls.begin).toEqual([2])
      expect(calls.resumed).toEqual([d.journal.value])
      expect(d.journal.value?.id).toBe('2:j')
    })

    it('resumes a stored journal that did not finish', async () => {
      mockReads()
      const calls = fakeService([{ status: 'published' }, { status: 'failed' }])
      const d = useDeploy()
      await d.loadModule(file(MODULE))
      await d.buildPlan(2)
      await d.send()
      expect(calls.begin).toEqual([])
      expect(d.journal.value?.steps).toHaveLength(2)
      expect(calls.resumed).toHaveLength(1)
    })

    it('discardPending removes the journal and refreshes the list', async () => {
      mockReads()
      const d = useDeploy()
      await d.loadModule(file(MODULE))
      await d.buildPlan(1)
      const svc = createDeployService({
        reads: SettlementService.getInstance() as never,
        accounts: { getBalance: async () => 1n },
      })
      setDeployService(svc)
      const j = await svc.begin({
        kind: 'deploy', domainId: 1, deployer: ADDRESS, plan: d.plan.value!, metadata: new Uint8Array(23),
      })
      await d.loadPending()
      expect(d.pending.value).toHaveLength(1)
      await d.discardPending(j.id)
      expect(d.pending.value).toEqual([])
      expect(await svc.journal(j.id)).toBeNull()
    })

    it('retries to the planned domain', async () => {
      mockReads()
      const calls = fakeService()
      const d = useDeploy()
      await d.loadModule(file(MODULE))
      await d.buildPlan(3)
      await d.retry()
      expect(calls.begin).toEqual([3])
    })

    it('sends nothing without a plan', async () => {
      const calls = fakeService()
      await useDeploy().send()
      expect(calls.begin).toEqual([])
    })

    it('drops the plan and its domain on clearPlan', async () => {
      mockReads()
      fakeService()
      const d = useDeploy()
      await d.loadModule(file(MODULE))
      await d.buildPlan(2)
      d.clearPlan()
      expect(d.plan.value).toBeNull()
      expect(d.plannedDomainId.value).toBeNull()
      await d.send()
      expect(d.step.value).toBe(3)
    })
  })

  it('reads the unfinished deploy records of the given domain', async () => {
    mockReads()
    const record = { codeHash: 'x' }
    getDeployRecords.mockResolvedValueOnce({ list: [record] })
    const d = useDeploy()
    await d.loadRecords(4)
    expect(getDeployRecords).toHaveBeenCalledWith(4, ADDRESS)
    expect(d.records.value).toEqual([record])
  })

  it('shows no records without a wallet', async () => {
    mockReads()
    getDeployRecords.mockResolvedValueOnce({ list: [{ codeHash: 'x' }] })
    const d = useDeploy()
    await d.loadRecords(4)
    expect(d.records.value).toHaveLength(1)
    await useWalletProvider().disconnect()
    await d.loadRecords(4)
    expect(d.records.value).toEqual([])
  })
})
