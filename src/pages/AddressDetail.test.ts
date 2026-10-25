import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { WithdrawalReadService } from '@/core'
import { useDomainHeads, useDomains } from '@/core'
import { result } from '../../test/replay-client'
import { mountAt, useFakeClient } from '../../test/helpers'
import AddressDetail from './AddressDetail.vue'
import DomainSelect from '@/components/DomainSelect.vue'

const routes = [{ path: '/address/:address', component: AddressDetail }]
const ADDRESS = 'z16yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqvrvjf7'

const inputs = result<{ items: unknown[] }>('getInputs by contract')
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  domainId: 1,
  batchId: 3,
  verified: true,
  items,
  nextCursor: null,
  ...extra,
})
const outboxItem = (outboxId: string, verified = true) => ({
  batchId: 3,
  verified,
  outboxId,
  sourceContract: 'c0'.padEnd(64, '0'),
  inputIndex: 1,
  outboxIndex: 0,
  kind: 'L1_WITHDRAWAL',
  targetContract: null,
  recipient: ADDRESS,
  assetId: null,
  amount: '5',
  payload: '',
})

function serve(over: Record<string, unknown> = {}) {
  vi.spyOn(WithdrawalReadService, 'getInstance').mockReturnValue({
    statesOf: async (_d: number, items: { outboxId: string }[]) => new Map(items.map((i) => [i.outboxId, 'pending'])),
  } as never)
  return useFakeClient({
    getInputs: vi.fn(async () => page(inputs.items.slice(0, 2))),
    getOutbox: vi.fn(async () => page([outboxItem('aa'.repeat(32), false)])),
    ...over,
  })
}

async function render(url: string) {
  const mounted = await mountAt(url, routes)
  await vi.waitFor(() => expect(mounted.wrapper.find('[data-slot="input-table"], [data-slot="unreached"], [role="alert"]').exists()).toBe(true))
  await flushPromises()
  return mounted
}

describe('AddressDetail', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
    useDomains().domains.value = []
  })

  it('sends the address as sender and as recipient for the default domain', async () => {
    const client = serve()
    const { wrapper } = await render(`/address/${ADDRESS}`)
    expect(client.getInputs).toHaveBeenCalledWith(expect.objectContaining({ domainId: 1, sender: ADDRESS, toBatch: 'latest' }))
    expect(client.getOutbox).toHaveBeenCalledWith(expect.objectContaining({ domainId: 1, recipient: ADDRESS, toBatch: 'latest' }))
    expect(client.getInputs.mock.calls[0][0]).not.toHaveProperty('recipient')
    expect(client.getOutbox.mock.calls[0][0]).not.toHaveProperty('sender')
    expect(wrapper.findAll('[data-slot="input-table"] tbody tr')).toHaveLength(2)
    wrapper.unmount()
  })

  it('reads the domain from ?domain=', async () => {
    const client = serve()
    const { wrapper } = await render(`/address/${ADDRESS}?domain=2`)
    expect(client.getInputs).toHaveBeenCalledWith(expect.objectContaining({ domainId: 2, sender: ADDRESS }))
    expect(client.getOutbox).toHaveBeenCalledWith(expect.objectContaining({ domainId: 2, recipient: ADDRESS }))
    expect(wrapper.find('[data-slot="input-table"] a[href^="/batches/2/"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('falls back to the default domain for a non-numeric ?domain=', async () => {
    const client = serve()
    const { wrapper } = await render(`/address/${ADDRESS}?domain=abc`)
    expect(client.getInputs).toHaveBeenCalledWith(expect.objectContaining({ domainId: 1 }))
    wrapper.unmount()
  })

  it('switches domain through ?domain= and reloads both lists', async () => {
    const client = serve()
    const { wrapper, router } = await render(`/address/${ADDRESS}`)
    wrapper.findComponent(DomainSelect).vm.$emit('update:modelValue', 2)
    await vi.waitFor(() => expect(router.currentRoute.value.query.domain).toBe('2'))
    await vi.waitFor(() => expect(client.getInputs).toHaveBeenLastCalledWith(expect.objectContaining({ domainId: 2, sender: ADDRESS })))
    await vi.waitFor(() => expect(client.getOutbox).toHaveBeenLastCalledWith(expect.objectContaining({ domainId: 2, recipient: ADDRESS })))
    wrapper.unmount()
  })

  it('shows the outbox messages addressed to the address with their withdrawal state', async () => {
    serve()
    const { wrapper } = await render(`/address/${ADDRESS}`)
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs.find((t) => t.text() === 'Outbox')!.trigger('mousedown', { button: 0 })
    await tabs.find((t) => t.text() === 'Outbox')!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="outbox-table"]').exists()).toBe(true))
    expect(wrapper.find('[data-slot="outbox-table"]').text()).toContain('Waiting for the batch')
    expect(wrapper.find('[data-slot="outbox-table"] [data-slot="verification-badge"]').attributes('data-state')).toBe('pending')
    wrapper.unmount()
  })

  it('says no batch has reached the tag when the page has batchId null and no items', async () => {
    serve({ getInputs: vi.fn(async () => page([], { batchId: null })) })
    const { wrapper } = await render(`/address/${ADDRESS}`)
    expect(wrapper.find('[data-slot="unreached"]').text()).toBe('No batch has reached latest yet')
    wrapper.unmount()
  })

  it('shows the not-an-address alert and reads nothing for an invalid address', async () => {
    const client = serve()
    const { wrapper } = await mountAt('/address/z1short', routes)
    await flushPromises()
    expect(wrapper.text()).toContain('Not an address')
    expect(client.getInputs).not.toHaveBeenCalled()
    expect(client.getOutbox).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('rejects an address with the wrong prefix', async () => {
    serve()
    const { wrapper } = await mountAt(`/address/x1${ADDRESS.slice(2)}`, routes)
    await flushPromises()
    expect(wrapper.text()).toContain('Not an address')
    wrapper.unmount()
  })

  it('shows the error when the inputs cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    serve({ getInputs: vi.fn().mockRejectedValue(new Error('gateway down')) })
    const { wrapper } = await render(`/address/${ADDRESS}`)
    expect(wrapper.find('[role="alert"]').text()).toContain('gateway down')
    wrapper.unmount()
  })
})
