import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import { DEFAULT_PAGE_SIZE } from '../../config'
import type { PageResult } from '../../types'

/**
 * Server-paginated list state. `fetchPage` receives the 0-based page index and
 * page size; changing either ref reloads the list.
 */
export function usePagedList<T>(
  fetchPage: (pageIndex: number, pageSize: number) => Promise<PageResult<T>>,
  errorMessage = 'Failed to load list'
) {
  const items = ref<T[]>([]) as Ref<T[]>
  const totalCount = ref(0)
  const pageIndex = ref(0)
  const pageSize = ref(DEFAULT_PAGE_SIZE)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Only the latest request may write state, so a slow earlier page cannot
  // overwrite a newer one.
  let requestId = 0

  async function load() {
    const id = ++requestId
    isLoading.value = true
    error.value = null
    try {
      const result = await fetchPage(pageIndex.value, pageSize.value)
      if (id !== requestId) return
      items.value = result.list
      totalCount.value = result.count
    } catch (err) {
      if (id !== requestId) return
      error.value = err instanceof Error ? err.message : errorMessage
      console.error(`${errorMessage}:`, err)
    } finally {
      if (id === requestId) isLoading.value = false
    }
  }

  /** Back to the first page with a single fetch (the page watcher covers a non-zero page). */
  function reset() {
    if (pageIndex.value === 0) {
      load()
    } else {
      pageIndex.value = 0
    }
  }

  watch([pageIndex, pageSize], load)

  return { items, totalCount, pageIndex, pageSize, isLoading, error, load, reset }
}
