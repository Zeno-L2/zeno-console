import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { DomainInconsistentError } from 'zeno-client'
import { SettlementService, useSettings } from '@/core'
import { useDomainHeads, useDomains } from '@/core'
import { altered, call } from '../../test/replay-client'
import type { RecordedCall } from '../../test/replay-client'
import { mountAt, useFakeClient, useRecordedGateway } from '../../test/helpers'
import DomainInputs from './DomainInputs.vue'
import DomainLayout from './DomainLayout.vue'

const Child = defineComponent({ render: () => h('div', { 'data-slot': 'child-page' }, 'child') })
const routes = [
  {
    path: '/domains/:domainId(\\d+)',
    component: DomainLayout,
    children: [
      { path: '', name: 'domain-overview', meta: { tab: 'Overview' }, component: Child },
      { path: 'batches', name: 'domain-batches', meta: { tab: 'Batches' }, component: Child },
      { path: 'inputs', name: 'domain-inputs', meta: { tab: 'Inputs' }, component: DomainInputs },
    ],
  },
]

function listDomains(ids: number[], getDomains = vi.fn(async () => ({ count: ids.length, list: ids.map((domainId) => ({ domainId })) }))) {
  vi.spyOn(SettlementService, 'getInstance').mockReturnValue({ getDomains } as never)
  return getDomains
}

const headWith = (status: string, inconsistentAt: number | null = null): RecordedCall => ({
  ...call('getHead'),
  response: { result: { ...(call('getHead').response.result as object), status, inconsistentAt } },
})

describe('DomainLayout', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
    useDomainHeads().errors.value = {}
    await useSettings().reset()
  })

  it('says there is no domain once the domain list has loaded without it', async () => {
    useRecordedGateway()
    listDomains([1, 2])
    await useDomains().load()
    const { wrapper } = await mountAt('/domains/9', routes)
    expect(wrapper.find('[data-slot="no-domain"]').text()).toContain('No domain 9 on Settlement')
    expect(wrapper.find('[data-slot="child-page"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not say it while the domain list is loading', async () => {
    useRecordedGateway()
    let release: (value: unknown) => void = () => undefined
    const pending = new Promise((resolve) => (release = resolve))
    listDomains([], vi.fn(async () => { await pending; return { count: 0, list: [] } }))
    const loading = useDomains().load()
    const { wrapper } = await mountAt('/domains/9', routes)
    expect(useDomains().isLoaded.value).toBe(false)
    expect(wrapper.find('[data-slot="no-domain"]').exists()).toBe(false)
    expect(wrapper.find('[data-slot="child-page"]').exists()).toBe(false)
    release(null)
    await loading
    await flushPromises()
    expect(wrapper.find('[data-slot="no-domain"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('does not say it when the domain list failed to load, and shows the error', async () => {
    useRecordedGateway()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    listDomains([], vi.fn().mockRejectedValue(new Error('node unreachable')))
    await useDomains().load()
    const { wrapper } = await mountAt('/domains/9', routes)
    expect(wrapper.find('[data-slot="no-domain"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('node unreachable')
    wrapper.unmount()
  })

  it('shows the domain, its status badge and the routed page for a listed domain', async () => {
    useRecordedGateway()
    listDomains([1, 2])
    await useDomains().load()
    const { wrapper } = await mountAt('/domains/1', routes)
    await vi.waitFor(() => expect(wrapper.find('[data-slot="domain-status"]').exists()).toBe(true))
    expect(wrapper.text()).toContain('Domain 1')
    expect(wrapper.find('[data-slot="domain-status"]').text()).toBe('OK')
    expect(wrapper.find('[data-slot="child-page"]').exists()).toBe(true)
    expect(wrapper.find('[data-slot="inconsistent-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('names the page in the title and shows no tab bar', async () => {
    useRecordedGateway()
    listDomains([1, 2])
    await useDomains().load()
    const { wrapper } = await mountAt('/domains/1/batches', routes)
    await flushPromises()
    expect(wrapper.find('[data-slot="domain-title"]').text()).toBe('Domain 1 · Batches')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the inconsistent banner and a destructive status for an INCONSISTENT head', async () => {
    useRecordedGateway([headWith('INCONSISTENT', 2)])
    listDomains([1])
    await useDomains().load()
    const { wrapper } = await mountAt('/domains/1', routes)
    await vi.waitFor(() => expect(wrapper.find('[data-slot="inconsistent-banner"]').exists()).toBe(true))
    expect(wrapper.find('[data-slot="domain-status"]').text()).toBe('INCONSISTENT')
    expect(wrapper.find('[data-slot="inconsistent-banner"]').text()).toContain('batch 2')
    wrapper.unmount()
  })

  it('shows one inconsistent banner on a tab whose read throws DomainInconsistentError', async () => {
    const client = useFakeClient({
      getInputs: vi.fn(async () => {
        throw new DomainInconsistentError('domain inconsistent', -32010)
      }),
    })
    client.getHead.mockResolvedValue(altered('getHead', (r) => { r.status = 'INCONSISTENT'; r.inconsistentAt = 2 }).response.result)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    listDomains([1])
    await useDomains().load()
    const { wrapper } = await mountAt('/domains/1/inputs', routes)
    await vi.waitFor(() => expect(wrapper.find('[data-slot="inconsistent-banner"]').exists()).toBe(true))
    await flushPromises()
    expect(wrapper.findAll('[data-slot="inconsistent-banner"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('names a domain the gateway does not serve, without the allowedOrigins hint', async () => {
    useRecordedGateway()
    listDomains([99])
    await useDomains().load()
    const { wrapper } = await mountAt('/domains/99', routes)
    await vi.waitFor(() => expect(wrapper.find('[data-slot="head-error"]').exists()).toBe(true))
    expect(wrapper.find('[data-slot="head-error"]').text()).toContain('This gateway does not serve domain 99')
    expect(wrapper.find('[data-slot="head-error"]').text()).not.toContain('allowedOrigins')
    wrapper.unmount()
  })

  it('stops following the domain when it unmounts', async () => {
    const requests = useRecordedGateway()
    listDomains([1])
    await useDomains().load()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper } = await mountAt('/domains/1', routes)
    const before = requests.filter((r) => r.method === 'zeno_getHead').length
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    vi.useRealTimers()
    expect(requests.filter((r) => r.method === 'zeno_getHead').length).toBe(before)
  })
})
