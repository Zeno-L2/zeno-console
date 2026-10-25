import { ZenoCodecError, parseInterface } from 'zeno-client'
import type { ContractInterface } from 'zeno-client'
import { storageService } from './storage/storage-service'
import type { StorageAdapter } from '../types'

export const STORAGE_KEY_CONTRACTS = 'zeno-contracts'

/** A contract the user deployed or imported, with its interface when known. */
export interface RegisteredContract {
  contractId: string
  domainId: number
  name?: string
  /** The as-deployed `code_hash`, hex. */
  sourceCodeHash?: string
  deployer?: string
  iface?: ContractInterface
  /** The saved interface failed to parse and was removed; the user should import it again. */
  interfaceCleared?: boolean
  addedAt: number
}

/**
 * The contracts this browser knows, in local storage. The registry holds
 * ids and interface files, never keys and never state: every value the
 * console shows for a contract is read from the gateway.
 */
export class ContractRegistryService {
  private static instance: ContractRegistryService | null = null

  constructor(
    private readonly storage: StorageAdapter = storageService,
    private readonly now: () => number = Date.now
  ) {}

  static getInstance(): ContractRegistryService {
    if (!ContractRegistryService.instance) {
      ContractRegistryService.instance = new ContractRegistryService()
    }
    return ContractRegistryService.instance
  }

  /** Reads the map. A saved interface that no longer parses is removed and the map is written back once. */
  private async read(): Promise<Record<string, RegisteredContract>> {
    const stored = await this.storage.get<Record<string, RegisteredContract>>(STORAGE_KEY_CONTRACTS)
    const all: Record<string, RegisteredContract> =
      stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
    let changed = false
    for (const contract of Object.values(all)) {
      if (!contract || typeof contract !== 'object' || contract.iface === undefined) continue
      try {
        parseInterface(contract.iface)
      } catch (err) {
        if (!(err instanceof ZenoCodecError)) throw err
        delete contract.iface
        contract.interfaceCleared = true
        changed = true
      }
    }
    if (changed) await this.storage.set(STORAGE_KEY_CONTRACTS, all)
    return all
  }

  private key(domainId: number, contractId: string): string {
    return `${domainId}:${contractId.toLowerCase()}`
  }

  /** Newest first. */
  async list(domainId?: number): Promise<RegisteredContract[]> {
    const all = Object.values(await this.read())
    return all
      .filter(
        (c) =>
          c &&
          typeof c === 'object' &&
          !Array.isArray(c) &&
          (domainId === undefined || c.domainId === domainId)
      )
      .sort((a, b) => b.addedAt - a.addedAt)
  }

  async get(domainId: number, contractId: string): Promise<RegisteredContract | null> {
    return (await this.read())[this.key(domainId, contractId)] ?? null
  }

  /** Adds a contract, or merges new fields into the one already registered. */
  async add(contract: Omit<RegisteredContract, 'addedAt'>): Promise<RegisteredContract> {
    const all = await this.read()
    const key = this.key(contract.domainId, contract.contractId)
    const existing = all[key]
    const merged: RegisteredContract = {
      ...existing,
      ...Object.fromEntries(Object.entries(contract).filter(([, v]) => v !== undefined)),
      contractId: contract.contractId.toLowerCase(),
      addedAt: existing?.addedAt ?? this.now(),
    } as RegisteredContract
    all[key] = merged
    await this.storage.set(STORAGE_KEY_CONTRACTS, all)
    return merged
  }

  /**
   * Attaches an interface file to a contract after checking that its
   * `code_hash` is the contract's as-deployed hash. Throws when it is not.
   */
  async setInterface(
    domainId: number,
    contractId: string,
    iface: ContractInterface,
    sourceCodeHash: string
  ): Promise<RegisteredContract> {
    if (iface.code_hash.toLowerCase() !== sourceCodeHash.toLowerCase()) {
      throw new Error("The interface file belongs to a different module: its code_hash is not this contract's.")
    }
    return this.add({
      contractId,
      domainId,
      iface,
      interfaceCleared: false,
      sourceCodeHash: sourceCodeHash.toLowerCase(),
    })
  }

  async rename(domainId: number, contractId: string, name: string): Promise<void> {
    const existing = await this.get(domainId, contractId)
    if (!existing) return
    await this.add({ ...existing, name })
  }

  async remove(domainId: number, contractId: string): Promise<void> {
    const all = await this.read()
    delete all[this.key(domainId, contractId)]
    await this.storage.set(STORAGE_KEY_CONTRACTS, all)
  }
}
