import { computed, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import type { Page } from 'zeno-client'
import { DEFAULT_PAGE_SIZE } from '@/config'

export const CURSOR_PAGE_SIZES = [10, 25, 50, 100]

/**
 * Cursor-paged list state. The gateway answers no totals, so the list keeps
 * one cursor per page it has shown. `fetchPage` receives the cursor of the
 * page (null for the first) and the page size.
 */
export function useCursorList<T>(
  fetchPage: (cursor: string | null, limit: number) => Promise<Page<T>>,
  errorMessage = 'Failed to load list'
) {
  /** The last page loaded, with its batchId (null when no batch has reached the tag) and verified. */
  const page = ref<Page<T> | null>(null) as Ref<Page<T> | null>
  const pageSize = ref(DEFAULT_PAGE_SIZE)
  // The cursor of each page shown, newest page last. The first page has a null cursor.
  const cursors = ref<(string | null)[]>([null])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  /** What the last failed load threw, for callers that tell error classes apart. */
  const cause = shallowRef<unknown>(null)

  const items = computed(() => page.value?.items ?? [])
  const pageNumber = computed(() => cursors.value.length)
  const hasNewer = computed(() => cursors.value.length > 1)
  // A short or empty page can still carry a cursor when the gateway cut it at its budget.
  const hasOlder = computed(() => (page.value?.nextCursor ?? null) !== null)

  // Only the latest request may write state, so a slow earlier page cannot overwrite a newer one.
  let requestId = 0

  async function show(stack: (string | null)[]) {
    const id = ++requestId
    isLoading.value = true
    error.value = null
    cause.value = null
    try {
      const result = await fetchPage(stack[stack.length - 1], pageSize.value)
      if (id !== requestId) return
      page.value = result
      cursors.value = stack
    } catch (err) {
      if (id !== requestId) return
      cause.value = err
      error.value = err instanceof Error ? err.message : errorMessage
      console.error(`${errorMessage}:`, err)
    } finally {
      if (id === requestId) isLoading.value = false
    }
  }

  /** Reloads the page on screen. */
  const load = () => show(cursors.value)

  /** Back to the first page. */
  const reset = () => show([null])

  /** Reloads the newest page when the reader is on it and no read is in flight. */
  function refresh() {
    if (!hasNewer.value && !isLoading.value) return load()
  }

  /** Drops the page and its cursors, then loads the first page. */
  function restart() {
    page.value = null
    cursors.value = [null]
    return reset()
  }

  /** One page toward the newest. */
  function newer() {
    if (hasNewer.value) return show(cursors.value.slice(0, -1))
  }

  /** One page toward the oldest. */
  function older() {
    const next = page.value?.nextCursor
    if (next) return show([...cursors.value, next])
  }

  watch(pageSize, reset)

  return { page, items, pageSize, pageNumber, hasNewer, hasOlder, isLoading, error, cause, load, reset, refresh, restart, newer, older }
}
