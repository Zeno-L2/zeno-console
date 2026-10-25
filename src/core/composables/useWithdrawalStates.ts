import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { OutboxItem } from 'zeno-client'
import { WithdrawalReadService } from '../withdrawal-read-service'
import type { WithdrawalState } from '../withdrawal-read-service'

/** The withdrawal state of each L1 withdrawal in `items`, read from Settlement whenever they change. */
export function useWithdrawalStates(domainId: Ref<number>, items: Readonly<Ref<OutboxItem[]>>) {
  const states = ref(new Map<string, WithdrawalState>())
  const error = ref<string | null>(null)
  let requestId = 0

  async function load() {
    const id = ++requestId
    const domain = domainId.value
    const list = items.value
    try {
      const next = await WithdrawalReadService.getInstance().statesOf(domain, list)
      if (id !== requestId) return
      states.value = next
      error.value = null
    } catch (err) {
      if (id !== requestId) return
      states.value = new Map()
      error.value = err instanceof Error ? err.message : 'The withdrawal states could not be read.'
    }
  }

  watch(items, load)
  return { states, error, load }
}
