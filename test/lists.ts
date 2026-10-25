import { expect, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import { call } from './replay-client'
import { useDomainHeads } from '@/core'

/** A gateway page. */
export const pageOf = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  domainId: 1,
  batchId: 3,
  verified: true,
  items,
  nextCursor: null,
  ...extra,
})

/** Waits until a list page shows a table, the unreached note or an alert. */
export async function settled(wrapper: VueWrapper) {
  await vi.waitFor(() =>
    expect(wrapper.find('[data-slot$="-table"], [data-slot="unreached"], [role="alert"]').exists()).toBe(true)
  )
}

/** Moves the polled head of domain 1 to `batchId`, as a poll that found a new batch would. */
export function advanceHead(batchId: number, status?: string) {
  const head = structuredClone(call('getHead').response.result) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  head.latest.batchId = batchId
  head.pending.batchId = batchId
  if (status) head.status = status
  useDomainHeads().heads.value = { ...useDomainHeads().heads.value, 1: head as never }
}

/** The pagination button with `label`. */
export const button = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)!
