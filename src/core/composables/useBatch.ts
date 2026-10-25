import { ref } from 'vue'
import type { Ref } from 'vue'
import {
  DomainInconsistentError,
  GatewayVerificationError,
  NotFoundError,
  UnknownDomainError,
} from 'zeno-client'
import type { Batch } from 'zeno-client'
import type { SettlementBatch } from 'znn-typescript-sdk'
import { GatewayService } from '../gateway-service'
import { SettlementService } from '../settlement-service'

/** One batch from both layers: Settlement's record and the gateway's roots and inputs. */
export function useBatch(domainId: Ref<number>, batchId: Ref<number>) {
  const l1 = ref<SettlementBatch | null>(null)
  const l2 = ref<(Batch & { check: { rootChecked: boolean } }) | null>(null)
  /** The gateway answered NotFoundError. */
  const l2Missing = ref(false)
  const failedCheck = ref(false)
  /** The text of a DomainInconsistentError, kept beside the data loaded before it. */
  const inconsistent = ref<string | null>(null)
  /** The gateway does not serve the domain, or cannot be reached for it. */
  const l2Error = ref<string | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  // Only the latest load may write state.
  let requestId = 0

  // The pair the refs hold. A different pair drops them, a reload of the same pair keeps them.
  let loaded: string | null = null

  async function load() {
    const id = ++requestId
    const domain = domainId.value
    const batch = batchId.value
    const key = `${domain}/${batch}`
    if (key !== loaded) {
      l1.value = null
      l2.value = null
      l2Missing.value = false
      loaded = key
    }
    isLoading.value = true
    error.value = null
    inconsistent.value = null
    l2Error.value = null
    failedCheck.value = false
    // Settle the layers apart so a gateway failure leaves the Settlement record.
    const [layer1, layer2] = await Promise.allSettled([
      SettlementService.getInstance().getBatch(domain, batch),
      GatewayService.getInstance()
        .client()
        .then((client) => client.getBatch(domain, batch)),
    ])
    if (id !== requestId) return
    if (layer1.status === 'fulfilled') l1.value = layer1.value
    else error.value = layer1.reason instanceof Error ? layer1.reason.message : 'The batch could not be read.'
    if (layer2.status === 'fulfilled') {
      l2.value = layer2.value
      l2Missing.value = false
    } else {
      const err = layer2.reason
      if (err instanceof NotFoundError) {
        l2.value = null
        l2Missing.value = true
      } else if (err instanceof DomainInconsistentError) inconsistent.value = err.message
      else if (err instanceof UnknownDomainError) l2Error.value = `This gateway does not serve domain ${domain}`
      else {
        failedCheck.value = err instanceof GatewayVerificationError
        if (!error.value) error.value = err instanceof Error ? err.message : 'The batch could not be read.'
      }
    }
    isLoading.value = false
  }

  return { l1, l2, l2Missing, failedCheck, inconsistent, l2Error, isLoading, error, load }
}
