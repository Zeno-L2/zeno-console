import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { DomainStatus } from 'zeno-client'
import { GatewayService } from '../gateway-service'
import { ContractRegistryService } from '../contract-registry-service'
import { useContract } from './useContract'

const ID = 'c1' + '00'.repeat(31)

function stub() {
  const contractsFor = vi.fn(async (domainId: number) => ({
    domainId,
    features: {},
    interfaceEncodings: [],
    contract: async () => ({ result: { codeHash: null }, verified: true, batchId: 0 }),
  }))
  const service = { configure: () => undefined, client: async () => ({ contracts: contractsFor }), withTagFallback: async (tag: string, read: (t: string) => Promise<unknown>) => ({ value: await read(tag), tag }) }
  vi.spyOn(GatewayService, 'getInstance').mockReturnValue(service as never)
  vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue({ get: async () => null } as never)
  return contractsFor
}

describe('useContract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the domain named in the options', async () => {
    const contractsFor = stub()
    const c = useContract(ID, { domainId: 2, domainStatus: ref(null) })
    expect(c.domainId.value).toBe(2)
    await c.load()
    expect(contractsFor).toHaveBeenCalledWith(2)
  })

  it('returns the domainStatus ref it was given', () => {
    stub()
    const status = ref<DomainStatus | null>('INCONSISTENT')
    const c = useContract(ID, { domainId: 1, domainStatus: status })
    expect(c.domainStatus.value).toBe('INCONSISTENT')
    status.value = null
    expect(c.domainStatus.value).toBeNull()
  })

  it('records the error and stops loading when the read fails', async () => {
    const contractsFor = stub()
    contractsFor.mockRejectedValue(new Error('gateway down'))
    const c = useContract(ID, { domainId: 2, domainStatus: ref(null) })
    await c.load()
    expect(c.error.value).toBe('gateway down')
    expect(c.isLoading.value).toBe(false)
  })

  it('keeps the view of the newest load when an earlier load answers last', async () => {
    const OTHER = 'c2' + '00'.repeat(31)
    const slow: { release: () => void } = { release: () => undefined }
    const contract = vi.fn(async (id: string) => {
      if (id === ID) await new Promise<void>((resolve) => (slow.release = resolve))
      return { result: { codeHash: id === ID ? 'old' : 'new' }, verified: true, batchId: 0 }
    })
    const service = {
      configure: () => undefined,
      client: async () => ({ contracts: async () => ({ features: {}, interfaceEncodings: [], contract }) }),
      withTagFallback: async (tag: string, read: (t: string) => Promise<unknown>) => ({ value: await read(tag), tag }),
    }
    vi.spyOn(GatewayService, 'getInstance').mockReturnValue(service as never)
    vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue({ get: async () => null } as never)
    const id = ref(ID)
    const c = useContract(id, { domainId: 1, domainStatus: ref(null) })
    const first = c.load()
    await vi.waitFor(() => expect(contract).toHaveBeenCalledTimes(1))
    id.value = OTHER
    await c.load()
    expect(c.view.value?.result.codeHash).toBe('new')
    slow.release()
    await first
    expect(c.view.value?.result.codeHash).toBe('new')
    expect(c.isLoading.value).toBe(false)
  })

  it('drops the error of an earlier load that fails after a newer one succeeded', async () => {
    const OTHER = 'c2' + '00'.repeat(31)
    const slow: { fail: () => void } = { fail: () => undefined }
    const contract = vi.fn(async (id: string) => {
      if (id === ID) await new Promise<void>((_, reject) => (slow.fail = () => reject(new Error('late failure'))))
      return { result: { codeHash: 'new' }, verified: true, batchId: 0 }
    })
    const service = {
      configure: () => undefined,
      client: async () => ({ contracts: async () => ({ features: {}, interfaceEncodings: [], contract }) }),
      withTagFallback: async (tag: string, read: (t: string) => Promise<unknown>) => ({ value: await read(tag), tag }),
    }
    vi.spyOn(GatewayService, 'getInstance').mockReturnValue(service as never)
    vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue({ get: async () => null } as never)
    const id = ref(ID)
    const c = useContract(id, { domainId: 1, domainStatus: ref(null) })
    const first = c.load()
    await vi.waitFor(() => expect(contract).toHaveBeenCalledTimes(1))
    id.value = OTHER
    await c.load()
    slow.fail()
    await first
    expect(c.error.value).toBeNull()
    expect(c.view.value?.result.codeHash).toBe('new')
  })
})
