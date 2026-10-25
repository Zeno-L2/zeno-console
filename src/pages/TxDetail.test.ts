import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Address } from 'znn-typescript-sdk'
import { NotFoundError } from 'zeno-client'
import type { ReceiptResult } from 'zeno-client'
import { InterfaceResolver, TxTrackerService, setTrackerFactory } from '@/core'
import { useDomainHeads } from '@/core'
import { altered, finalizeSend, result } from '../../test/replay-client'
import type { RecordedCall } from '../../test/replay-client'
import { MissingSendError, NODE_BEHIND_LIMIT_MS } from '@/core/tx-tracker-service'
import { gatewayService, mountAt, useRecordedGateway } from '../../test/helpers'
import TxDetail from './TxDetail.vue'

const routes = [{ path: '/tx/:sendHash', component: TxDetail }]
const SEND = '04ee000000000000000000000000000000000000000000000000000000000000'
const receipt = result<ReceiptResult>('getReceipt success')
const BUNDLE = '0d7757801dd818f86159d336c7111e0329e734fa51a4b37b7c23d50345ae6cb6'

const noInterface = () =>
  vi.spyOn(InterfaceResolver, 'getInstance').mockReturnValue({ forContract: vi.fn(async () => null), eventNames: async () => new Map() } as never)

/** A tracker over the given gateway whose poll never wakes on its own. */
function tracker(
  gateway: ConstructorParameters<typeof TxTrackerService>[0]['gateway'],
  block: { received: boolean } | null = { received: true },
  deps: Partial<ConstructorParameters<typeof TxTrackerService>[0]> = {}
) {
  setTrackerFactory(
    () =>
      new TxTrackerService({
        ledger: { getSend: async () => block && { createsInput: true, ...block } },
        gateway,
        sleep: () => new Promise<void>(() => undefined),
        pollIntervalMs: 5000,
        ...deps,
      })
  )
}

async function render(url = `/tx/${SEND}`) {
  const { wrapper } = await mountAt(url, routes)
  await vi.waitFor(() => expect(wrapper.find('[data-slot="receipt-view"], [role="alert"]').exists()).toBe(true))
  await flushPromises()
  return wrapper
}

describe('TxDetail', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setTrackerFactory(null)
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
  })

  it('shows the five stages and the recorded receipt with a verified badge', async () => {
    useRecordedGateway()
    noInterface()
    tracker(gatewayService)
    const w = await render()
    for (const title of ['Published', 'Received', 'Executed', 'Submitted', 'Finalized']) expect(w.text()).toContain(title)
    expect(w.text()).toContain('SUCCESS')
    expect(w.find('[data-slot="receipt-view"] [data-slot="verification-badge"]').attributes('data-state')).toBe('verified')
    expect(w.text()).toContain('Batch 0')
    expect(w.find('[data-slot="receipt-check-failed"]').exists()).toBe(false)
    expect(w.find('[data-slot="receipt-check-waiting"]').exists()).toBe(false)
    expect(w.text()).not.toContain('(unchecked)')
    expect(w.find('a[href="/batches/1/0"]').exists()).toBe(true)
    expect(w.find(`a[href="/address/${receipt.sender}?domain=1"]`).exists()).toBe(true)
    w.unmount()
  })

  it('shows a pending badge for a receipt the gateway has not verified', async () => {
    const unverified: RecordedCall = altered('getReceipt success', (r) => {
      r.verified = false
      r.tag = 'pending'
    })
    useRecordedGateway([unverified])
    noInterface()
    tracker(gatewayService)
    const w = await render()
    expect(w.find('[data-slot="receipt-view"] [data-slot="verification-badge"]').attributes('data-state')).toBe('pending')
    expect(w.text()).toContain('Gas used (unchecked)')
    expect(w.text()).toContain('SUCCESS (unchecked)')
    expect(w.text()).toContain('read at pending (unchecked)')
    expect(w.text()).not.toContain('Domain (unchecked)')
    expect(w.text()).not.toContain('Sender (unchecked)')
    w.unmount()
  })

  it('shows an inconsistent badge and the banner when the domain head is INCONSISTENT', async () => {
    const head: RecordedCall = altered('getHead', (r) => {
      r.status = 'INCONSISTENT'
    })
    useRecordedGateway([head])
    noInterface()
    tracker(gatewayService)
    const w = await render()
    await vi.waitFor(() => expect(w.find('[data-slot="inconsistent-banner"]').exists()).toBe(true))
    expect(w.find('[data-slot="receipt-view"] [data-slot="verification-badge"]').attributes('data-state')).toBe('inconsistent')
    w.unmount()
  })

  it('resolves the interface by the receipt domain and contract', async () => {
    const other = { ...structuredClone(receipt), domainId: 7 } as ReceiptResult
    useRecordedGateway()
    const get = vi.fn(async () => null)
    vi.spyOn(InterfaceResolver, 'getInstance').mockReturnValue({ forContract: get, eventNames: async () => new Map() } as never)
    tracker({
      client: async () => ({ getReceipt: async () => other, verifyReceipt: async () => true, subscribe: async () => { throw new Error('http') } }),
    } as never)
    const w = await render()
    expect(get).toHaveBeenCalledWith(7, receipt.receipt.contractId)
    expect(w.find('a[href="/batches/7/0"]').exists()).toBe(true)
    w.unmount()
  })

  it('shows the stages and no receipt before the gateway has executed the send', async () => {
    useRecordedGateway()
    noInterface()
    tracker(
      {
        client: async () => ({
          getReceipt: async () => {
            throw new NotFoundError('not found', -32004)
          },
          subscribe: async () => {
            throw new Error('http')
          },
        }),
      } as never,
      { received: false }
    )
    const { wrapper } = await mountAt(`/tx/${SEND}`, routes)
    await flushPromises()
    expect(wrapper.text()).toContain('Published')
    expect(wrapper.find('[data-slot="receipt-view"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('rejects an id that is not 64 hex characters and reads nothing', async () => {
    const getReceipt = vi.fn()
    tracker({ client: async () => ({ getReceipt, subscribe: async () => undefined }) } as never)
    const { wrapper } = await mountAt('/tx/not-a-hash', routes)
    await flushPromises()
    expect(wrapper.text()).toContain('Not a send hash')
    expect(wrapper.find('[data-slot="receipt-view"]').exists()).toBe(false)
    expect(getReceipt).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('accepts an upper-case hash by reading it as lower case', async () => {
    useRecordedGateway()
    noInterface()
    tracker(gatewayService)
    const w = await render(`/tx/${SEND.toUpperCase()}`)
    expect(w.find('[data-slot="receipt-view"]').exists()).toBe(true)
    w.unmount()
  })

  describe('receipt check', () => {
    const step = (w: Awaited<ReturnType<typeof render>>) => w.find('li[aria-current="step"]').text()
    const badge = (w: Awaited<ReturnType<typeof render>>) =>
      w.find('[data-slot="receipt-view"] [data-slot="verification-badge"]').attributes('data-state')
    const alertOf = (w: Awaited<ReturnType<typeof render>>, slot: string) => w.find(`[data-slot="${slot}"]`)
    const run = async (
      extra: RecordedCall[] = [],
      roots?: Parameters<typeof useRecordedGateway>[1],
      sends?: Parameters<typeof useRecordedGateway>[2],
      url?: string,
      deps?: Parameters<typeof tracker>[2]
    ) => {
      useRecordedGateway(extra, roots, sends)
      noInterface()
      tracker(gatewayService, undefined, deps)
      return render(url)
    }

    it('fails a tampered receipt and stays at the node stage', async () => {
      const w = await run([altered('getReceipt success', (r) => { r.receipt.gasUsed = 1 })])
      expect(badge(w)).toBe('inconsistent')
      expect(alertOf(w, 'receipt-check-failed').text()).toContain('gasUsed')
      expect(step(w)).toContain('Executed')
      expect(w.text()).toContain('Sender (unchecked)')
      w.unmount()
    })

    it('fails a receipt the gateway returns for another send', async () => {
      const other = '05ee' + '0'.repeat(60)
      const swapped = { ...altered('getReceipt success', (r) => { r.sendHash = other }), params: [other] }
      const w = await run([swapped], undefined, async () => finalizeSend(1), `/tx/${other}`)
      expect(alertOf(w, 'receipt-check-failed').text()).toContain("does not hash to the leaf's inputHash")
      w.unmount()
    })

    it('waits when the sidecar is missing', async () => {
      const missing: RecordedCall = {
        name: 'sidecar missing',
        method: 'zeno_getReceiptSidecar',
        params: [BUNDLE],
        response: { error: { code: -32004, message: 'sidecar not found' } },
      }
      const w = await run([missing])
      expect(badge(w)).toBe('pending')
      expect(alertOf(w, 'receipt-check-waiting').text()).toContain("did not serve batch 0's receipt data")
      expect(alertOf(w, 'receipt-check-failed').exists()).toBe(false)
      expect(w.text()).toContain('Gas used (unchecked)')
      expect(w.text()).not.toContain('Domain (unchecked)')
      w.unmount()
    })

    it('fails when the sidecar is still missing after the limit', async () => {
      const missing: RecordedCall = {
        name: 'sidecar missing',
        method: 'zeno_getReceiptSidecar',
        params: [BUNDLE],
        response: { error: { code: -32004, message: 'sidecar not found' } },
      }
      // The first poll ends at once and the second reads the clock 2 minutes later.
      let polls = 0
      let reads = 0
      const w = await run([missing], undefined, undefined, undefined, {
        now: () => reads++ * NODE_BEHIND_LIMIT_MS,
        sleep: () => (polls++ === 0 ? Promise.resolve() : new Promise<void>(() => undefined)),
      })
      await vi.waitFor(() => expect(alertOf(w, 'receipt-check-failed').exists()).toBe(true))
      expect(alertOf(w, 'receipt-check-failed').text()).toContain("still has not served batch 0's receipt data")
      expect(badge(w)).toBe('inconsistent')
      w.unmount()
    })

    it('marks only the tag unchecked for a finalized receipt held at submitted', async () => {
      const finalized = altered('getReceipt success', (r) => {
        r.tag = 'finalized'
      })
      const w = await run([finalized])
      expect(step(w)).toContain('Finalized')
      expect(alertOf(w, 'receipt-check-waiting').text()).toContain('as finalized')
      expect(badge(w)).toBe('pending')
      expect(w.text()).not.toContain('Gas used (unchecked)')
      expect(w.text()).not.toContain('Batch 0 (unchecked)')
      expect(w.text()).toContain('read at finalized (unchecked)')
      expect(w.text()).not.toContain('SUCCESS (unchecked)')
      w.unmount()
    })

    it('waits when Settlement lacks the batch', async () => {
      const w = await run([], async () => null)
      expect(badge(w)).toBe('pending')
      expect(alertOf(w, 'receipt-check-waiting').text()).toContain('no batch 0 for domain 1')
      expect(step(w)).toContain('Executed')
      expect(w.text()).toContain('Gas used (unchecked)')
      expect(w.text()).toContain('Batch 0 (unchecked)')
      expect(w.text()).not.toContain('Domain (unchecked)')
      expect(w.text()).not.toContain('Sender (unchecked)')
      expect(w.find('a[href^="/address/"]').text()).toBe('Sender')
      w.unmount()
    })

    it('fails when the node send targets another domain', async () => {
      const w = await run([], undefined, async () => finalizeSend(2))
      expect(alertOf(w, 'receipt-check-failed').text()).toContain('calls domain 2')
      w.unmount()
    })

    it('fails when the node send is from another account', async () => {
      const address = Address.parse('z1qq6eg8n43g032hanpsfp02qcdmv7zfj3y2lt5d')
      const w = await run([], undefined, async () => ({ ...finalizeSend(1), address }))
      expect(alertOf(w, 'receipt-check-failed').text()).toContain(address.toString())
      expect(w.find('a[href^="/address/"]').text()).toBe('Sender (unchecked)')
      w.unmount()
    })

    it('waits when the node does not show the send', async () => {
      const w = await run([], undefined, async () => {
        throw new MissingSendError()
      })
      expect(alertOf(w, 'receipt-check-waiting').text()).toContain('does not show this send')
      expect(w.text()).toContain('Domain (unchecked)')
      expect(w.text()).toContain('Sender (unchecked)')
      w.unmount()
    })
  })
})
