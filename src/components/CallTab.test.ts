import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { ReceiptResult } from 'zeno-client'
import { h } from 'vue'
import { TooltipProvider } from 'nom-ui'
import { createMemoryHistory, createRouter } from 'vue-router'
import { setTrackerFactory } from '@/core'
import type { TxTrackerService } from '@/core'
import { CONTRACT_ID, connectWallet, disconnectWallet, iface, simulation, useSimulateGateway } from '@/core/composables/call-test-helpers'
import { useSettings } from '@/core/composables/useSettings'
import { result } from '../../test/replay-client'
import CallTab from './CallTab.vue'

const features = { upgrade: true, ownershipTransfer: true, storageQuota: true, payableCalls: true, deposits: true, nativeAddresses: false }

async function render(props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] })
  const wrapper = mount(
    {
      render: () =>
        h(TooltipProvider, null, () => h(CallTab, { domainId: 1, contractId: CONTRACT_ID, iface, features, tag: 'latest', ...props } as never)),
    },
    { global: { plugins: [router] } }
  )
  await flushPromises()
  return wrapper
}

const buttons = (w: ReturnType<typeof mount>) => w.findAll('button').map((b) => b.text())

describe('CallTab', () => {
  beforeEach(() => {
    useSimulateGateway()
  })
  afterEach(async () => {
    await disconnectWallet()
    setTrackerFactory(null)
    vi.restoreAllMocks()
  })

  it('selects the first method and offers Preview and Send for a method that writes', async () => {
    await connectWallet()
    const w = await render()
    expect(buttons(w)).toContain('Preview')
    expect(buttons(w)).toContain('Send')
    expect(w.text()).toContain('amount')
  })

  it('simulates in the domain it is given while the settings domain differs', async () => {
    const rig = useSimulateGateway()
    expect(useSettings().settings.value.domainId).toBe(1)
    const w = await render({ domainId: 2, iface: null })
    await w.find('#raw-payload').setValue('00')
    await w.findAll('button').find((b) => b.text() === 'Preview')?.trigger('click')
    await vi.waitFor(() => expect(rig.requests.length).toBeGreaterThan(0))
    expect(rig.requests[0].params[0]).toBe(2)
  })

  it('offers a raw payload field when there is no interface', async () => {
    const w = await render({ iface: null })
    expect(w.text()).toContain('Payload (hex)')
    expect(w.find('#raw-payload').exists()).toBe(true)
  })

  it('shows the preview result with its gas, return value and an unverified badge', async () => {
    await connectWallet()
    const w = await render()
    await w.find('#arg-amount').setValue('5')
    await w.findAll('button').find((b) => b.text() === 'Preview')?.trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="simulation"]').exists()).toBe(true))
    const sim = w.find('[data-slot="simulation"]')
    expect(sim.text()).toContain('SUCCESS')
    expect(sim.text()).toContain('4000')
    expect(sim.text()).toContain('9')
    expect(sim.find('[data-slot="verification-badge"]').attributes('data-state')).toBe('pending')
  })

  it('shows a simulated revert by name before anything is sent', async () => {
    const rig = useSimulateGateway()
    rig.answers.latest = simulation({ status: 'REVERT', abortCode: 1, returnData: '000000000000002a' })
    await connectWallet()
    const w = await render()
    await w.find('#arg-amount').setValue('5')
    await w.findAll('button').find((b) => b.text() === 'Preview')?.trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="simulation"]').exists()).toBe(true))
    const sim = w.find('[data-slot="simulation"]')
    expect(sim.text()).toContain('Overflow')
    expect(sim.text()).toContain('limit')
    expect(sim.text()).toContain('The call would fail')
    expect(buttons(w)).toContain('Send')
  })

  it('shows Read and no Send for a read-only method', async () => {
    await connectWallet()
    const w = await render({ iface: { ...iface, methods: [iface.methods[1]] } })
    expect(buttons(w)).toContain('Read')
    expect(buttons(w)).not.toContain('Send')
    await w.findAll('button').find((b) => b.text() === 'Read')?.trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="simulation"]').exists()).toBe(true))
    expect(w.find('[data-slot="simulation"]').text()).toContain('Result')
  })

  it('hides the deposit switch when the domain has no payable calls', async () => {
    await connectWallet()
    const w = await render({ features: { ...features, payableCalls: false } })
    expect(w.text()).not.toContain('Attach a deposit')
  })

  it('shows the deposit switch when the domain allows payable calls', async () => {
    await connectWallet()
    const w = await render()
    expect(w.text()).toContain('Attach a deposit')
  })

  it('shows the receipt check next to the sent call', async () => {
    setTrackerFactory(
      () =>
        ({
          follow: (_hash: string, onUpdate: (state: unknown) => void) => {
            onUpdate({
              sendHash: 'ab'.repeat(32),
              stage: 'received',
              receipt: result<ReceiptResult>('getReceipt success'),
              proof: { state: 'failed', reason: 'x' },
            })
            return () => undefined
          },
        }) as unknown as TxTrackerService
    )
    await connectWallet()
    const w = await render()
    await w.find('#arg-amount').setValue('5')
    await w.findAll('button').find((b) => b.text() === 'Send')?.trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="sent"]').exists()).toBe(true))
    const sent = w.find('[data-slot="sent"]')
    await vi.waitFor(() => expect(sent.find('[data-slot="receipt-check-failed"]').exists()).toBe(true))
    expect(sent.find('[data-slot="verification-badge"]').attributes('data-state')).toBe('inconsistent')
    expect(sent.text()).toContain('Gas used (unchecked)')
  })
})
