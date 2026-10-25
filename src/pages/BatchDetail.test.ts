import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { DomainInconsistentError, UnknownDomainError } from 'zeno-client'
import { useDomainHeads } from '@/core'
import { altered, call } from '../../test/replay-client'
import type { RecordedCall } from '../../test/replay-client'
import { gatewayService, mountAt, useRecordedGateway, useRecordedSettlement } from '../../test/helpers'
import BatchDetail from './BatchDetail.vue'

/** A copy of `getBatch latest` at the params [1, 3]. */
const batch3 = (edit?: (result: Record<string, any>) => void): RecordedCall => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const source = edit ? altered('getBatch latest', edit) : call('getBatch latest')
  return { ...source, params: [1, 3] }
}

const routes = [{ path: '/batches/:domainId(\\d+)/:batchId(\\d+)', component: BatchDetail }]

async function render() {
  const mounted = await mountAt('/batches/1/3', routes)
  await vi.waitFor(() => expect(mounted.wrapper.find('[data-slot="batch-l1"], [data-slot="batch-missing"], [data-slot="batch-pending"], [data-slot="batch-l2"], [data-slot="verification-badge"]').exists()).toBe(true))
  await flushPromises()
  return mounted.wrapper
}

const badge = (w: Awaited<ReturnType<typeof render>>) => w.find('[data-slot="verification-badge"]')

describe('BatchDetail at /batches/1/3', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
  })

  it('shows Verified when both layers answer and the roots match Settlement', async () => {
    useRecordedGateway([batch3()])
    useRecordedSettlement()
    const w = await render()
    expect(badge(w).attributes('data-state')).toBe('verified')
    expect(w.find('[data-slot="batch-l1"]').exists()).toBe(true)
    expect(w.find('[data-slot="batch-l2"]').exists()).toBe(true)
    expect(w.find('[data-slot="batch-pending"]').exists()).toBe(false)
    expect(w.find('[data-slot="batch-unindexed"]').exists()).toBe(false)
    expect(w.text()).toContain('Batch 3')
    w.unmount()
  })

  it('shows Inconsistent and no commitments when a root differs from Settlement', async () => {
    useRecordedGateway([batch3((r) => { r.postStateRoot = '11'.repeat(32) })])
    useRecordedSettlement()
    const w = await render()
    expect(badge(w).attributes('data-state')).toBe('inconsistent')
    expect(w.text()).toContain('A check failed')
    expect(w.find('[data-slot="batch-l2"]').exists()).toBe(false)
    w.unmount()
  })

  it('shows the L1 fields and a note when the gateway answers NotFoundError', async () => {
    const missing: RecordedCall = { ...batch3(), response: { error: { code: -32004, message: 'batch 3 not found' } } }
    useRecordedGateway([missing])
    useRecordedSettlement()
    const w = await render()
    expect(w.find('[data-slot="batch-unindexed"]').text()).toContain('The gateway has not indexed this batch yet')
    expect(w.find('[data-slot="batch-l1"]').exists()).toBe(true)
    expect(w.find('[data-slot="batch-l2"]').exists()).toBe(false)
    expect(badge(w).exists()).toBe(false)
    w.unmount()
  })

  it('shows Pending when L1 returns null and the gateway batch is unverified', async () => {
    useRecordedGateway([batch3((r) => { r.verified = false })], async () => null)
    useRecordedSettlement({ 'embedded.settlement.getBatch': null })
    const w = await render()
    expect(w.find('[data-slot="batch-pending"]').text()).toContain('Settlement has not accepted batch 3 yet')
    expect(badge(w).attributes('data-state')).toBe('pending')
    expect(w.find('[data-slot="batch-l1"]').exists()).toBe(false)
    expect(w.find('[data-slot="batch-l2"]').exists()).toBe(true)
    w.unmount()
  })

  it('says there is no batch when neither layer has it', async () => {
    const missing: RecordedCall = { ...batch3(), response: { error: { code: -32004, message: 'batch 3 not found' } } }
    useRecordedGateway([missing])
    useRecordedSettlement({ 'embedded.settlement.getBatch': null })
    const w = await render()
    expect(w.find('[data-slot="batch-missing"]').text()).toContain('No batch 3 in domain 1')
    w.unmount()
  })

  it('shows Inconsistent on a verified batch when the domain head reports INCONSISTENT', async () => {
    useRecordedGateway([batch3(), { ...call('getHead'), response: { result: { ...(call('getHead').response.result as object), status: 'INCONSISTENT' } } }])
    useRecordedSettlement()
    const w = await render()
    await vi.waitFor(() => expect(badge(w).attributes('data-state')).toBe('inconsistent'))
    expect(w.find('[data-slot="inconsistent-banner"]').exists()).toBe(true)
    w.unmount()
  })

  it('links the gateway batch to the playground with the call behind it', async () => {
    useRecordedGateway([batch3()])
    useRecordedSettlement()
    const w = await render()
    const link = w.find('[data-slot="rpc-json"] a')
    expect(link.attributes('href')).toContain('/playground?method=zeno_getBatch&params=')
    expect(decodeURIComponent(link.attributes('href') ?? '')).toContain('[1,3]')
    w.unmount()
  })

  it('keeps the Settlement record and says the gateway does not serve the domain', async () => {
    useRecordedGateway([batch3()])
    vi.spyOn(gatewayService, 'client').mockResolvedValue({
      getBatch: async () => {
        throw new UnknownDomainError('unknown domain', -32001)
      },
    } as never)
    useRecordedSettlement()
    const w = await render()
    expect(w.find('[data-slot="batch-l1"]').exists()).toBe(true)
    expect(w.find('[data-slot="batch-l2-error"]').text()).toContain('does not serve domain 1')
    expect(w.find('[data-slot="batch-l2"]').exists()).toBe(false)
    w.unmount()
  })

  it('keeps the Settlement record and shows the banner when the gateway is inconsistent', async () => {
    useRecordedGateway([batch3()])
    vi.spyOn(gatewayService, 'client').mockResolvedValue({
      getBatch: async () => {
        throw new DomainInconsistentError('domain inconsistent', -32010)
      },
    } as never)
    useRecordedSettlement()
    const w = await render()
    expect(w.find('[data-slot="batch-l1"]').exists()).toBe(true)
    expect(w.find('[data-slot="inconsistent-banner"]').exists()).toBe(true)
    w.unmount()
  })
})
