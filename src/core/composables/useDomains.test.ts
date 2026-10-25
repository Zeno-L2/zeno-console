import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { SettlementService } from '../settlement-service'
import { useNetwork } from './useNetwork'
import { useSettings } from './useSettings'
import { useDomains } from './useDomains'

const domain = (domainId: number) => ({ domainId, runtimeKind: 0 }) as never

function register(ids: number[]) {
  const getDomains = vi.fn(async (page: number, size: number) => ({
    count: ids.length,
    list: ids.slice(page * size, (page + 1) * size).map(domain),
  }))
  vi.spyOn(SettlementService, 'getInstance').mockReturnValue({ getDomains } as never)
  return getDomains
}

describe('useDomains', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await useSettings().reset()
  })

  it('reads 130 domains in two pages of 100', async () => {
    const getDomains = register(Array.from({ length: 130 }, (_, i) => i + 1))
    const d = useDomains()
    await d.load()
    expect(getDomains.mock.calls).toEqual([
      [0, 100],
      [1, 100],
    ])
    expect(d.domains.value).toHaveLength(130)
    expect(d.isLoaded.value).toBe(true)
    expect(d.error.value).toBeNull()
  })

  it('defaults to the settings domain when L1 lists it', async () => {
    register([2, 5, 9])
    await useSettings().update({ domainId: 5 })
    const d = useDomains()
    await d.load()
    expect(d.defaultDomainId.value).toBe(5)
  })

  it('defaults to the lowest registered id when L1 does not list the settings domain', async () => {
    register([7, 3, 9])
    await useSettings().update({ domainId: 1 })
    const d = useDomains()
    await d.load()
    expect(d.defaultDomainId.value).toBe(3)
  })

  it('defaults to the settings domain when L1 lists no domain', async () => {
    register([])
    await useSettings().update({ domainId: 4 })
    const d = useDomains()
    await d.load()
    expect(d.domains.value).toEqual([])
    expect(d.defaultDomainId.value).toBe(4)
    expect(d.isLoaded.value).toBe(true)
  })

  it('clears isLoaded while loading and keeps it clear after a failed read', async () => {
    register([1])
    const d = useDomains()
    await d.load()
    expect(d.isLoaded.value).toBe(true)

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: vi.fn().mockRejectedValue(new Error('node unreachable')),
    } as never)
    const loading = d.load()
    expect(d.isLoaded.value).toBe(false)
    expect(d.isLoading.value).toBe(true)
    await loading
    expect(d.isLoaded.value).toBe(false)
    expect(d.error.value).toBe('node unreachable')
    expect(d.isLoading.value).toBe(false)
  })

  it('lets only the latest load write state', async () => {
    let release: (value: unknown) => void = () => undefined
    const slow = new Promise((resolve) => (release = resolve))
    const getDomains = vi
      .fn()
      .mockImplementationOnce(async () => {
        await slow
        return { count: 1, list: [domain(100)] }
      })
      .mockImplementation(async () => ({ count: 1, list: [domain(2)] }))
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({ getDomains } as never)
    const d = useDomains()
    const first = d.load()
    await d.load()
    release(null)
    await first
    expect(d.domains.value.map((x) => x.domainId)).toEqual([2])
  })

  it('reloads when the L1 node changes', async () => {
    const getDomains = register([1, 2])
    const d = useDomains()
    await d.load()
    getDomains.mockClear()

    useNetwork().currentNode.value = 'ws://another-node.example:35998'
    await nextTick()
    await vi.waitFor(() => expect(getDomains).toHaveBeenCalledWith(0, 100))
    await vi.waitFor(() => expect(d.isLoaded.value).toBe(true))
  })
})
