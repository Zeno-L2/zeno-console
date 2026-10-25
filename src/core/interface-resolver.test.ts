import { describe, expect, it, vi } from 'vitest'
import type { ContractInterface } from 'zeno-client'
import { ContractRegistryService } from './contract-registry-service'
import type { GatewayService } from './gateway-service'
import { InterfaceResolver, knownInterfaces } from './interface-resolver'

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

const A = 'aa'.repeat(32)
const B = 'bb'.repeat(32)
const C = 'cc'.repeat(32)
const HASH = '11'.repeat(32)
// The vault, the first reference interface and the one with events.
const vault = knownInterfaces()[0] as ContractInterface

// A saved interface must parse, so the tests save the vault's under another code hash.
const iface = (codeHash: string): ContractInterface => ({ ...vault, code_hash: codeHash })

function gateway(hashes: Record<string, string | Error>) {
  const contract = vi.fn(async (id: string) => {
    const h = hashes[id]
    if (h instanceof Error) throw h
    return { result: { sourceCodeHash: h?.toUpperCase() } }
  })
  const g = {
    getUrl: () => 'http://gw',
    client: async () => ({ contracts: async () => ({ contract }) }),
  } as unknown as GatewayService
  return { g, contract }
}

const registry = () => new ContractRegistryService(new MemoryStorage(), () => 1)

describe('InterfaceResolver', () => {
  it('imports without Buffer, which main.ts sets after the imports run', async () => {
    vi.resetModules()
    vi.stubGlobal('Buffer', undefined)
    try {
      await expect(import('./interface-resolver')).resolves.toBeDefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("uses the contract's own saved interface without reading its code", async () => {
    const r = registry()
    await r.add({ contractId: A, domainId: 1, iface: iface(HASH) })
    const { g, contract } = gateway({})
    const out = await new InterfaceResolver(r, g).forContracts(1, [A.toUpperCase()])
    expect(out[A]?.code_hash).toBe(HASH)
    expect(contract).not.toHaveBeenCalled()
  })

  it('finds an interface saved for another contract running the same code', async () => {
    const r = registry()
    await r.add({ contractId: B, domainId: 1, iface: iface(HASH) })
    const { g } = gateway({ [A]: HASH })
    expect((await new InterfaceResolver(r, g).forContract(1, A))?.code_hash).toBe(HASH)
  })

  it('finds a built-in reference interface by code hash', async () => {
    const { g } = gateway({ [A]: vault.code_hash })
    expect(await new InterfaceResolver(registry(), g).forContract(1, A)).toBe(vault)
  })

  it('leaves a contract raw when its code is unknown or cannot be read', async () => {
    const { g, contract } = gateway({ [A]: C, [B]: new Error('down') })
    const resolver = new InterfaceResolver(registry(), g)
    expect(await resolver.forContracts(1, [A, B])).toEqual({})
    // The failed read is not cached, so the next call reads again.
    await resolver.forContract(1, B)
    expect(contract.mock.calls.filter(([id]) => id === B)).toHaveLength(2)
    expect(contract.mock.calls.filter(([id]) => id === A)).toHaveLength(1)
  })

  it('names events from every known interface by topic', async () => {
    const names = await new InterfaceResolver(registry(), gateway({}).g).eventNames()
    for (const event of vault.events) {
      expect(names.get(event.topic.replace(/^0x/, '').toLowerCase())).toBe(event.name)
    }
  })
})
