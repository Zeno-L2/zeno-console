import { parseInterface } from 'zeno-client'
import type { ContractInterface } from 'zeno-client'
import { ContractRegistryService } from './contract-registry-service'
import { GatewayService } from './gateway-service'
import counter from './known-interfaces/counter.interface.json'
import counterV2 from './known-interfaces/counter-v2.interface.json'
import vault from './known-interfaces/vault.interface.json'

let known: ContractInterface[] | null = null

/**
 * The interface files of the reference contracts, as `cargo zeno build` writes them in
 * zeno-contract-sdk-rs. Their builds are reproducible, so every deploy of one has this code_hash.
 * Parsed on first use: parsing needs `Buffer`, which main.ts sets only after the imports run.
 */
export function knownInterfaces(): ContractInterface[] {
  known ??= [vault, counter, counterV2].map((json) => parseInterface(json))
  return known
}

/**
 * Finds the interface for a contract. A contract's own saved interface comes first; otherwise
 * any interface whose code_hash is the contract's code: one saved for another contract running
 * the same module, or a reference contract's. The code hash comes from the gateway, so an
 * interface found this way always belongs to the code the contract runs now.
 */
export class InterfaceResolver {
  private static instance: InterfaceResolver | null = null
  // Code hashes by `gateway URL|domainId:contractId`. A failed read is not kept, so it is retried.
  private readonly codeHashes = new Map<string, Promise<string | null>>()

  // Read on each use, so a gateway or registry swapped in later is the one used.
  constructor(
    private readonly registryOverride?: ContractRegistryService,
    private readonly gatewayOverride?: GatewayService
  ) {}

  private get registry(): ContractRegistryService {
    return this.registryOverride ?? ContractRegistryService.getInstance()
  }

  private get gateway(): GatewayService {
    return this.gatewayOverride ?? GatewayService.getInstance()
  }

  static getInstance(): InterfaceResolver {
    if (!InterfaceResolver.instance) InterfaceResolver.instance = new InterfaceResolver()
    return InterfaceResolver.instance
  }

  /** Forgets the cached code hashes, for a gateway change or a contract upgrade. */
  clear(): void {
    this.codeHashes.clear()
  }

  /** Every interface this browser knows, by lower-case code_hash. Saved ones win over the built-in ones. */
  async byCodeHash(): Promise<Map<string, ContractInterface>> {
    const map = new Map<string, ContractInterface>()
    for (const iface of knownInterfaces()) map.set(iface.code_hash.toLowerCase(), iface)
    for (const contract of await this.registry.list()) {
      if (contract.iface) map.set(contract.iface.code_hash.toLowerCase(), contract.iface)
    }
    return map
  }

  /** Event names by lower-case topic, from every known interface. */
  async eventNames(): Promise<Map<string, string>> {
    const names = new Map<string, string>()
    for (const iface of (await this.byCodeHash()).values()) {
      for (const event of iface.events) names.set(event.topic.replace(/^0x/, '').toLowerCase(), event.name)
    }
    return names
  }

  /** The contract's as-deployed code hash, or null when the domain has no such contract. */
  codeHashOf(domainId: number, contractId: string): Promise<string | null> {
    const key = `${this.gateway.getUrl()}|${domainId}:${contractId.toLowerCase()}`
    let pending = this.codeHashes.get(key)
    if (!pending) {
      pending = this.readCodeHash(domainId, contractId)
      this.codeHashes.set(key, pending)
      pending.catch(() => this.codeHashes.delete(key))
    }
    return pending
  }

  private async readCodeHash(domainId: number, contractId: string): Promise<string | null> {
    const contracts = await (await this.gateway.client()).contracts(domainId)
    const view = await contracts.contract(contractId.toLowerCase(), 'latest')
    return view.result.sourceCodeHash?.toLowerCase() ?? null
  }

  /** The interface for one contract, or null when none is known for its code. */
  async forContract(domainId: number, contractId: string): Promise<ContractInterface | null> {
    return (await this.forContracts(domainId, [contractId]))[contractId.toLowerCase()] ?? null
  }

  /**
   * Interfaces for several contracts of one domain, by lower-case contract id. A contract whose
   * code hash cannot be read is left out, so its events stay raw.
   */
  async forContracts(domainId: number, contractIds: string[]): Promise<Record<string, ContractInterface>> {
    const ids = [...new Set(contractIds.map((id) => id.toLowerCase()))]
    const saved = await this.registry.list(domainId)
    const own = new Map(saved.flatMap((c) => (c.iface ? [[c.contractId.toLowerCase(), c.iface] as const] : [])))
    const byCode = await this.byCodeHash()
    const out: Record<string, ContractInterface> = {}
    await Promise.all(
      ids.map(async (id) => {
        const iface = own.get(id)
        if (iface) {
          out[id] = iface
          return
        }
        try {
          const codeHash = await this.codeHashOf(domainId, id)
          const match = codeHash ? byCode.get(codeHash) : undefined
          if (match) out[id] = match
        } catch {
          // The contract's code could not be read; its events stay raw.
        }
      })
    )
    return out
  }
}
