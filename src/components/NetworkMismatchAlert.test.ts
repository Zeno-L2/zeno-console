import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { useNetwork } from '@/core'
import { StubProvider } from '@/core/stub-provider'
import { useWalletProvider } from '@/core/composables/useWalletProvider'
import NetworkMismatchAlert from './NetworkMismatchAlert.vue'

const ACCOUNT = 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'

describe('NetworkMismatchAlert', () => {
  let stub: StubProvider

  beforeEach(async () => {
    stub = new StubProvider()
    stub.results.getAccounts = []
    window.zenon = stub
    const network = useNetwork()
    network.chainId.value = 1
    network.currentNode.value = 'ws://localhost:35998'
    network.isInitialized.value = true
    await useWalletProvider().connect()
  })

  afterEach(async () => {
    await useWalletProvider().disconnect()
    delete window.zenon
    useNetwork().isInitialized.value = false
  })

  it('stays hidden when the wallet and the console agree', async () => {
    stub.results.getAccounts = [ACCOUNT]
    await useWalletProvider().connect()
    const wrapper = mount(NetworkMismatchAlert)
    expect(wrapper.find('[data-slot="network-mismatch"]').exists()).toBe(false)
  })

  it('names both chain ids when the wallet is on another chain', async () => {
    stub.results.getAccounts = [ACCOUNT]
    stub.results.getChainId = 69
    await useWalletProvider().connect()
    const wrapper = mount(NetworkMismatchAlert)
    const alert = wrapper.find('[data-slot="network-mismatch"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('69')
  })

  it('stays hidden while the console holds placeholder values', async () => {
    useNetwork().isInitialized.value = false
    stub.results.getAccounts = [ACCOUNT]
    stub.results.getChainId = 69
    await useWalletProvider().connect()
    const wrapper = mount(NetworkMismatchAlert)
    await flushPromises()
    expect(wrapper.find('[data-slot="network-mismatch"]').exists()).toBe(false)
  })

  it('appears when the console network changes under a connected wallet', async () => {
    stub.results.getAccounts = [ACCOUNT]
    await useWalletProvider().connect()
    const wrapper = mount(NetworkMismatchAlert)
    expect(wrapper.find('[data-slot="network-mismatch"]').exists()).toBe(false)
    useNetwork().chainId.value = 5
    await flushPromises()
    expect(wrapper.find('[data-slot="network-mismatch"]').exists()).toBe(true)
  })
})
