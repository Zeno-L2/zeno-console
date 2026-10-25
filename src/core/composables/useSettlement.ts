import { ref } from 'vue'
import type {
  SettlementDomainInfo,
  SettlementExecutor,
  SettlementFeeInfo,
  SettlementPauseInfo,
  SettlementPeripheryConfig,
  SettlementTimeChallenge,
} from 'znn-typescript-sdk'
import { SettlementService } from '../settlement-service'

// Module-level reactive state, shared across every useSettlement() caller
const domains = ref<SettlementDomainInfo[]>([])
const pause = ref<SettlementPauseInfo | null>(null)
const periphery = ref<SettlementPeripheryConfig | null>(null)
const executors = ref<SettlementExecutor[]>([])
const fees = ref<SettlementFeeInfo | null>(null)
const challenges = ref<SettlementTimeChallenge[]>([])
const frontierHeight = ref(0)
const isLoading = ref(false)
const error = ref<string | null>(null)

export function useSettlement() {
  const service = SettlementService.getInstance()

  /** Loads the network-wide state and the domain list in one pass. */
  async function loadOverview() {
    isLoading.value = true
    error.value = null
    try {
      const [domainList, pauseInfo, prices, executorList, feeInfo, challengeList, height] =
        await Promise.all([
          service.getDomains(),
          service.getPauseState(),
          service.getPeripheryConfig(),
          service.getExecutorSet(),
          service.getFeeInfo(),
          service.getTimeChallenges(),
          service.getFrontierHeight(),
        ])
      domains.value = domainList.list
      pause.value = pauseInfo
      periphery.value = prices
      executors.value = executorList.list
      fees.value = feeInfo
      challenges.value = challengeList.list
      frontierHeight.value = height
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load Settlement state'
      console.error('Failed to load Settlement state:', err)
    } finally {
      isLoading.value = false
    }
  }

  return {
    domains,
    pause,
    periphery,
    executors,
    fees,
    challenges,
    frontierHeight,
    isLoading,
    error,
    loadOverview,
    refresh: loadOverview,
  }
}
