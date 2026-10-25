import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { Head } from 'zeno-client'
import { GatewayService } from '../gateway-service'
import { call } from '../../../test/replay-client'
import { useDomainHeads } from './useDomainHeads'
import { useLiveHead } from './useLiveHead'

const recorded = () => structuredClone(call('getHead').response.result) as Head

const withBatch = (batchId: number, domainId = 1): Head => {
  const head = recorded()
  return {
    ...head,
    domainId,
    latest: { ...head.latest!, batchId },
    pending: { ...head.pending!, batchId },
  }
}

/** Serves the head the test holds, so the poll and the test agree. */
function serveHeads(current: Record<number, Head>) {
  const getHead = vi.fn(async (domainId: number) => current[domainId])
  vi.spyOn(GatewayService, 'getInstance').mockReturnValue({ getHead } as never)
  return getHead
}

describe('useLiveHead', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useDomainHeads().heads.value = {}
    useDomainHeads().errors.value = {}
  })

  it('returns the head of the followed domain once the poll answers', async () => {
    serveHeads({ 1: withBatch(3) })
    const scope = effectScope()
    const head = scope.run(() => useLiveHead(ref(1)))!
    expect(head.value).toBeNull()
    await vi.waitFor(() => expect(head.value?.latest?.batchId).toBe(3))
    scope.stop()
  })

  it('returns null without a domain', () => {
    const getHead = serveHeads({})
    const scope = effectScope()
    const head = scope.run(() => useLiveHead(ref(null)))!
    expect(head.value).toBeNull()
    expect(getHead).not.toHaveBeenCalled()
    scope.stop()
  })

  it('calls back when the latest batch of the same domain changes, and not for the first head', async () => {
    serveHeads({ 1: withBatch(3) })
    const onNewBatch = vi.fn()
    const scope = effectScope()
    scope.run(() => useLiveHead(ref(1), onNewBatch))
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    await nextTick()
    expect(onNewBatch).not.toHaveBeenCalled()
    useDomainHeads().heads.value = { 1: withBatch(4) }
    await nextTick()
    expect(onNewBatch).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('calls back when only the pending batch changes', async () => {
    serveHeads({ 1: withBatch(3) })
    const onNewBatch = vi.fn()
    const scope = effectScope()
    scope.run(() => useLiveHead(ref(1), onNewBatch))
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    const head = useDomainHeads().heads.value[1]
    useDomainHeads().heads.value = { 1: { ...head, pending: { ...head.pending!, batchId: 4 } } }
    await nextTick()
    expect(onNewBatch).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('does not call back for a status-only change', async () => {
    serveHeads({ 1: withBatch(3) })
    const onNewBatch = vi.fn()
    const scope = effectScope()
    scope.run(() => useLiveHead(ref(1), onNewBatch))
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    useDomainHeads().heads.value = { 1: { ...useDomainHeads().heads.value[1], status: 'INCONSISTENT' } }
    await nextTick()
    expect(onNewBatch).not.toHaveBeenCalled()
    scope.stop()
  })

  it('does not call back when the domain itself changes', async () => {
    serveHeads({ 1: withBatch(3), 2: withBatch(8, 2) })
    const onNewBatch = vi.fn()
    const domainId = ref(1)
    const scope = effectScope()
    scope.run(() => useLiveHead(domainId, onNewBatch))
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    domainId.value = 2
    await vi.waitFor(() => expect(useDomainHeads().heads.value[2]).toBeDefined())
    await nextTick()
    expect(onNewBatch).not.toHaveBeenCalled()
    scope.stop()
  })

  it('stops following when its scope ends', async () => {
    const getHead = serveHeads({ 1: withBatch(3) })
    vi.useFakeTimers()
    const scope = effectScope()
    scope.run(() => useLiveHead(ref(1)))
    await vi.advanceTimersByTimeAsync(0)
    const calls = getHead.mock.calls.length
    scope.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getHead.mock.calls.length).toBe(calls)
    vi.useRealTimers()
  })
})
