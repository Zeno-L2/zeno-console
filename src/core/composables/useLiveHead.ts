import { computed, onScopeDispose, watch } from 'vue'
import type { Ref } from 'vue'
import { useDomainHeads } from './useDomainHeads'

/**
 * Follows a domain's head while the caller is mounted and returns it.
 * `onNewBatch` runs when the latest or pending batch of the same domain
 * changes. A status-only change does not call it.
 */
export function useLiveHead(domainId: Ref<number | null>, onNewBatch: () => void = () => undefined) {
  const { heads, follow } = useDomainHeads()
  const head = computed(() => (domainId.value === null ? null : (heads.value[domainId.value] ?? null)))

  let stop: (() => void) | null = null
  watch(
    domainId,
    (id) => {
      stop?.()
      stop = id === null ? null : follow(id)
    },
    { immediate: true }
  )
  onScopeDispose(() => stop?.())

  const key = computed(() => (head.value ? `${head.value.latest?.batchId ?? ''}/${head.value.pending?.batchId ?? ''}` : null))
  watch([domainId, key], ([id, next], [previousId, previous]) => {
    if (id === previousId && previous !== null && next !== null && next !== previous) onNewBatch()
  })

  return head
}
