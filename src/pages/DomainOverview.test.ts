import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { Head } from 'zeno-client'
import { BLOCK_TIME_SECONDS } from '@/config'
import { GatewayService, useDomainHeads, useDomains } from '@/core'
import { call, emptyPage } from '../../test/replay-client'
import type { RecordedCall } from '../../test/replay-client'
import { gatewayService, mountAt, useFakeNode, useRecordedGateway, useRecordedSettlement } from '../../test/helpers'
import DomainOverview from './DomainOverview.vue'

const routes = [{ path: '/domains/:domainId(\\d+)', component: DomainOverview }]
const emptyQueue = { head: 0, tail: 0, count: 0, list: [] }

const head = (edit: (result: Record<string, any>) => void): RecordedCall => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const source = call('getHead')
  const result = structuredClone(source.response.result) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  edit(result)
  return { ...source, response: { result } }
}

async function render(domainId: number, extra: RecordedCall[] = []) {
  useFakeNode()
  useRecordedGateway([...extra, emptyPage('zeno_getInputs', { domainId, toBatch: 'latest', limit: 10 })])
  useRecordedSettlement({ 'embedded.settlement.getReleaseQueue': emptyQueue })
  await useDomains().load()
  await useDomainHeads().load(domainId)
  const { wrapper } = await mountAt(`/domains/${domainId}`, routes)
  await flushPromises()
  return wrapper
}

describe('DomainOverview', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
    useDomainHeads().errors.value = {}
  })

  it('shows the three heads with verified badges and the gateway description', async () => {
    const w = await render(1)
    const states = w.findAll('[data-slot="heads-panel"] [data-slot="verification-badge"]').map((b) => b.attributes('data-state'))
    expect(states.length).toBeGreaterThan(0)
    expect(states.every((s) => s === 'verified')).toBe(true)
    await vi.waitFor(() => expect(w.find('[data-slot="chain-info"]').exists()).toBe(true))
    expect(w.find('[data-slot="chain-info"]').text()).toContain('test')
    expect(w.find('[data-slot="chain-info"]').text()).toContain('WASM')
    w.unmount()
  })

  it('shows a pending badge for a head the gateway has not verified', async () => {
    const w = await render(1, [head((r) => { r.pending.verified = false })])
    expect(w.find('[data-slot="head-pending"] [data-slot="verification-badge"]').attributes('data-state')).toBe('pending')
    expect(w.find('[data-slot="head-latest"] [data-slot="verification-badge"]').attributes('data-state')).toBe('verified')
    w.unmount()
  })

  it('shows every head as inconsistent when the domain is INCONSISTENT', async () => {
    const w = await render(1, [head((r) => { r.status = 'INCONSISTENT' })])
    const states = w.findAll('[data-slot="heads-panel"] [data-slot="verification-badge"]').map((b) => b.attributes('data-state'))
    expect(states.length).toBeGreaterThan(0)
    expect(states.every((s) => s === 'inconsistent')).toBe(true)
    w.unmount()
  })

  it('shows None yet before the head has loaded', async () => {
    useFakeNode()
    useRecordedGateway([emptyPage('zeno_getInputs', { domainId: 1, toBatch: 'latest', limit: 10 })])
    useRecordedSettlement({ 'embedded.settlement.getReleaseQueue': emptyQueue })
    const { wrapper } = await mountAt('/domains/1', routes)
    expect(wrapper.find('[data-slot="heads-panel"]').text()).toContain('None yet')
    wrapper.unmount()
  })

  it('names a domain the gateway does not serve', async () => {
    const unknownInfo: RecordedCall = { ...call('error unknown domain'), method: 'zeno_chainInfo' }
    const w = await render(99, [unknownInfo])
    await vi.waitFor(() => expect(w.find('[data-slot="chain-info-error"]').exists()).toBe(true))
    expect(w.find('[data-slot="chain-info-error"]').text()).toContain('This gateway does not serve domain 99')
    w.unmount()
  })

  it('shows the Settlement domain card and the custody rows for a registered domain', async () => {
    const w = await render(3)
    expect(w.find('[data-slot="domain-card"]').exists()).toBe(true)
    await vi.waitFor(() => expect(w.find('[data-slot="custody-table"]').text()).toContain('ZNN'))
    w.unmount()
  })
})

const headOf = (batchId: number): Head => {
  const recorded = structuredClone(call('getHead').response.result) as Head
  return {
    ...recorded,
    domainId: 3,
    latest: { ...recorded.latest!, batchId },
    pending: { ...recorded.pending!, batchId },
    finalized: { ...recorded.latest!, batchId: batchId - 1 },
  }
}

/** Domain 3 with a hand-made gateway, so the batch and input reads can be counted. */
async function renderCounted(first: Head) {
  useFakeNode()
  const getInputs = vi.fn(async () => ({ batchId: 3, items: [], nextCursor: null, verified: true }))
  const info = vi.fn(async () => ({ networkName: 'test', chain_id: null, runtimeKind: 'WASM', profiles: [] }))
  vi.spyOn(gatewayService, 'client').mockResolvedValue({ getInputs, info } as never)
  vi.spyOn(GatewayService, 'getInstance').mockReturnValue(gatewayService)
  const { settlement } = useRecordedSettlement({ 'embedded.settlement.getReleaseQueue': emptyQueue })
  const getBatches = vi.spyOn(settlement, 'getBatches')
  await useDomains().load()
  useDomainHeads().heads.value = { 3: first }
  const { wrapper } = await mountAt('/domains/3', routes)
  await flushPromises()
  return { wrapper, getBatches, getInputs }
}

describe('DomainOverview latest batches and inputs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
    useDomainHeads().errors.value = {}
  })

  it('reloads the latest inputs and batches when latest.batchId changes', async () => {
    const { wrapper, getBatches, getInputs } = await renderCounted(headOf(7))
    const batchReads = getBatches.mock.calls.length
    const inputReads = getInputs.mock.calls.length
    expect(batchReads).toBeGreaterThan(0)
    expect(inputReads).toBeGreaterThan(0)

    useDomainHeads().heads.value = { 3: headOf(8) }
    await vi.waitFor(() => expect(getBatches.mock.calls.length).toBe(batchReads + 1))
    await vi.waitFor(() => expect(getInputs.mock.calls.length).toBe(inputReads + 1))
    wrapper.unmount()
  })

  it('does not reload on a status-only change to INCONSISTENT', async () => {
    const { wrapper, getBatches, getInputs } = await renderCounted(headOf(7))
    const batchReads = getBatches.mock.calls.length
    const inputReads = getInputs.mock.calls.length
    useDomainHeads().heads.value = { 3: { ...headOf(7), status: 'INCONSISTENT' } }
    await flushPromises()
    expect(getBatches.mock.calls.length).toBe(batchReads)
    expect(getInputs.mock.calls.length).toBe(inputReads)
    wrapper.unmount()
  })

  it('does not reload when only the pending batch changes', async () => {
    const { wrapper, getBatches, getInputs } = await renderCounted(headOf(7))
    const batchReads = getBatches.mock.calls.length
    const inputReads = getInputs.mock.calls.length
    const current = useDomainHeads().heads.value[3]
    useDomainHeads().heads.value = { 3: { ...current, pending: { ...current.pending!, batchId: 8 } } }
    await flushPromises()
    expect(getBatches.mock.calls.length).toBe(batchReads)
    expect(getInputs.mock.calls.length).toBe(inputReads)
    wrapper.unmount()
  })

  it('reloads when the first batch arrives after a head with no latest batch', async () => {
    const { wrapper, getBatches, getInputs } = await renderCounted({ ...headOf(7), latest: null })
    const batchReads = getBatches.mock.calls.length
    const inputReads = getInputs.mock.calls.length
    useDomainHeads().heads.value = { 3: headOf(1) }
    await vi.waitFor(() => expect(getBatches.mock.calls.length).toBe(batchReads + 1))
    await vi.waitFor(() => expect(getInputs.mock.calls.length).toBe(inputReads + 1))
    wrapper.unmount()
  })

  it('reloads the batches on a momentum tick', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const { wrapper, getBatches } = await renderCounted(headOf(7))
      const batchReads = getBatches.mock.calls.length
      useFakeNode(1001)
      await vi.advanceTimersByTimeAsync(BLOCK_TIME_SECONDS * 1000)
      await flushPromises()
      expect(getBatches.mock.calls.length).toBe(batchReads + 1)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
