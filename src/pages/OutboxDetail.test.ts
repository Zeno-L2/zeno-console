import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Hash } from 'znn-typescript-sdk'
import { WithdrawalReadService } from '@/core'
import type { WithdrawalReads } from '@/core'
import { useDomainHeads } from '@/core'
import { altered, result } from '../../test/replay-client'
import type { RecordedCall } from '../../test/replay-client'
import { advanceHead } from '../../test/lists'
import { gatewayService, mountAt, useRecordedGateway } from '../../test/helpers'
import OutboxDetail from './OutboxDetail.vue'

const routes = [{ path: '/outbox/:outboxId', component: OutboxDetail }]
const proof0 = result<Record<string, any>>('outbox getOutboxProof 0') // eslint-disable-line @typescript-eslint/no-explicit-any
const OUTBOX_ID = proof0.outboxId as string
const batch0 = result<Record<string, any>>('outbox getBatch') // eslint-disable-line @typescript-eslint/no-explicit-any

/** The Settlement entry for batch 0, built from the `outbox getBatch` result. */
const settlementEntry = (outboxRoot = batch0.outboxRoot as string) => ({ outboxRoot: Hash.parse(outboxRoot) })

/** The roots Settlement holds, as the gateway client reads them. */
const roots = async (_domain: number, batchId: number) => (batchId === 0 ? ({ ...settlementEntry(), ...rootsOf(batch0) } as never) : null)
const rootsOf = (b: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  preStateRoot: Hash.parse(b.preStateRoot),
  postStateRoot: Hash.parse(b.postStateRoot),
  inputRoot: Hash.parse(b.inputRoot),
  receiptRoot: Hash.parse(b.receiptRoot),
  eventRoot: Hash.parse(b.eventRoot),
  daHash: Hash.parse(b.daHash),
  isFinalized: false,
})

function serve(extra: RecordedCall[] = [], entry: { outboxRoot: Hash } | null = settlementEntry()) {
  useRecordedGateway(extra, roots)
  const getBatch = vi.fn(async () => entry)
  const reads: WithdrawalReads = {
    isOutboxProcessed: async () => false,
    getReleaseQueue: async () => ({ list: [] }),
    getPauseState: async () => ({ global: null, domains: [] }) as never,
    getBatch,
  }
  vi.spyOn(WithdrawalReadService, 'getInstance').mockReturnValue(new WithdrawalReadService({ gateway: gatewayService, reads }))
  return getBatch
}

async function render(id = OUTBOX_ID) {
  const { wrapper } = await mountAt(`/outbox/${id}`, routes)
  await vi.waitFor(() =>
    expect(wrapper.find('[data-slot="proof-match"], [data-slot="proof-pending"], [data-slot="proof-error"], [role="alert"]').exists()).toBe(true)
  )
  await flushPromises()
  return wrapper
}

const badge = (w: Awaited<ReturnType<typeof render>>) => w.find('[data-slot="verification-badge"]')

describe('OutboxDetail', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
  })

  it('says the proof matches the root Settlement recorded, with a verified badge', async () => {
    const getBatch = serve()
    const w = await render()
    expect(w.find('[data-slot="proof-match"]').text()).toContain('matches the outbox root Settlement recorded for batch 0')
    expect(badge(w).attributes('data-state')).toBe('verified')
    expect(getBatch).toHaveBeenCalledWith(1, 0)
    expect(w.find('[data-slot="proof-error"]').exists()).toBe(false)
    expect(w.find('a[href="/batches/1/0"]').exists()).toBe(true)
    expect(w.text()).toContain('L2_DELIVERY')
    w.unmount()
  })

  it('shows the OutboxProofError text and a failed badge for a tampered proof', async () => {
    const tampered = altered('outbox getOutboxProof 0', (r) => {
      r.inclusionProof = (r.inclusionProof as string).replace(/.$/, (c: string) => (c === '0' ? '1' : '0'))
    })
    serve([tampered])
    const w = await render()
    expect(w.find('[data-slot="proof-error"]').text()).toContain('does not rebuild the outbox root the gateway named')
    expect(badge(w).attributes('data-state')).toBe('inconsistent')
    expect(w.find('[data-slot="proof-match"]').exists()).toBe(false)
    expect(w.find('[data-slot="proof-pending"]').exists()).toBe(false)
    w.unmount()
  })

  it('shows the OutboxProofError text when Settlement holds a different root', async () => {
    serve([], settlementEntry('11'.repeat(32)))
    const w = await render()
    expect(w.find('[data-slot="proof-error"]').text()).toContain('does not match the one Settlement recorded')
    expect(w.find('[data-slot="proof-match"]').exists()).toBe(false)
    w.unmount()
  })

  it('shows Pending with the Settlement note and no error for verified: false', async () => {
    const pending = altered('outbox getOutboxProof 0', (r) => {
      r.verified = false
    })
    const getBatch = serve([pending], null)
    const w = await render()
    expect(w.find('[data-slot="proof-pending"]').text()).toContain('Settlement has not accepted batch 0 yet')
    expect(badge(w).attributes('data-state')).toBe('pending')
    expect(w.find('[data-slot="proof-error"]').exists()).toBe(false)
    expect(w.find('[role="alert"].text-destructive').exists()).toBe(false)
    expect(getBatch).not.toHaveBeenCalled()
    w.unmount()
  })

  it('still fails a tampered proof of a pending batch', async () => {
    const pendingTampered = altered('outbox getOutboxProof 0', (r) => {
      r.verified = false
      r.outboxRoot = '00'.repeat(32)
    })
    serve([pendingTampered], null)
    const w = await render()
    expect(w.find('[data-slot="proof-error"]').exists()).toBe(true)
    expect(w.find('[data-slot="proof-pending"]').exists()).toBe(false)
    w.unmount()
  })

  it('drops a stale pending note when a reload fails the proof check', async () => {
    const pending = altered('outbox getOutboxProof 0', (r) => {
      r.verified = false
    })
    serve([pending], null)
    const w = await render()
    expect(w.find('[data-slot="proof-pending"]').exists()).toBe(true)
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    serve([], settlementEntry('11'.repeat(32)))
    advanceHead(9)
    await vi.waitFor(() => expect(w.find('[data-slot="proof-error"]').exists()).toBe(true))
    expect(w.find('[data-slot="proof-pending"]').exists()).toBe(false)
    expect(w.find('[data-slot="proof-match"]').exists()).toBe(false)
    w.unmount()
  })

  it('drops a stale match note when a reload fails the proof check', async () => {
    serve()
    const w = await render()
    expect(w.find('[data-slot="proof-match"]').exists()).toBe(true)
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    serve([], settlementEntry('11'.repeat(32)))
    advanceHead(9)
    await vi.waitFor(() => expect(w.find('[data-slot="proof-error"]').exists()).toBe(true))
    expect(w.find('[data-slot="proof-match"]').exists()).toBe(false)
    w.unmount()
  })

  it('shows the inconsistent banner and badge when the domain head is INCONSISTENT', async () => {
    serve([altered('getHead', (r) => { r.status = 'INCONSISTENT' })])
    const w = await render()
    await vi.waitFor(() => expect(w.find('[data-slot="inconsistent-banner"]').exists()).toBe(true))
    expect(badge(w).attributes('data-state')).toBe('inconsistent')
    w.unmount()
  })

  it('says no outbox message has the id when the gateway does not know it', async () => {
    serve()
    const w = await render('0'.repeat(64))
    expect(w.text()).toContain('No outbox message has this id')
    expect(w.find('[data-slot="proof-match"]').exists()).toBe(false)
    w.unmount()
  })

  it('rejects an id that is not 64 hex characters and reads nothing', async () => {
    serve()
    const checkProof = vi.spyOn(WithdrawalReadService.getInstance(), 'checkProof')
    const { wrapper } = await mountAt('/outbox/xyz', routes)
    await flushPromises()
    expect(wrapper.text()).toContain('Not an outbox id')
    expect(checkProof).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps the recorded call behind the page in the playground link', async () => {
    serve()
    const w = await render()
    const href = w.find('[data-slot="rpc-json"] a').attributes('href') ?? ''
    expect(href).toContain('method=zeno_getOutboxProof')
    expect(decodeURIComponent(href)).toContain(OUTBOX_ID)
    w.unmount()
  })
})
