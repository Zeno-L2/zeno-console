import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { STORAGE_KEY_SETTINGS, STORAGE_KEY_SIDEBAR_COLLAPSED, STORAGE_KEY_WALLET_CONNECTED } from '@/config'
import { storageService } from '@/core/storage/storage-service'
import { GatewayService, SettlementService, useNetwork, useSettings } from '@/core'
import { useDomainHeads } from '@/core'
import { call } from '../test/replay-client'
import { anyRoute, useFakeNode } from '../test/helpers'
import { StubProvider } from '@/core/stub-provider'
import { useWalletProvider } from '@/core/composables/useWalletProvider'
import DomainLayout from '@/pages/DomainLayout.vue'
import App from './App.vue'

const SAVED_URL = 'http://saved-gateway.example:4321'

const Page = defineComponent({ render: () => h('div', { 'data-slot': 'stub-page' }, 'page') })

async function mountApp(url: string, routes: Parameters<typeof createRouter>[0]['routes']) {
  const router = createRouter({ history: createMemoryHistory(), routes: [...routes, anyRoute] })
  await router.push(url)
  await router.isReady()
  const wrapper = mount(App, { global: { plugins: [router], stubs: { RouterView } }, attachTo: document.body })
  return { wrapper, router }
}

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  // The settings state is module-level and starts unloaded, so this runs first.
  it('renders no routed page until the settings have loaded', async () => {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({ gatewayUrl: SAVED_URL }))
    useFakeNode()
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 0, list: [] }),
    } as never)
    expect(useSettings().isLoaded.value).toBe(false)

    const { wrapper } = await mountApp('/x', [{ path: '/x', component: Page }])
    expect(wrapper.find('header').exists()).toBe(true)
    expect(wrapper.find('[data-slot="stub-page"]').exists()).toBe(false)

    await vi.waitFor(() => expect(wrapper.find('[data-slot="stub-page"]').exists()).toBe(true))
    expect(useSettings().isLoaded.value).toBe(true)
    wrapper.unmount()
  })

  it('shows the header with the navigation, the settings link and the theme toggle', async () => {
    useFakeNode()
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 0, list: [] }),
    } as never)
    const { wrapper } = await mountApp('/x', [{ path: '/x', component: Page }])
    await flushPromises()
    const nav = wrapper.find('nav')
    expect(nav.text()).toContain('Network')
    expect(nav.text()).toContain('Playground')
    expect(wrapper.find('a[href="/settings"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Toggle theme"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the menu button from sm until the inline nav takes over at lg', async () => {
    useFakeNode()
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 0, list: [] }),
    } as never)
    const { wrapper } = await mountApp('/x', [{ path: '/x', component: Page }])
    await flushPromises()
    const classes = wrapper.find('[aria-label="Open menu"]').classes()
    expect(classes).toContain('lg:hidden')
    expect(classes).toContain('sm:inline-flex')
    expect(classes).not.toContain('sm:' + 'hidden')
    wrapper.unmount()
  })

  it('reads a deep-linked domain from the saved gateway URL, with no page calling useGateway', async () => {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({ gatewayUrl: SAVED_URL }))
    useFakeNode()
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 2, list: [{ domainId: 1 }, { domainId: 2 }] }),
    } as never)
    const urlsAtFirstRead: string[] = []
    vi.spyOn(GatewayService.prototype, 'client').mockImplementation(function (this: GatewayService) {
      urlsAtFirstRead.push(this.getUrl())
      return Promise.resolve({
        getHead: async () => ({ ...(call('getHead').response.result as object), domainId: 2 }),
      } as never)
    })
    const { wrapper } = await mountApp('/domains/2', [
      {
        path: '/domains/:domainId(\\d+)',
        component: DomainLayout,
        children: [{ path: '', name: 'domain-overview', meta: { tab: 'Overview' }, component: Page }],
      },
    ])
    await vi.waitFor(() => expect(useDomainHeads().heads.value[2]).toBeDefined())
    expect(urlsAtFirstRead.length).toBeGreaterThan(0)
    expect(urlsAtFirstRead.every((url) => url === SAVED_URL)).toBe(true)
    expect(GatewayService.getInstance().getUrl()).toBe(SAVED_URL)
    wrapper.unmount()
  })

  it('loads the domain list on mount', async () => {
    useFakeNode()
    const getDomains = vi.fn(async () => ({ count: 0, list: [] }))
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({ getDomains } as never)
    const { wrapper } = await mountApp('/x', [{ path: '/x', component: Page }])
    await flushPromises()
    expect(getDomains).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows the Zeno Console title, the wallet button and the Deploy link', async () => {
    useFakeNode()
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 0, list: [] }),
    } as never)
    const { wrapper } = await mountApp('/x', [{ path: '/x', component: Page }])
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Zeno Console')
    expect(wrapper.find('[data-slot="wallet-button"]').exists()).toBe(true)
    expect(wrapper.find('nav a[href="/deploy"]').exists()).toBe(true)
    expect(wrapper.find('nav a[href="/withdrawals"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the network mismatch alert above the routed page', async () => {
    useFakeNode()
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 0, list: [] }),
    } as never)
    const stub = new StubProvider()
    stub.results.getAccounts = ['z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp']
    stub.results.getChainId = 69
    window.zenon = stub
    const network = useNetwork()
    network.chainId.value = 1
    network.isInitialized.value = true
    const wallet = useWalletProvider()
    await wallet.connect()
    const { wrapper } = await mountApp('/x', [{ path: '/x', component: Page }])
    await vi.waitFor(() => expect(wrapper.find('[data-slot="stub-page"]').exists()).toBe(true))
    const main = wrapper.find('main')
    expect(main.element.firstElementChild?.getAttribute('data-slot')).toBe('network-mismatch')
    expect(wrapper.find('nav a[href="/withdrawals"]').exists()).toBe(true)
    wrapper.unmount()
    await wallet.disconnect()
    delete window.zenon
    network.isInitialized.value = false
  })

  it('sends no provider request until Connect is clicked', async () => {
    useFakeNode()
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 0, list: [] }),
    } as never)
    localStorage.clear()
    useWalletProvider().accounts.value = []
    const stub = new StubProvider()
    stub.results.getAccounts = []
    window.zenon = stub
    const { wrapper } = await mountApp('/x', [{ path: '/x', component: Page }])
    await vi.waitFor(() => expect(wrapper.find('[data-slot="stub-page"]').exists()).toBe(true))
    expect(stub.calls).toEqual([])
    await wrapper.find('[data-slot="wallet-button"] button').trigger('click')
    await vi.waitFor(() => expect(stub.calls.length).toBeGreaterThan(0))
    wrapper.unmount()
    delete window.zenon
  })

  it('restores a remembered connection at startup without a prompt', async () => {
    useFakeNode()
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 0, list: [] }),
    } as never)
    localStorage.clear()
    useWalletProvider().accounts.value = []
    await storageService.set(STORAGE_KEY_WALLET_CONNECTED, true)
    const stub = new StubProvider()
    window.zenon = stub
    const { wrapper } = await mountApp('/x', [{ path: '/x', component: Page }])
    await vi.waitFor(() => expect(useWalletProvider().isConnected.value).toBe(true))
    expect(stub.calls.map((c) => c.method)).not.toContain('connect')
    wrapper.unmount()
    delete window.zenon
    useWalletProvider().accounts.value = []
  })

  it('centres the collapsed header logo over the sidebar icons', async () => {
    useFakeNode()
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 0, list: [] }),
    } as never)
    await storageService.set(STORAGE_KEY_SIDEBAR_COLLAPSED, true)
    const { wrapper } = await mountApp('/x', [{ path: '/x', component: Page }])
    await flushPromises()
    // The Tailwind spacing number after `prefix`, times 4 pixels, negated for a `-` prefix.
    const px = (classes: string, prefix: string) => {
      const match = classes.split(/\s+/).find((c) => c.startsWith(prefix) && /^-?\d+(\.\d+)?$/.test(c.slice(prefix.length)))
      return match ? Number(match.slice(prefix.length)) * 4 * (prefix.includes('-ml-') ? -1 : 1) : 0
    }
    const header = wrapper.find('header').attributes('class') ?? ''
    const logo = wrapper.find('header a[href="/"]').attributes('class') ?? ''
    const nav = wrapper.find('[data-slot="app-sidebar"]').attributes('class') ?? ''
    const item = wrapper.find('[data-slot="app-sidebar"] a').attributes('class') ?? ''
    expect(item).toContain('justify-center')
    expect(item).toContain('px-0')
    const logoCentre = px(header, 'sm:px-') + px(logo, 'lg:-ml-') + px(logo, 'lg:w-') / 2
    const iconCentre = px(nav, 'w-') / 2
    expect(logoCentre).toBe(iconCentre)
    wrapper.unmount()
    await storageService.remove(STORAGE_KEY_SIDEBAR_COLLAPSED)
  })
})
