import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { selectorOf, sha3 } from 'zeno-client'
import type { ContractInterface } from 'zeno-client'
import { ContractRegistryService, InterfaceResolver } from '@/core'
import { useDomainHeads } from '@/core'
import { altered } from '../../test/replay-client'
import { mountAt, useFakeClient } from '../../test/helpers'
import { advanceHead, button, pageOf, settled } from '../../test/lists'
import DomainEvents from './DomainEvents.vue'

const routes = [{ path: '/domains/:domainId(\\d+)/events', component: DomainEvents }]
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const REGISTERED = 'f3'.repeat(32)
const OTHER = 'a1'.repeat(32)
const TOPIC = hex(sha3(new TextEncoder().encode('Added')))

const iface: ContractInterface = {
  interface_version: 1,
  encoding: 'zeno-selector-v1',
  code_hash: '00'.repeat(32),
  methods: [{ name: 'add', selector: hex(selectorOf('add')), payable: false, readonly: false, inputs: [], outputs: [] }],
  on_deposit: null,
  events: [{ name: 'Added', topic: TOPIC, fields: [{ name: 'amount', type: 'u64', indexed: false }] }],
  errors: [],
  storage: [],
}

const event = (over: Record<string, unknown> = {}) => ({
  batchId: 3,
  verified: true,
  contractId: REGISTERED,
  inputIndex: 1,
  eventIndex: 0,
  topics: [TOPIC],
  data: '0000000000000005',
  ...over,
})

function registry(contracts: { contractId: string; domainId: number; iface?: ContractInterface }[]) {
  const list = vi.fn(async (domainId?: number) =>
    contracts.filter((c) => domainId === undefined || c.domainId === domainId)
  )
  vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue({ list } as never)
  return list
}

async function render(url = '/domains/1/events') {
  const mounted = await mountAt(url, routes)
  await settled(mounted.wrapper)
  await flushPromises()
  return mounted
}

describe('DomainEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    InterfaceResolver.getInstance().clear()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
    useDomainHeads().errors.value = {}
  })

  it('decodes a row whose contract has a registered interface', async () => {
    const list = registry([{ contractId: REGISTERED, domainId: 1, iface }])
    const client = useFakeClient({ getEvents: vi.fn(async () => pageOf([event()])) })
    const { wrapper } = await render()
    expect(client.getEvents).toHaveBeenCalledWith(expect.objectContaining({ domainId: 1, toBatch: 'latest' }))
    expect(list).toHaveBeenCalledWith(1)
    const row = wrapper.find('[data-slot="event-table"] tbody tr')
    expect(row.text()).toContain('Added')
    expect(row.text()).toContain('amount')
    expect(row.text()).toContain('5')
    expect(row.text()).not.toContain('Unknown event')
    wrapper.unmount()
  })

  it('lets the event cell wrap long values', async () => {
    registry([{ contractId: REGISTERED, domainId: 1, iface }])
    useFakeClient({ getEvents: vi.fn(async () => pageOf([event()])) })
    const { wrapper } = await render()
    const cell = wrapper.find('[data-slot="event-table"] tbody td [data-slot="event-list"]').element.closest('td')!
    expect(cell.classList.contains('whitespace-normal')).toBe(true)
    expect(cell.classList.contains('whitespace-nowrap')).toBe(false)
    wrapper.unmount()
  })

  it('keeps a row raw when its contract has no registered interface', async () => {
    registry([{ contractId: REGISTERED, domainId: 1, iface }])
    useFakeClient({ getEvents: vi.fn(async () => pageOf([event({ contractId: OTHER })])) })
    const { wrapper } = await render()
    const row = wrapper.find('[data-slot="event-table"] tbody tr')
    expect(row.find('[data-slot="event-undecoded"]').text()).toContain('Named from another interface')
    expect(row.find('[data-slot="event-name"]').text()).toBe('Added')
    expect(row.text()).not.toContain('amount')
    expect(row.text()).toContain(TOPIC)
    wrapper.unmount()
  })

  it('keeps a row raw, without throwing, when the interface does not fit its data', async () => {
    registry([{ contractId: REGISTERED, domainId: 1, iface }])
    useFakeClient({ getEvents: vi.fn(async () => pageOf([event({ data: '00' })])) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="event-table"] [data-slot="event-undecoded"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('decodes each row with its own contract interface', async () => {
    registry([{ contractId: REGISTERED, domainId: 1, iface }])
    useFakeClient({
      getEvents: vi.fn(async () => pageOf([event(), event({ contractId: OTHER, eventIndex: 1 })])),
    })
    const { wrapper } = await render()
    const rows = wrapper.findAll('[data-slot="event-table"] tbody tr')
    expect(rows[0].text()).toContain('Added')
    expect(rows[1].find('[data-slot="event-undecoded"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('decodes a row with an interface saved for another contract running the same code', async () => {
    registry([{ contractId: REGISTERED, domainId: 1, iface }])
    const contract = vi.fn(async () => ({ result: { sourceCodeHash: iface.code_hash } }))
    const contracts = vi.fn(async () => ({ contract }))
    useFakeClient({ getEvents: vi.fn(async () => pageOf([event({ contractId: OTHER })])), contracts })
    const { wrapper } = await render()
    await vi.waitFor(() => expect(wrapper.find('[data-slot="event-table"] tbody tr').text()).toContain('amount'))
    expect(contracts).toHaveBeenCalledWith(1)
    expect(contract).toHaveBeenCalledWith(OTHER, 'latest')
    wrapper.unmount()
  })

  it('shows Unknown event and the data as text when no interface names the event', async () => {
    registry([])
    const data = '0000000568656c6c6f'
    useFakeClient({ getEvents: vi.fn(async () => pageOf([event({ data })])) })
    const { wrapper } = await render()
    const row = wrapper.find('[data-slot="event-table"] tbody tr')
    expect(row.find('[data-slot="event-name"]').text()).toBe('Unknown event')
    expect(row.find('[data-slot="event-text"]').text()).toContain('hello')
    wrapper.unmount()
  })

  it('ignores the interfaces saved for another domain', async () => {
    registry([{ contractId: REGISTERED, domainId: 2, iface }])
    useFakeClient({ getEvents: vi.fn(async () => pageOf([event()])) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="event-table"] [data-slot="event-undecoded"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows Pending for an item with verified: false and Verified for the others', async () => {
    registry([])
    useFakeClient({
      getEvents: vi.fn(async () => pageOf([event({ verified: false }), event({ eventIndex: 1 })])),
    })
    const { wrapper } = await render()
    const states = wrapper.findAll('[data-slot="event-table"] [data-slot="verification-badge"]').map((b) => b.attributes('data-state'))
    expect(states).toEqual(['pending', 'verified'])
    wrapper.unmount()
  })

  it('shows Inconsistent on every row when the domain head is INCONSISTENT', async () => {
    registry([])
    const client = useFakeClient({ getEvents: vi.fn(async () => pageOf([event()])) })
    client.getHead.mockResolvedValue(altered('getHead', (r) => { r.status = 'INCONSISTENT' }).response.result)
    const { wrapper } = await render()
    await vi.waitFor(() =>
      expect(wrapper.find('[data-slot="event-table"] [data-slot="verification-badge"]').attributes('data-state')).toBe('inconsistent')
    )
    wrapper.unmount()
  })

  it('links the batch and the contract of a row', async () => {
    registry([])
    useFakeClient({ getEvents: vi.fn(async () => pageOf([event()])) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="event-table"] a[href="/batches/1/3"]').exists()).toBe(true)
    expect(wrapper.find(`[data-slot="event-table"] a[href="/contracts/1/${REGISTERED}"]`).exists()).toBe(true)
    wrapper.unmount()
  })

  it('says no batch has reached the tag when batchId is null and the page is empty', async () => {
    registry([])
    useFakeClient({ getEvents: vi.fn(async () => pageOf([], { batchId: null })) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="unreached"]').text()).toBe('No batch has reached latest yet')
    wrapper.unmount()
  })

  it('shows "No events." for an empty page of a reached batch', async () => {
    registry([])
    useFakeClient({ getEvents: vi.fn(async () => pageOf([])) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="unreached"]').exists()).toBe(false)
    expect(wrapper.find('[data-slot="event-table"]').text()).toContain('No events.')
    wrapper.unmount()
  })

  it('reloads the newest page on a new batch and leaves an older page alone', async () => {
    registry([])
    const getEvents = vi.fn(async (f: { cursor?: string }) =>
      f.cursor === 'c1' ? pageOf([event({ eventIndex: 2 })]) : pageOf([event()], { nextCursor: 'c1' })
    )
    useFakeClient({ getEvents })
    const { wrapper } = await render()
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    let before = getEvents.mock.calls.length
    advanceHead(9)
    await vi.waitFor(() => expect(getEvents.mock.calls.length).toBe(before + 1))
    await button(wrapper, 'Older').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="page-number"]').text()).toBe('Page 2'))
    before = getEvents.mock.calls.length
    advanceHead(10)
    await flushPromises()
    expect(getEvents.mock.calls.length).toBe(before)
    wrapper.unmount()
  })

  it('shows the error text when the read fails', async () => {
    registry([])
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useFakeClient({ getEvents: vi.fn().mockRejectedValue(new Error('boom')) })
    const { wrapper } = await render()
    expect(wrapper.find('[role="alert"]').text()).toContain('boom')
    wrapper.unmount()
  })
})
