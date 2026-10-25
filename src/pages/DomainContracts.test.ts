import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { UnsupportedProfileError } from 'zeno-client'
import { ContractRegistryService, useDomainHeads } from '@/core'
import { ADDRESS, connectWallet, disconnectWallet } from '@/core/composables/call-test-helpers'
import { altered, call, result } from '../../test/replay-client'
import { mountAt, useFakeClient, useRecordedGateway } from '../../test/helpers'
import { button, pageOf } from '../../test/lists'
import DomainContracts from './DomainContracts.vue'

const routes = [{ path: '/domains/:domainId(\\d+)/contracts', component: DomainContracts }]
const recorded = result<{ items: Record<string, any>[] }>('getInputs by contract') // eslint-disable-line @typescript-eslint/no-explicit-any

// The recorded contract page with its params replaced: the filter becomes a domain-wide inputKind 4.
const sent = call('getInputs by contract').params[0] as Record<string, unknown>
const params = { domainId: sent.domainId, inputKind: 4 }
const deploy = (n: number, status: string) => {
  const hash = `${n.toString(16).padStart(2, '0')}de${'00'.repeat(30)}`
  const input = { ...recorded.items[0].input }
  delete input.contractId
  return {
    ...recorded.items[0],
    globalInputIndex: n,
    sendHash: hash,
    inputKind: params.inputKind,
    receipt: { ...recorded.items[0].receipt, status },
    input: { ...input, kind: 'Deploy', inputKind: params.inputKind, sourceAccountBlockHash: hash },
  }
}
const ok1 = deploy(1, 'SUCCESS')
const failed = deploy(2, 'UNAUTHORIZED')
const ok2 = deploy(3, 'SUCCESS')

// The page checks the contracts profile before it lists deploys.
const useGateway = (methods: Record<string, unknown>) =>
  useFakeClient({ contracts: vi.fn(async () => ({})), ...methods })

async function render(url = '/domains/1/contracts') {
  const mounted = await mountAt(url, routes)
  await vi.waitFor(() =>
    expect(
      mounted.wrapper
        .find(
          '[data-slot$="-table"], [data-slot="unreached"], [data-slot="no-contracts"], [role="alert"]'
        )
        .exists()
    ).toBe(true)
  )
  await flushPromises()
  return mounted
}

describe('DomainContracts', () => {
  afterEach(async () => {
    await disconnectWallet()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
    useDomainHeads().errors.value = {}
  })

  it('asks for inputKind 4 of the domain at latest', async () => {
    const client = useGateway({ getInputs: vi.fn(async () => pageOf([ok1])) })
    const { wrapper } = await render('/domains/7/contracts')
    expect(client.getInputs).toHaveBeenCalledWith(
      expect.objectContaining({ domainId: 7, inputKind: 4, toBatch: 'latest', limit: 25 })
    )
    wrapper.unmount()
  })

  it('lists only the SUCCESS rows of the page', async () => {
    useGateway({ getInputs: vi.fn(async () => pageOf([ok1, failed, ok2])) })
    const { wrapper } = await render()
    const rows = wrapper.findAll('[data-slot="input-table"] tbody tr')
    expect(rows).toHaveLength(2)
    expect(wrapper.find(`a[href="/tx/${ok1.sendHash}"]`).exists()).toBe(true)
    expect(wrapper.find(`a[href="/tx/${ok2.sendHash}"]`).exists()).toBe(true)
    expect(wrapper.find(`a[href="/tx/${failed.sendHash}"]`).exists()).toBe(false)
    wrapper.unmount()
  })

  it('says there are no contracts when every deploy on the page failed', async () => {
    useGateway({ getInputs: vi.fn(async () => pageOf([failed])) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="no-contracts"]').text()).toBe('No contracts.')
    expect(wrapper.find('[data-slot="input-table"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('says no batch has reached the tag when the page is empty and unreached', async () => {
    useGateway({ getInputs: vi.fn(async () => pageOf([], { batchId: null })) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="unreached"]').text()).toBe('No batch has reached latest yet')
    wrapper.unmount()
  })

  it('moves Older through the cursor', async () => {
    const getInputs = vi.fn(async (f: { cursor?: string }) =>
      f.cursor === 'c1' ? pageOf([ok2]) : pageOf([ok1], { nextCursor: 'c1' })
    )
    useGateway({ getInputs })
    const { wrapper } = await render()
    await button(wrapper, 'Older').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="page-number"]').text()).toBe('Page 2'))
    expect(getInputs).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'c1', inputKind: 4 })
    )
    expect(wrapper.find(`a[href="/tx/${ok2.sendHash}"]`).exists()).toBe(true)
    wrapper.unmount()
  })

  it('says the domain has no contracts profile and asks for no inputs', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const requests = useRecordedGateway([
      altered('chainInfo', (r) => {
        r.profiles = []
      }),
    ])
    const { wrapper } = await mountAt('/domains/1/contracts', routes)
    await vi.waitFor(() =>
      expect(wrapper.find('[data-slot="no-contracts-profile"]').exists()).toBe(true)
    )
    await flushPromises()
    expect(wrapper.find('[data-slot="no-contracts-profile"]').text()).toBe(
      'Domain 1 has no contracts profile'
    )
    expect(wrapper.find('[data-slot="no-contracts"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('does not implement')
    expect(requests.filter((r) => r.method === 'zeno_getInputs')).toHaveLength(0)
    expect(logged).toHaveBeenCalledWith('Failed to load the contracts:', expect.any(UnsupportedProfileError))
    wrapper.unmount()
  })

  it('shows the error text when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useGateway({ getInputs: vi.fn().mockRejectedValue(new Error('boom')) })
    const { wrapper } = await render()
    expect(wrapper.find('[role="alert"]').text()).toContain('boom')
    wrapper.unmount()
  })

  it('lists the contracts saved in this browser for the route domain', async () => {
    useGateway({ getInputs: vi.fn(async () => pageOf([ok1])) })
    const list = vi.fn(async (domainId?: number) =>
      domainId === 7 ? [{ contractId: 'ab'.repeat(32), domainId: 7, addedAt: 1, name: 'Vault' }] : []
    )
    vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue({ list } as unknown as ContractRegistryService)
    const { wrapper } = await render('/domains/7/contracts')
    expect(list).toHaveBeenCalledWith(7)
    const card = wrapper.find('[data-slot="saved-contracts"]')
    expect(card.text()).toContain('Vault')
    expect(card.find(`a[href="/contracts/7/${'ab'.repeat(32)}"]`).exists()).toBe(true)
    wrapper.unmount()
  })

  it('badges a loaded interface, a cleared interface and a contract with none', async () => {
    useGateway({ getInputs: vi.fn(async () => pageOf([ok1])) })
    const list = async () => [
      { contractId: '01'.repeat(32), domainId: 1, addedAt: 1, name: 'Loaded', iface: { interface_version: 1 } },
      { contractId: '02'.repeat(32), domainId: 1, addedAt: 1, name: 'Old', interfaceCleared: true },
      { contractId: '03'.repeat(32), domainId: 1, addedAt: 1, name: 'Bare' },
    ]
    vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue({ list } as unknown as ContractRegistryService)
    const { wrapper } = await render()
    const badge = (name: string) =>
      wrapper
        .find('[data-slot="saved-contracts"]')
        .findAll('tr')
        .find((r) => r.text().includes(name))
        ?.find('[data-slot="badge"]')
        .text()
    expect(badge('Loaded')).toBe('Loaded')
    expect(badge('Old')).toBe('Re-import')
    expect(badge('Bare')).toBe('None')
    wrapper.unmount()
  })

  it('reloads the saved contracts when the route domain changes', async () => {
    useGateway({ getInputs: vi.fn(async () => pageOf([ok1])) })
    const list = vi.fn(async (domainId?: number) =>
      domainId === 2 ? [{ contractId: 'cd'.repeat(32), domainId: 2, addedAt: 1, name: 'Second' }] : []
    )
    vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue({ list } as unknown as ContractRegistryService)
    const { wrapper, router } = await render('/domains/1/contracts')
    expect(wrapper.find('[data-slot="saved-contracts"]').exists()).toBe(false)
    await router.push('/domains/2/contracts')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="saved-contracts"]').text()).toContain('Second'))
    wrapper.unmount()
  })

  it('hides the saved card when the domain has none', async () => {
    useGateway({ getInputs: vi.fn(async () => pageOf([ok1])) })
    vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue({
      list: async () => [],
    } as unknown as ContractRegistryService)
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="saved-contracts"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hides the Deployed by me switch without a wallet', async () => {
    useGateway({ getInputs: vi.fn(async () => pageOf([ok1])) })
    const { wrapper } = await render()
    expect(wrapper.find('button[role="switch"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('adds the sender to the query when Deployed by me is on and drops it when off', async () => {
    await connectWallet()
    const client = useGateway({ getInputs: vi.fn(async () => pageOf([ok1])) })
    const { wrapper } = await render()
    expect(client.getInputs.mock.calls.at(-1)?.[0]).not.toHaveProperty('sender')
    await wrapper.find('button[role="switch"]').trigger('click')
    await vi.waitFor(() =>
      expect(client.getInputs).toHaveBeenLastCalledWith(expect.objectContaining({ sender: ADDRESS, inputKind: 4 }))
    )
    await wrapper.find('button[role="switch"]').trigger('click')
    await vi.waitFor(() => expect(client.getInputs.mock.calls.at(-1)?.[0]).not.toHaveProperty('sender'))
    wrapper.unmount()
  })

  it('turns the switch off and drops the sender when the wallet disconnects', async () => {
    await connectWallet()
    const client = useGateway({ getInputs: vi.fn(async () => pageOf([ok1])) })
    const { wrapper } = await render()
    await wrapper.find('button[role="switch"]').trigger('click')
    await vi.waitFor(() => expect(client.getInputs.mock.calls.at(-1)?.[0]).toHaveProperty('sender'))
    await disconnectWallet()
    await vi.waitFor(() => expect(client.getInputs.mock.calls.at(-1)?.[0]).not.toHaveProperty('sender'))
    expect(wrapper.find('button[role="switch"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
