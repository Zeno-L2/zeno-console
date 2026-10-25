import { ref, shallowRef } from 'vue'
import { GatewayService } from '../gateway-service'
import { SettlementService } from '../settlement-service'
import type { Withdrawal } from '../withdrawal-read-service'
import { createWithdrawalService } from '../withdrawal-service'
import type { WithdrawalService } from '../withdrawal-service'

// Module-level reactive state, shared across every useWithdrawals() caller
const withdrawals = shallowRef<Withdrawal[]>([])
const more = ref(false)
const relayPaused = ref(false)
const isLoading = ref(false)
const busyId = ref<string | null>(null)
const isReleasing = ref(false)
const error = ref<string | null>(null)
const lastHash = ref<string | null>(null)

let service: WithdrawalService | null = null
// Only the latest load() call may write the list and the pause flag.
let loadRequest = 0
// The domain the rows on screen belong to.
let loadedDomainId: number | null = null

/** Replaces the live service. Tests use it. */
export function setWithdrawalService(next: WithdrawalService | null) {
  service = next
}

function withdrawalService(): WithdrawalService {
  if (!service) {
    const settlement = SettlementService.getInstance()
    service = createWithdrawalService({
      gateway: GatewayService.getInstance(),
      reads: {
        isOutboxProcessed: (id) => settlement.isOutboxProcessed(id),
        getReleaseQueue: (domainId, page, size) => settlement.getReleaseQueue(domainId, page, size),
        getPauseState: () => settlement.getPauseState(),
        getBatch: (domainId, batchId) => settlement.getBatch(domainId, batchId),
      },
    })
  }
  return service
}

/** The domain's withdrawals, or one recipient's, and the relay and release actions. */
export function useWithdrawals() {
  async function load(domainId: number, recipient: string | null) {
    const request = ++loadRequest
    error.value = null
    // Rows of another domain never stay on screen, where a Relay click would send them to this one.
    if (loadedDomainId !== domainId) {
      withdrawals.value = []
      more.value = false
      relayPaused.value = false
      loadedDomainId = domainId
    }
    isLoading.value = true
    try {
      const svc = withdrawalService()
      const list = await svc.list(domainId, recipient ?? undefined)
      const paused = await svc.relayPaused(domainId)
      if (request !== loadRequest) return
      withdrawals.value = list.withdrawals
      more.value = list.more
      relayPaused.value = paused
    } catch (err) {
      if (request !== loadRequest) return
      withdrawals.value = []
      more.value = false
      relayPaused.value = false
      error.value = err instanceof Error ? err.message : 'The withdrawals could not be read.'
    } finally {
      if (request === loadRequest) isLoading.value = false
    }
  }

  async function relay(domainId: number, outboxId: string) {
    error.value = null
    lastHash.value = null
    busyId.value = outboxId
    try {
      lastHash.value = await withdrawalService().relay(domainId, outboxId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'The relay failed.'
    } finally {
      busyId.value = null
    }
  }

  async function release(domainId: number) {
    error.value = null
    lastHash.value = null
    isReleasing.value = true
    try {
      lastHash.value = await withdrawalService().release(domainId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'The release failed.'
    } finally {
      isReleasing.value = false
    }
  }

  return { withdrawals, more, relayPaused, isLoading, busyId, isReleasing, error, lastHash, load, relay, release }
}
