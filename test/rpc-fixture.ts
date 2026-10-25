import { SettlementApi } from 'znn-typescript-sdk'
import type { Client } from 'znn-typescript-sdk'
import type { IZenonService } from '../src/core/chain-service'
import fixture from './fixtures/settlement-rpc-go.json'

/**
 * The Settlement RPC results go-zenon recorded, keyed by method. The same
 * file backs znn-typescript-sdk's own specs.
 */
const RESULTS: Record<string, unknown> = {
  'embedded.settlement.getAllDomains': fixture.allDomains,
  'embedded.settlement.getDomainInfo': fixture.domainInfo,
  'embedded.settlement.getBatches': fixture.batches,
  'embedded.settlement.getBatch': fixture.batch,
  'embedded.settlement.getDeployRecordsByDeployer': fixture.deployRecords,
  'embedded.settlement.getPauseState': fixture.pauseState,
  'embedded.settlement.getPeripheryConfig': fixture.peripheryConfig,
  'embedded.settlement.getExecutorSet': fixture.executorSet,
  'embedded.settlement.getFeeInfo': fixture.feeInfo,
  'embedded.settlement.getAssetInfo': fixture.assetInfo,
  'embedded.settlement.getReleaseQueue': fixture.releaseQueue,
  'embedded.settlement.getTimeChallengesInfo': fixture.timeChallenges,
  'embedded.settlement.isOutboxProcessed': false,
}

export { fixture }

/** A ZenonService stand-in whose Settlement API answers from the recorded results. */
export function fakeZenonService(frontierHeight = 1000, overrides: Record<string, unknown> = {}) {
  const results = { ...RESULTS, ...overrides }
  const calls: { method: string; params: unknown[] }[] = []
  const client = {
    async sendRequest(method: string, params: unknown[] = []) {
      calls.push({ method, params })
      if (!(method in results)) throw new Error(`no recorded result for ${method}`)
      return results[method]
    },
  } as Client
  const settlementApi = new SettlementApi()
  settlementApi.setClient(client)
  const zenon = {
    embedded: { settlement: settlementApi },
    ledger: { getFrontierMomentum: async () => ({ height: frontierHeight }) },
  }
  const service: IZenonService = {
    getZenon: () => zenon as never,
    ensureInitialized: async () => undefined,
  }
  return { service, calls }
}
