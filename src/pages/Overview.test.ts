import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { settlement as settlementConsts } from 'znn-typescript-sdk'
import { useDomains } from '@/core'
import { gatewayService, mountAt, useFakeNode, useRecordedSettlement } from '../../test/helpers'
import Overview from './Overview.vue'

const routes = [{ path: '/', component: Overview }]

async function render() {
  useFakeNode(1234)
  useRecordedSettlement()
  await useDomains().load()
  const { wrapper } = await mountAt('/', routes)
  await flushPromises()
  return wrapper
}

const tiles = (w: Awaited<ReturnType<typeof render>>) => w.find('[data-slot="stat-tiles"]')

describe('Overview', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('shows the L1 height and the domain count', async () => {
    const w = await render()
    await vi.waitFor(() => expect(tiles(w).text()).toContain('1,234'))
    expect(tiles(w).text()).toMatch(/Domains\s*2/)
    w.unmount()
  })

  it('sums the inputs received and counts the paused domains across every domain', async () => {
    const w = await render()
    const { domains } = useDomains()
    const sum = domains.value.reduce((total, d) => total + d.receivedInputCount, 0)
    const paused = domains.value.filter((d) => d.status === settlementConsts.DomainStatus.PAUSED).length
    expect(w.find('[data-slot="tile-inputs"]').text()).toContain(sum.toLocaleString())
    expect(w.find('[data-slot="tile-paused"]').text()).toContain(String(paused))
    w.unmount()
  })

  it('links each domain card to its overview', async () => {
    const w = await render()
    const links = w.findAll('[data-slot="domain-cards"] a').map((a) => a.attributes('href'))
    expect(links).toEqual(useDomains().domains.value.map((d) => `/domains/${d.domainId}`))
    w.unmount()
  })

  it('reads nothing from the gateway', async () => {
    const client = vi.spyOn(gatewayService, 'client')
    const w = await render()
    expect(client).not.toHaveBeenCalled()
    w.unmount()
  })
})
