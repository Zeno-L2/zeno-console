import { ref } from 'vue'
import { settlement, QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import type { Hash, SettlementAssetInfo } from 'znn-typescript-sdk'
import { SettlementService } from '../settlement-service'

const QUEUE_PAGE_SIZE = 100

export interface CustodyRow {
  domainId: number
  assetId: string
  zts: string
  info: SettlementAssetInfo
  /** Entries in the domain's release queue that pay out this asset. */
  queueDepth: number
}

/** Counts the domain's release queue entries per asset, a page of 100 at a time. */
async function queueCounts(service: SettlementService, domainId: number) {
  const assets = new Map<string, { id: Hash; count: number }>()
  for (let page = 0; ; page++) {
    const queue = await service.getReleaseQueue(domainId, page, QUEUE_PAGE_SIZE)
    for (const entry of queue.list) {
      const key = entry.assetId.toString()
      const seen = assets.get(key)
      if (seen) seen.count++
      else assets.set(key, { id: entry.assetId, count: 1 })
    }
    if (queue.list.length < QUEUE_PAGE_SIZE) return assets
  }
}

async function domainRows(service: SettlementService, domainId: number): Promise<CustodyRow[]> {
  const counts = await queueCounts(service, domainId)
  const wanted = new Map<string, Hash>()
  for (const zts of [ZNN_ZTS, QSR_ZTS]) {
    const id = settlement.assetIdFromZts(zts)
    wanted.set(id.toString(), id)
  }
  for (const [key, { id }] of counts) wanted.set(key, id)

  const rows = await Promise.all(
    [...wanted].map(async ([key, id]): Promise<CustodyRow | null> => {
      const info = await service.getAssetInfo(domainId, id)
      if (!info) return null
      return {
        domainId,
        assetId: key,
        zts: settlement.ztsFromAssetId(id).toString(),
        info,
        queueDepth: counts.get(key)?.count ?? 0,
      }
    })
  )
  return rows.filter((row): row is CustodyRow => row !== null)
}

/** The custody Settlement holds per domain and asset, with the release queue depth. */
export function useCustody() {
  const rows = ref<CustodyRow[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  // Only the latest load may write state.
  let requestId = 0

  async function load(domainIds: number[]) {
    const id = ++requestId
    isLoading.value = true
    error.value = null
    try {
      const service = SettlementService.getInstance()
      const perDomain = await Promise.all(domainIds.map((d) => domainRows(service, d)))
      if (id !== requestId) return
      rows.value = perDomain.flat()
    } catch (err) {
      if (id !== requestId) return
      error.value = err instanceof Error ? err.message : 'Failed to load custody'
      console.error('Failed to load custody:', err)
    } finally {
      if (id === requestId) isLoading.value = false
    }
  }

  return { rows, isLoading, error, load }
}
