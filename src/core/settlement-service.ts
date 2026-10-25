import { Address } from 'znn-typescript-sdk'
import type { AccountBlock, Hash, SettlementApi } from 'znn-typescript-sdk'
import type {
  SettlementAssetInfo,
  SettlementBatch,
  SettlementBatchList,
  SettlementDeployRecordList,
  SettlementDomainInfo,
  SettlementDomainInfoList,
  SettlementExecutorList,
  SettlementFeeInfo,
  SettlementPauseInfo,
  SettlementPeripheryConfig,
  SettlementReleaseQueue,
  SettlementTimeChallengeList,
} from 'znn-typescript-sdk'
import { DEFAULT_PAGE_SIZE } from '../config'
import { ChainService } from './chain-service'

/**
 * Reads Settlement's L1 state through the node's `embedded.settlement` RPC.
 * Before the Settlement spork activates every list is empty and a missing
 * record is null, so callers do not branch on the spork.
 */
export class SettlementService extends ChainService {
  private static instance: SettlementService | null = null

  static getInstance(): SettlementService {
    if (!SettlementService.instance) {
      SettlementService.instance = new SettlementService()
    }
    return SettlementService.instance
  }

  private async api(): Promise<SettlementApi> {
    await this.ensureInitialized()
    return this.zenon.embedded.settlement
  }

  async getDomain(domainId: number): Promise<SettlementDomainInfo | null> {
    return (await this.api()).getDomainInfo(domainId)
  }

  async getDomains(pageIndex = 0, pageSize = DEFAULT_PAGE_SIZE): Promise<SettlementDomainInfoList> {
    return (await this.api()).getAllDomains(pageIndex, pageSize)
  }

  async getBatch(domainId: number, batchId: number): Promise<SettlementBatch | null> {
    return (await this.api()).getBatch(domainId, batchId)
  }

  /** Newest first. */
  async getBatches(
    domainId: number,
    pageIndex = 0,
    pageSize = DEFAULT_PAGE_SIZE
  ): Promise<SettlementBatchList> {
    return (await this.api()).getBatches(domainId, pageIndex, pageSize)
  }

  async getDeployRecords(
    domainId: number,
    deployer: string,
    pageIndex = 0,
    pageSize = DEFAULT_PAGE_SIZE
  ): Promise<SettlementDeployRecordList> {
    return (await this.api()).getDeployRecordsByDeployer(
      domainId,
      Address.parse(deployer),
      pageIndex,
      pageSize
    )
  }

  async getPauseState(): Promise<SettlementPauseInfo> {
    return (await this.api()).getPauseState()
  }

  /** Null before the first `SetPeripheryConfig`. */
  async getPeripheryConfig(): Promise<SettlementPeripheryConfig | null> {
    return (await this.api()).getPeripheryConfig()
  }

  async getExecutorSet(): Promise<SettlementExecutorList> {
    return (await this.api()).getExecutorSet()
  }

  async getFeeInfo(): Promise<SettlementFeeInfo> {
    return (await this.api()).getFeeInfo()
  }

  async getAssetInfo(domainId: number, assetId: Hash): Promise<SettlementAssetInfo | null> {
    return (await this.api()).getAssetInfo(domainId, assetId)
  }

  async getReleaseQueue(
    domainId: number,
    pageIndex = 0,
    pageSize = DEFAULT_PAGE_SIZE
  ): Promise<SettlementReleaseQueue> {
    return (await this.api()).getReleaseQueue(domainId, pageIndex, pageSize)
  }

  async isOutboxProcessed(outboxId: Hash): Promise<boolean> {
    return (await this.api()).isOutboxProcessed(outboxId)
  }

  async getTimeChallenges(): Promise<SettlementTimeChallengeList> {
    return (await this.api()).getTimeChallengesInfo()
  }

  async getFrontierHeight(): Promise<number> {
    await this.ensureInitialized()
    return (await this.zenon.ledger.getFrontierMomentum()).height
  }

  /** The account block with this hash, or null when the node does not know it. */
  async getAccountBlock(hash: Hash): Promise<AccountBlock | null> {
    await this.ensureInitialized()
    return this.zenon.ledger.getAccountBlockByHash(hash)
  }
}
