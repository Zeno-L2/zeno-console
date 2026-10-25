import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { OutboxItem } from 'zeno-client'
import { WithdrawalReadService } from '../withdrawal-read-service'
import type { WithdrawalState } from '../withdrawal-read-service'
import { useWithdrawalStates } from './useWithdrawalStates'

const item = (outboxId: string): OutboxItem => ({ outboxId, kind: 'L1_WITHDRAWAL', verified: true }) as OutboxItem

function serve(statesOf: (domainId: number, items: OutboxItem[]) => Promise<Map<string, WithdrawalState>>) {
  const fn = vi.fn(statesOf)
  vi.spyOn(WithdrawalReadService, 'getInstance').mockReturnValue({ statesOf: fn } as never)
  return fn
}

describe('useWithdrawalStates', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads the states of the items it is given', async () => {
    const statesOf = serve(async () => new Map<string, WithdrawalState>([['a', 'queued']]))
    const items = ref([item('a')])
    const w = useWithdrawalStates(ref(2), items)
    await w.load()
    expect(statesOf).toHaveBeenCalledWith(2, items.value)
    expect(w.states.value.get('a')).toBe('queued')
    expect(w.error.value).toBeNull()
  })

  it('reloads when the items change', async () => {
    const statesOf = serve(async (_d, list) => new Map(list.map((i) => [i.outboxId, 'relayable' as const])))
    const items = ref<OutboxItem[]>([])
    const w = useWithdrawalStates(ref(1), items)
    items.value = [item('b')]
    await nextTick()
    await vi.waitFor(() => expect(w.states.value.get('b')).toBe('relayable'))
    expect(statesOf).toHaveBeenCalledTimes(1)
  })

  it('shows the error message and clears the states when the read fails', async () => {
    serve(async () => {
      throw new Error('node unreachable')
    })
    const w = useWithdrawalStates(ref(1), ref([item('a')]))
    w.states.value = new Map([['a', 'queued']])
    await w.load()
    expect(w.error.value).toBe('node unreachable')
    expect(w.states.value.size).toBe(0)
  })

  it('does not let a slow earlier read overwrite a newer one', async () => {
    let releaseSlow: (m: Map<string, WithdrawalState>) => void = () => undefined
    const statesOf = serve(async () => new Map())
    statesOf
      .mockImplementationOnce(() => new Promise((resolve) => (releaseSlow = resolve)))
      .mockImplementationOnce(async () => new Map<string, WithdrawalState>([['new', 'released']]))
    const w = useWithdrawalStates(ref(1), ref([item('x')]))
    const slow = w.load()
    await w.load()
    releaseSlow(new Map([['old', 'pending']]))
    await slow
    expect([...w.states.value.keys()]).toEqual(['new'])
  })
})
