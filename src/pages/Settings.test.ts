import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { DEFAULT_GATEWAY_URL, STORAGE_KEY_SETTINGS } from '@/config'
import { SettlementService, useSettings } from '@/core'
import { useDomains } from '@/core'
import { mountAt } from '../../test/helpers'
import Settings from './Settings.vue'

const show = vi.fn()
vi.mock('nom-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nom-ui')>()),
  useToast: () => ({ show }),
}))

const routes = [{ path: '/settings', component: Settings }]
const button = (w: Awaited<ReturnType<typeof mountAt>>['wrapper'], label: string) =>
  w.findAll('button').find((b) => b.text() === label)!

async function render() {
  const { wrapper } = await mountAt('/settings', routes)
  return wrapper
}

describe('Settings', () => {
  beforeEach(async () => {
    show.mockReset()
    localStorage.clear()
    await useSettings().reset()
    useDomains().domains.value = []
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('shows the saved values in the form', async () => {
    await useSettings().update({
      gatewayUrl: 'ws://gw.example:1',
      domainId: 5,
      localRunnerUrl: 'http://127.0.0.1:9000',
      adminAddress: 'z1admin',
    })
    const w = await render()
    expect((w.find('#gateway-url').element as HTMLInputElement).value).toBe('ws://gw.example:1')
    expect((w.find('#domain-id').element as HTMLInputElement).value).toBe('5')
    expect((w.find('#local-runner-url').element as HTMLInputElement).value).toBe('http://127.0.0.1:9000')
    expect((w.find('#admin-address').element as HTMLInputElement).value).toBe('z1admin')
    expect(w.text()).toContain('WebSocket URL lets the send tracker follow receipts by subscription')
    w.unmount()
  })

  it('mirrors settings that load after the page mounts', async () => {
    const w = await render()
    await useSettings().update({ gatewayUrl: 'https://late.example' })
    await flushPromises()
    expect((w.find('#gateway-url').element as HTMLInputElement).value).toBe('https://late.example')
    w.unmount()
  })

  it('saves valid values and persists them', async () => {
    const w = await render()
    await w.find('#gateway-url').setValue('wss://gw.example:2')
    await w.find('#domain-id').setValue('4')
    await w.find('#local-runner-url').setValue(' http://127.0.0.1:9001 ')
    await w.find('#admin-address').setValue(' z1admin ')
    await button(w, 'Save').trigger('click')
    await flushPromises()
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) ?? '{}')
    expect(saved).toMatchObject({
      gatewayUrl: 'wss://gw.example:2',
      domainId: 4,
      localRunnerUrl: 'http://127.0.0.1:9001',
      adminAddress: 'z1admin',
    })
    expect(show).toHaveBeenCalledWith('Settings saved', 'success')
    w.unmount()
  })

  it('saves an empty administrator address', async () => {
    const w = await render()
    await button(w, 'Save').trigger('click')
    await flushPromises()
    expect(useSettings().settings.value.adminAddress).toBe('')
    expect(show).toHaveBeenCalledWith('Settings saved', 'success')
    w.unmount()
  })

  it.each(['ftp://gw.example', 'not a url', ''])('rejects the gateway URL %j', async (value) => {
    const w = await render()
    await w.find('#gateway-url').setValue(value)
    await button(w, 'Save').trigger('click')
    await flushPromises()
    expect(show).toHaveBeenCalledWith('The gateway URL must start with http, https, ws or wss', 'error')
    expect(localStorage.getItem(STORAGE_KEY_SETTINGS)).toBeNull()
    w.unmount()
  })

  it('rejects a local runner URL that is not http or https', async () => {
    const w = await render()
    await w.find('#local-runner-url').setValue('ws://runner.example')
    await button(w, 'Save').trigger('click')
    await flushPromises()
    expect(show).toHaveBeenCalledWith('The local runner URL must start with http or https', 'error')
    expect(localStorage.getItem(STORAGE_KEY_SETTINGS)).toBeNull()
    w.unmount()
  })

  it('rejects a negative domain id', async () => {
    const w = await render()
    await w.find('#domain-id').setValue('-2')
    await button(w, 'Save').trigger('click')
    await flushPromises()
    expect(show).toHaveBeenCalledWith('The domain id must be a whole number', 'error')
    w.unmount()
  })

  it('restores the defaults', async () => {
    await useSettings().update({ gatewayUrl: 'https://gw.example', domainId: 8 })
    const w = await render()
    await button(w, 'Restore defaults').trigger('click')
    await flushPromises()
    expect(useSettings().settings.value.gatewayUrl).toBe(DEFAULT_GATEWAY_URL)
    expect((w.find('#gateway-url').element as HTMLInputElement).value).toBe(DEFAULT_GATEWAY_URL)
    expect(localStorage.getItem(STORAGE_KEY_SETTINGS)).toBeNull()
    w.unmount()
  })

  it('offers a domain select instead of the number input when L1 lists domains', async () => {
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 2, list: [{ domainId: 1 }, { domainId: 2 }] }),
    } as never)
    await useDomains().load()
    const w = await render()
    expect(w.find('[data-slot="domain-select"]').exists()).toBe(true)
    expect(w.find('#domain-id').exists()).toBe(false)
    w.unmount()
  })

  it('has no Console URL field', async () => {
    const w = await render()
    expect(w.text()).not.toContain('Console URL')
    expect(w.find('#console-url').exists()).toBe(false)
    w.unmount()
  })

  it('rejects an empty local runner URL', async () => {
    const w = await render()
    await w.find('#local-runner-url').setValue('')
    await button(w, 'Save').trigger('click')
    await flushPromises()
    expect(show).toHaveBeenCalledWith('The local runner URL must start with http or https', 'error')
    w.unmount()
  })

  it.each(['http://127.0.0.1:8547', 'https://runner.example'])('accepts the local runner URL %s', async (url) => {
    const w = await render()
    await w.find('#local-runner-url').setValue(url)
    await button(w, 'Save').trigger('click')
    await flushPromises()
    expect(useSettings().settings.value.localRunnerUrl).toBe(url)
    w.unmount()
  })

  it('restores the local runner URL and clears the administrator address', async () => {
    const defaults = { ...useSettings().settings.value }
    await useSettings().update({ localRunnerUrl: 'http://127.0.0.1:9', adminAddress: 'z1admin' })
    const w = await render()
    await button(w, 'Restore defaults').trigger('click')
    await flushPromises()
    expect(useSettings().settings.value.localRunnerUrl).toBe(defaults.localRunnerUrl)
    expect(useSettings().settings.value.adminAddress).toBe(defaults.adminAddress)
    expect((w.find('#admin-address').element as HTMLInputElement).value).toBe(defaults.adminAddress)
    w.unmount()
  })
})
