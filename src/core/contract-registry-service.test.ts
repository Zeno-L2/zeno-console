import { describe, expect, it, vi } from 'vitest'
import type { ContractInterface } from 'zeno-client'
import { ContractRegistryService } from './contract-registry-service'

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

const ID = 'AB'.repeat(32)
const HASH = '11'.repeat(32)
const iface = (codeHash: string): ContractInterface => ({
  interface_version: 1,
  encoding: 'zeno-selector-v1',
  code_hash: codeHash,
  methods: [],
  on_deposit: null,
  events: [],
  errors: [],
  storage: [],
})

const make = () => {
  let t = 1000
  return new ContractRegistryService(new MemoryStorage(), () => (t += 1))
}

describe('ContractRegistryService', () => {
  it('adds a contract and lists it newest first', async () => {
    const r = make()
    await r.add({ contractId: '01'.repeat(32), domainId: 1 })
    await r.add({ contractId: '02'.repeat(32), domainId: 1 })
    expect((await r.list()).map((c) => c.contractId[1])).toEqual(['2', '1'])
  })

  it('lowercases the id and finds it by any case', async () => {
    const r = make()
    await r.add({ contractId: ID, domainId: 1, name: 'Vault' })
    expect((await r.get(1, ID.toLowerCase()))?.name).toBe('Vault')
    expect((await r.get(1, ID))?.contractId).toBe(ID.toLowerCase())
  })

  it('merges new fields and keeps the first added time', async () => {
    const r = make()
    const first = await r.add({ contractId: ID, domainId: 1, name: 'Vault' })
    const second = await r.add({ contractId: ID, domainId: 1, deployer: 'z1q' })
    expect(second.name).toBe('Vault')
    expect(second.deployer).toBe('z1q')
    expect(second.addedAt).toBe(first.addedAt)
    expect(await r.list()).toHaveLength(1)
  })

  it('keeps contracts of different domains apart', async () => {
    const r = make()
    await r.add({ contractId: ID, domainId: 1 })
    await r.add({ contractId: ID, domainId: 2 })
    expect(await r.list(1)).toHaveLength(1)
    expect(await r.list()).toHaveLength(2)
  })

  it('attaches an interface whose code hash is the contract\'s', async () => {
    const r = make()
    await r.add({ contractId: ID, domainId: 1 })
    const updated = await r.setInterface(1, ID, iface(HASH), HASH)
    expect(updated.iface?.code_hash).toBe(HASH)
    expect(updated.sourceCodeHash).toBe(HASH)
  })

  it('refuses an interface that belongs to another module', async () => {
    const r = make()
    await r.add({ contractId: ID, domainId: 1 })
    await expect(r.setInterface(1, ID, iface('22'.repeat(32)), HASH)).rejects.toThrow(/different module/)
    expect((await r.get(1, ID))?.iface).toBeUndefined()
  })

  it('clears a saved interface in the old shape, keeps the entry and writes the map back once', async () => {
    const storage = new MemoryStorage()
    const oldIface = {
      interface_version: 1,
      encoding: 'zeno-selector-v1',
      code_hash: HASH,
      methods: [{ name: 'get', inputs: [], output: 'u64' }],
      events: [],
      errors: [],
    }
    storage.data.set('zeno-contracts', {
      [`1:${ID.toLowerCase()}`]: {
        contractId: ID.toLowerCase(),
        domainId: 1,
        name: 'Old',
        iface: oldIface,
        addedAt: 5,
      },
    })
    const writes = vi.spyOn(storage, 'set')
    const r = new ContractRegistryService(storage, () => 1)
    const got = await r.get(1, ID)
    expect(got?.iface).toBeUndefined()
    expect(got?.interfaceCleared).toBe(true)
    expect(got?.name).toBe('Old')
    expect(got?.contractId).toBe(ID.toLowerCase())
    const listed = await r.list()
    expect(listed[0].interfaceCleared).toBe(true)
    expect(listed[0].iface).toBeUndefined()
    expect(writes).toHaveBeenCalledTimes(1)
    const stored = storage.data.get('zeno-contracts') as Record<string, { iface?: unknown }>
    expect(stored[`1:${ID.toLowerCase()}`].iface).toBeUndefined()
  })

  it.each([
    ['null', null],
    ['a string', 'text'],
    ['a number', 5],
    ['a list', [1, 2]],
  ])('skips a stored entry that is %s and clears the old interface beside it', async (_name, bad) => {
    const storage = new MemoryStorage()
    storage.data.set('zeno-contracts', {
      bad,
      [`1:${ID.toLowerCase()}`]: {
        contractId: ID.toLowerCase(),
        domainId: 1,
        iface: { interface_version: 1 },
        addedAt: 5,
      },
    })
    const r = new ContractRegistryService(storage, () => 1)
    const got = await r.get(1, ID)
    expect(got?.interfaceCleared).toBe(true)
    expect((await r.list(1)).map((c) => c.contractId)).toEqual([ID.toLowerCase()])
    expect((await r.list()).map((c) => c.contractId)).toEqual([ID.toLowerCase()])
    expect((storage.data.get('zeno-contracts') as Record<string, unknown>).bad).toEqual(bad)
  })

  it.each([['a string', 'x'], ['a number', 5], ['true', true], ['a list', [1]]])(
    'treats a stored map that is %s as empty and adds to it',
    async (_name, bad) => {
      const storage = new MemoryStorage()
      storage.data.set('zeno-contracts', bad)
      const r = new ContractRegistryService(storage, () => 1)
      expect(await r.list()).toEqual([])
      await r.add({ contractId: ID, domainId: 1 })
      expect((await r.list()).map((c) => c.contractId)).toEqual([ID.toLowerCase()])
    }
  )

  it('keeps a contract added to a stored list after the storage serialises to JSON', async () => {
    const data = new Map<string, string>([['zeno-contracts', JSON.stringify([1])]])
    const storage = {
      get: async (key: string) => (data.has(key) ? JSON.parse(data.get(key) as string) : null),
      set: async (key: string, value: unknown) => void data.set(key, JSON.stringify(value)),
      remove: async (key: string) => void data.delete(key),
    }
    const r = new ContractRegistryService(storage as never, () => 1)
    await r.add({ contractId: ID, domainId: 1 })
    expect((await r.list()).map((c) => c.contractId)).toEqual([ID.toLowerCase()])
  })

  it('keeps a saved interface when reading it fails for a reason other than the schema', async () => {
    const hostile = {
      get interface_version(): number {
        throw new RangeError('too deep')
      },
    }
    const map = {
      [`1:${ID.toLowerCase()}`]: {
        contractId: ID.toLowerCase(),
        domainId: 1,
        iface: hostile,
        addedAt: 5,
      },
    }
    const set = vi.fn()
    const storage = { get: async () => map, set, remove: async () => {} }
    const r = new ContractRegistryService(storage as never, () => 1)
    await expect(r.get(1, ID)).rejects.toThrow(RangeError)
    expect(set).not.toHaveBeenCalled()
    expect(map[`1:${ID.toLowerCase()}`].iface).toBe(hostile)
  })

  it('clears the flag when a valid interface is attached', async () => {
    const storage = new MemoryStorage()
    storage.data.set('zeno-contracts', {
      [`1:${ID.toLowerCase()}`]: {
        contractId: ID.toLowerCase(),
        domainId: 1,
        iface: { interface_version: 1 },
        addedAt: 5,
      },
    })
    const r = new ContractRegistryService(storage, () => 1)
    expect((await r.get(1, ID))?.interfaceCleared).toBe(true)
    const updated = await r.setInterface(1, ID, iface(HASH), HASH)
    expect(updated.interfaceCleared).toBe(false)
    expect((await r.get(1, ID))?.interfaceCleared).toBe(false)
    expect((await r.get(1, ID))?.iface?.code_hash).toBe(HASH)
  })

  it('renames and removes', async () => {
    const r = make()
    await r.add({ contractId: ID, domainId: 1 })
    await r.rename(1, ID, 'Counter')
    expect((await r.get(1, ID))?.name).toBe('Counter')
    await r.remove(1, ID)
    expect(await r.get(1, ID)).toBeNull()
    await r.rename(1, ID, 'Nothing')
    expect(await r.list()).toEqual([])
  })
})
