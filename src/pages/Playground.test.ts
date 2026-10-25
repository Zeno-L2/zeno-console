import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { newClient } from 'znn-typescript-sdk'
import { useSettings } from '@/core'
import { PlaygroundService } from '@/core'
import { call } from '../../test/replay-client'
import { mountAt } from '../../test/helpers'
import Playground from './Playground.vue'

vi.mock('znn-typescript-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('znn-typescript-sdk')>()),
  newClient: vi.fn(),
}))

const routes = [{ path: '/playground', component: Playground }]
const sendRequest = vi.fn()
const service = PlaygroundService.getInstance()

const render = (query = '') => mountAt(`/playground${query}`, routes)
const sendButton = (w: Awaited<ReturnType<typeof render>>['wrapper']) =>
  w.findAll('button').find((b) => b.text() === 'Send')!

async function send(w: Awaited<ReturnType<typeof render>>['wrapper']) {
  await sendButton(w).trigger('click')
  await vi.waitFor(() => expect(w.find('[data-slot="elapsed"], [data-slot="playground-error"]').exists()).toBe(true))
  await flushPromises()
}

describe('Playground', () => {
  beforeEach(() => {
    vi.mocked(newClient).mockReset()
    vi.mocked(newClient).mockReturnValue({ sendRequest } as never)
    sendRequest.mockReset()
    sendRequest.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return call('getHead').response.result
    })
  })
  afterEach(async () => {
    service.close()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    await useSettings().reset()
  })

  it('preloads the request from ?method=zeno_getHead&params=[1] and opens no transport', async () => {
    const { wrapper } = await render('?method=zeno_getHead&params=[1]')
    const body = JSON.parse((wrapper.find('textarea').element as HTMLTextAreaElement).value)
    expect(body).toMatchObject({ jsonrpc: '2.0', method: 'zeno_getHead', params: [1] })
    expect(wrapper.text()).toContain('zeno_getHead')
    expect(newClient).not.toHaveBeenCalled()
    expect(wrapper.find('[data-slot="playground-result"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('leaves the request empty without a method, and falls back to no params for unreadable ones', async () => {
    const empty = await render()
    expect((empty.wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(sendButton(empty.wrapper).attributes('disabled')).toBeDefined()
    empty.wrapper.unmount()

    const broken = await render('?method=zeno_getHead&params=%7Bnot-json')
    const body = JSON.parse((broken.wrapper.find('textarea').element as HTMLTextAreaElement).value)
    expect(body.params).toEqual([])
    broken.wrapper.unmount()
  })

  it('shows the result with the Unverified label and the elapsed time after the first send', async () => {
    await useSettings().update({ gatewayUrl: 'http://gw.example:1' })
    const { wrapper } = await render('?method=zeno_getHead&params=[1]')
    await send(wrapper)
    expect(newClient).toHaveBeenCalledTimes(1)
    expect(newClient).toHaveBeenCalledWith('http://gw.example:1')
    expect(sendRequest).toHaveBeenCalledWith('zeno_getHead', [1])
    expect(wrapper.find('[data-slot="unverified"]').text()).toBe('Unverified')
    expect(wrapper.find('[data-slot="elapsed"]').text()).toMatch(/^\d+ ms$/)
    expect(wrapper.find('[data-slot="playground-result"]').text()).toContain('Result')
    wrapper.unmount()
  })

  it('shows a gateway error with its code, with no Unverified label', async () => {
    sendRequest.mockRejectedValue({ code: -32001, message: 'unknown domain 99' })
    const { wrapper } = await render('?method=zeno_getHead&params=[99]')
    await send(wrapper)
    expect(wrapper.find('[data-slot="rpc-error"]').text()).toContain('-32001')
    expect(wrapper.find('[data-slot="rpc-error"]').text()).toContain('unknown domain 99')
    expect(wrapper.find('[data-slot="unverified"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([
    ['embedded.settlement.getBatch', 'Only zeno_* methods'],
    ['zeno_subscribe', 'Subscriptions'],
  ])('refuses %s before any request', async (method, message) => {
    const { wrapper } = await render(`?method=${method}&params=[1]`)
    await send(wrapper)
    expect(wrapper.find('[data-slot="playground-error"]').text()).toContain(message)
    expect(newClient).not.toHaveBeenCalled()
    expect(sendRequest).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('reports invalid JSON without sending', async () => {
    const { wrapper } = await render()
    await wrapper.find('textarea').setValue('{ nope')
    await send(wrapper)
    expect(wrapper.find('[data-slot="playground-error"]').text()).toContain('Invalid JSON')
    expect(newClient).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('reports a request without a method or with non-array params without sending', async () => {
    const { wrapper } = await render()
    await wrapper.find('textarea').setValue('{"params":[1]}')
    await send(wrapper)
    expect(wrapper.find('[data-slot="playground-error"]').text()).toContain('"method"')

    await wrapper.find('textarea').setValue('{"method":"zeno_getHead","params":{"a":1}}')
    await send(wrapper)
    expect(wrapper.find('[data-slot="playground-error"]').text()).toContain('"params" must be an array')
    expect(newClient).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('closes the transport on unmount', async () => {
    const close = vi.spyOn(service, 'close')
    const { wrapper } = await render('?method=zeno_getHead&params=[1]')
    await send(wrapper)
    expect(close).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
