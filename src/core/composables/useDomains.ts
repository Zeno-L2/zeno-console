import { computed, effectScope, ref, watch } from 'vue'
import type { SettlementDomainInfo } from 'znn-typescript-sdk'
import { SettlementService } from '../settlement-service'
import { useNetwork } from './useNetwork'
import { useSettings } from './useSettings'

const PAGE_SIZE = 100

// Module-level reactive state, shared across every useDomains() caller
const domains = ref<SettlementDomainInfo[]>([])
const isLoaded = ref(false)
const isLoading = ref(false)
const error = ref<string | null>(null)

// Only the latest load may write state, so a slow read of a previous node cannot overwrite it.
let requestId = 0
let watching = false

async function load() {
  const id = ++requestId
  isLoaded.value = false
  isLoading.value = true
  error.value = null
  try {
    const service = SettlementService.getInstance()
    const all: SettlementDomainInfo[] = []
    for (let page = 0; ; page++) {
      const result = await service.getDomains(page, PAGE_SIZE)
      all.push(...result.list)
      if (result.list.length === 0 || all.length >= result.count) break
    }
    if (id !== requestId) return
    domains.value = all
    isLoaded.value = true
  } catch (err) {
    if (id !== requestId) return
    error.value = err instanceof Error ? err.message : 'Failed to load the domains'
    console.error('Failed to load the domains:', err)
  } finally {
    if (id === requestId) isLoading.value = false
  }
}

/** Every registered domain, read from L1 a page of 100 at a time until `count`. */
export function useDomains() {
  const { settings } = useSettings()
  const network = useNetwork()

  if (!watching) {
    watching = true
    // A detached scope keeps the watch alive after its first caller unmounts.
    effectScope(true).run(() => {
      watch(
        () => network.currentNode.value,
        () => load()
      )
    })
  }

  /** The settings domain when L1 lists it, else the lowest registered id, else the settings domain. */
  const defaultDomainId = computed(() => {
    const ids = domains.value.map((d) => d.domainId)
    if (ids.includes(settings.value.domainId)) return settings.value.domainId
    return ids.length > 0 ? Math.min(...ids) : settings.value.domainId
  })

  return { domains, defaultDomainId, isLoaded, isLoading, error, load }
}
