import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { TooltipProvider } from 'nom-ui'
import { h } from 'vue'
import { StubProvider } from '@/core/stub-provider'
import { useWalletProvider } from '@/core/composables/useWalletProvider'
import WalletButton from './WalletButton.vue'

const render = async () => {
  const wrapper = mount({ render: () => h(TooltipProvider, null, () => h(WalletButton)) })
  await flushPromises()
  return wrapper
}

describe('WalletButton', () => {
  afterEach(async () => {
    await useWalletProvider().disconnect()
    delete window.zenon
  })

  it('says there is no wallet when nothing is injected', async () => {
    delete window.zenon
    const wrapper = await render()
    expect(wrapper.text()).toContain('No wallet')
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })

  it('offers to connect when a wallet is present', async () => {
    const stub = new StubProvider()
    stub.results.getAccounts = []
    window.zenon = stub
    const wrapper = await render()
    expect(wrapper.text()).toContain('Connect wallet')
    expect(stub.calls).toEqual([])
  })

  it('shows the address and a disconnect action once connected', async () => {
    const stub = new StubProvider()
    stub.results.getAccounts = []
    window.zenon = stub
    const wrapper = await render()
    stub.results.getAccounts = ['z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp']
    await wrapper.find('button').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('z1qxemde'))
    expect(wrapper.find('[aria-label="Disconnect wallet"]').exists()).toBe(true)
  })

  it('keeps the address and Disconnect in a popover below the sm breakpoint', async () => {
    const stub = new StubProvider()
    stub.results.getAccounts = []
    window.zenon = stub
    const wrapper = await render()
    stub.results.getAccounts = ['z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp']
    await wrapper.find('button').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="wallet-menu"]').exists()).toBe(true))
    const menu = wrapper.find('[data-slot="wallet-menu"]')
    expect(menu.classes()).toContain('hidden')
    expect(menu.classes()).toContain('max-sm:inline-flex')
    const inline = wrapper.find('[aria-label="Disconnect wallet"]').element.parentElement
    expect(inline?.classList.contains('hidden')).toBe(true)
    expect(inline?.classList.contains('sm:flex')).toBe(true)
  })
})
