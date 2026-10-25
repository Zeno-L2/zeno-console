import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { NotFoundError, TagUnavailableError } from 'zeno-client'
import { GatewayService } from '@/core'
import { gatewayService } from '../../test/helpers'
import AppSearch from './AppSearch.vue'

const HASH = 'ab'.repeat(32)

function serve(getOutboxProof: () => Promise<unknown>) {
  const miss = async () => {
    throw new NotFoundError('not found', -32004)
  }
  const client = {
    getReceipt: miss,
    getOutboxProof,
    contracts: async () => ({ contract: miss }),
  }
  vi.spyOn(gatewayService, 'client').mockResolvedValue(client as never)
  vi.spyOn(GatewayService, 'getInstance').mockReturnValue(gatewayService)
}

async function search(value: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { render: () => null } }] })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(AppSearch, { global: { plugins: [router] }, attachTo: document.body })
  const input = wrapper.find('input')
  await input.setValue(value)
  await wrapper.find('form').trigger('submit')
  await vi.waitFor(() => expect(wrapper.find('input').attributes('aria-invalid') === 'true' || router.currentRoute.value.fullPath !== '/').toBe(true))
  await flushPromises()
  return { wrapper, router }
}

describe('AppSearch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('shows the no-match message when every probe answers NotFoundError', async () => {
    serve(async () => {
      throw new NotFoundError('not found', -32004)
    })
    const { wrapper } = await search(HASH)
    expect(wrapper.text()).toContain('No matching send hash, contract, outbox message, batch or address')
    wrapper.unmount()
  })

  it('shows the busy message when a probe answers TagUnavailableError and nothing matches', async () => {
    serve(async () => {
      throw new TagUnavailableError('tag unavailable', -32005)
    })
    const { wrapper } = await search(HASH)
    expect(wrapper.text()).toContain('The gateway is busy or still starting. Try again in a moment.')
    wrapper.unmount()
  })

  it('shows the failure text for a transport error', async () => {
    serve(async () => {
      throw new TypeError('Failed to fetch')
    })
    const { wrapper } = await search(HASH)
    expect(wrapper.text()).toContain('Search failed: Failed to fetch')
    wrapper.unmount()
  })

  it('routes a found address and clears the input', async () => {
    serve(async () => null)
    const address = `z1${'q'.repeat(38)}`
    const { wrapper, router } = await search(address)
    expect(router.currentRoute.value.fullPath).toBe(`/address/${address}`)
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })
})
