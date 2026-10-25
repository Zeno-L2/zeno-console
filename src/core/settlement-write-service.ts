import { Address, Hash, TokenStandard, ZNN_ZTS, settlement } from 'znn-typescript-sdk'
import type { AccountBlockTemplate, RegisterDomainParams } from 'znn-typescript-sdk'
import { encodeMetadata } from 'zeno-client'
import { ZenonService } from './zenon-service'
import type { IZenonService } from './chain-service'

export interface DeployInput {
  module: Uint8Array
  /** The 23-byte `ContractMetadata`, or empty for an upgrade's staged module. */
  metadata: Uint8Array
  /** ZNN per byte of bytecode, from the periphery config. */
  znnPerByteOfBytecode: bigint
  /** Plasma the sender has available, for the chunks-in-flight estimate. */
  availablePlasma: number
}

/**
 * Builds the unsigned Settlement sends the console asks the wallet to sign.
 * It never fetches a price: fees are arguments, as the SDK's builders take
 * them, so a builder stays synchronous and a stale price is the caller's
 * to refresh.
 */
export class SettlementWriteService {
  private static instance: SettlementWriteService | null = null

  constructor(private readonly zenonService: IZenonService = ZenonService.getInstance()) {}

  static getInstance(): SettlementWriteService {
    if (!SettlementWriteService.instance) {
      SettlementWriteService.instance = new SettlementWriteService()
    }
    return SettlementWriteService.instance
  }

  private get api() {
    return this.zenonService.getZenon().embedded.settlement
  }

  /** The metadata bytes of a new deploy: upgrade policy and owner. */
  deployMetadata(upgradePolicy: number, owner: Address): Uint8Array {
    return encodeMetadata({ upgradePolicy, owner })
  }

  /** Splits `module` into chunk sends and prices the deploy. */
  planDeploy(input: DeployInput): settlement.DeployPlan {
    return settlement.planDeploy(
      input.module,
      input.metadata,
      { znnPerByteOfBytecode: input.znnPerByteOfBytecode },
      input.availablePlasma
    )
  }

  start(domainId: number, plan: settlement.DeployPlan, metadata: Uint8Array): AccountBlockTemplate {
    return this.api.deployContractStart(
      domainId,
      plan.codeHash,
      plan.metadataHash,
      plan.totalSize,
      plan.chunkCount,
      metadata
    )
  }

  chunk(domainId: number, plan: settlement.DeployPlan, index: number): AccountBlockTemplate {
    const chunk = plan.chunks[index]
    if (!chunk) throw new Error(`the plan has no chunk ${index}`)
    return this.api.deployContractChunk(domainId, plan.codeHash, chunk.index, chunk.chunkHash, chunk.data)
  }

  finalize(domainId: number, plan: settlement.DeployPlan): AccountBlockTemplate {
    return this.api.deployContractFinalize(domainId, plan.codeHash, plan.fee)
  }

  upgrade(domainId: number, contractId: Hash, plan: settlement.DeployPlan): AccountBlockTemplate {
    return this.api.upgradeContract(domainId, contractId, plan.codeHash, plan.fee)
  }

  /** A `CallL2` with an optional ZTS deposit. `payload` is at most `MaxCallPayload`. */
  callL2(
    domainId: number,
    contractId: Hash,
    plasmaLimit: bigint,
    payload: Uint8Array,
    deposit?: { token: TokenStandard; amount: bigint }
  ): AccountBlockTemplate {
    return this.api.callL2(domainId, contractId, plasmaLimit, payload, deposit?.token ?? ZNN_ZTS, deposit?.amount ?? 0n)
  }

  /** A ZTS deposit to a contract with no payload. */
  deposit(domainId: number, contractId: Hash, plasmaLimit: bigint, token: TokenStandard, amount: bigint): AccountBlockTemplate {
    return this.api.deposit(domainId, contractId, plasmaLimit, token, amount)
  }

  /** Buys `bytes` of storage. The fee is `bytes * znnPerByteOfState`. */
  buyStorage(domainId: number, contractId: Hash, bytes: bigint, znnPerByteOfState: bigint): AccountBlockTemplate {
    return this.api.buyStorage(domainId, contractId, bytes, bytes * znnPerByteOfState)
  }

  /** The zero address as `newOwner` renounces ownership. */
  transferOwnership(domainId: number, contractId: Hash, newOwner: Address): AccountBlockTemplate {
    return this.api.transferContractOwnership(domainId, contractId, newOwner)
  }

  /** Relays one withdrawal message of an accepted batch. Anyone may send it. */
  relayMessage(domainId: number, batchId: number, message: Uint8Array, inclusionProof: Uint8Array): AccountBlockTemplate {
    return this.api.relayMessage(domainId, BigInt(batchId), message, inclusionProof)
  }

  /** Releases the withdrawals whose delay has passed. Anyone may send it. */
  releaseWithdrawals(domainId: number): AccountBlockTemplate {
    return this.api.releaseWithdrawals(domainId)
  }

  // --- Administrator methods ---

  registerDomain(params: RegisterDomainParams): AccountBlockTemplate {
    return this.api.registerDomain(params)
  }

  setDomainConfig(domainId: number, withdrawalDelay: bigint, runtimeUpgradeDelay: bigint): AccountBlockTemplate {
    return this.api.setDomainConfig(domainId, withdrawalDelay, runtimeUpgradeDelay)
  }

  setAssetConfig(domainId: number, assetId: Hash, maxBatchWithdrawal: bigint): AccountBlockTemplate {
    return this.api.setAssetConfig(domainId, assetId, maxBatchWithdrawal)
  }

  setApprovedDAModes(domainId: number, modes: number[]): AccountBlockTemplate {
    return this.api.setApprovedDAModes(domainId, modes)
  }

  pause(domainId: number, isGlobal: boolean, scope: number, active: boolean): AccountBlockTemplate {
    return this.api.pause(domainId, isGlobal, scope, active)
  }

  initiateEscapeHatch(domainId: number): AccountBlockTemplate {
    return this.api.initiateEscapeHatch(domainId)
  }

  registerExecutor(pillarName: string, executorAddress: Address): AccountBlockTemplate {
    return this.api.registerExecutor(pillarName, executorAddress)
  }

  setPeripheryConfig(znnPerByteOfBytecode: bigint, znnPerByteOfState: bigint): AccountBlockTemplate {
    return this.api.setPeripheryConfig(znnPerByteOfBytecode, znnPerByteOfState)
  }
}
