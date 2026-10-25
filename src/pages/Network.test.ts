import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useNetwork } from '@/core'
import { useDomains } from '@/core'
import { fixture } from '../../test/rpc-fixture'
import { mountAt, useFakeNode, useRecordedSettlement } from '../../test/helpers'
import Network from './Network.vue'

const routes = [{ path: '/network', component: Network }]
const emptyQueue = { head: 0, tail: 0, count: 0, list: [] }

async function render(overrides: Record<string, unknown> = {}) {
  useFakeNode()
  useRecordedSettlement({ 'embedded.settlement.getReleaseQueue': emptyQueue, ...overrides })
  await useDomains().load()
  const { wrapper } = await mountAt('/network', routes)
  await vi.waitFor(() => expect(wrapper.find('[data-slot="pause-table"]').exists()).toBe(true))
  await flushPromises()
  return wrapper
}

const cells = (w: Awaited<ReturnType<typeof render>>, slot: string) =>
  w.find(`[data-slot="${slot}"]`).findAll('td').map((c) => c.text())

describe('Network', () => {
  beforeEach(() => {
    useNetwork().isConnected.value = true
  })
  afterEach(() => {
    useNetwork().isConnected.value = false
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('shows a domain as relay-paused when only the global flag is set', async () => {
    const w = await render({
      'embedded.settlement.getPauseState': { global: { submitPaused: false, relayPaused: true }, domains: [] },
    })
    expect(cells(w, 'pause-global')).toEqual(['All domains', 'Active', 'Paused'])
    expect(cells(w, 'pause-3')).toEqual(['Domain 3', 'Active', 'Paused'])
    expect(cells(w, 'pause-4')).toEqual(['Domain 4', 'Active', 'Paused'])
    w.unmount()
  })

  it('shows a domain as submit-paused when only the global submit flag is set', async () => {
    const w = await render({
      'embedded.settlement.getPauseState': { global: { submitPaused: true, relayPaused: false }, domains: [] },
    })
    expect(cells(w, 'pause-3')).toEqual(['Domain 3', 'Paused', 'Active'])
    w.unmount()
  })

  it("pauses only the domain whose own flag is set when the global flags are clear", async () => {
    const w = await render({
      'embedded.settlement.getPauseState': {
        global: { submitPaused: false, relayPaused: false },
        domains: [{ domainId: 3, submitPaused: false, relayPaused: true }],
      },
    })
    expect(cells(w, 'pause-3')).toEqual(['Domain 3', 'Active', 'Paused'])
    expect(cells(w, 'pause-4')).toEqual(['Domain 4', 'Active', 'Active'])
    w.unmount()
  })

  it('lists every registered domain and the custody read from Settlement', async () => {
    const w = await render()
    expect(w.findAll('a[href="/domains/3"]').length).toBeGreaterThan(0)
    expect(w.findAll('a[href="/domains/4"]').length).toBeGreaterThan(0)
    await vi.waitFor(() => expect(w.find('[data-slot="custody-table"]').text()).toContain('ZNN'))
    expect(w.find('[data-slot="custody-table"]').text()).toContain('QSR')
    expect(fixture.allDomains.count).toBe(2)
    w.unmount()
  })

  it('shows a custody error instead of the table when the queue read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const w = await render({ 'embedded.settlement.getReleaseQueue': undefined })
    await vi.waitFor(() => expect(w.text()).toContain('Cannot read properties of undefined'))
    expect(w.find('[data-slot="custody-table"]').exists()).toBe(false)
    w.unmount()
  })
})
