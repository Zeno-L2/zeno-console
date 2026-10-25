import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { SettlementService } from '@/core'
import { fixture } from '../../test/rpc-fixture'
import { mountAt, useFakeNode } from '../../test/helpers'
import DomainBatches from './DomainBatches.vue'

const routes = [{ path: '/domains/:domainId(\\d+)/batches', component: DomainBatches }]

const batchOf = (batchId: number) => ({ ...fixture.batches.list[0], batchId })

function serve(count: number) {
  const getBatches = vi.fn(async (domainId: number, page: number, size: number) => ({
    count,
    list: Array.from({ length: Math.max(0, Math.min(size, count - page * size)) }, (_, i) => batchOf(count - page * size - i)).map(
      (b) => ({ ...fixture.batches.list[0], ...b, domainId })
    ),
  }))
  return getBatches
}

describe('DomainBatches', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('lists the domain batches newest first, each linking to its detail page', async () => {
    useFakeNode()
    const getBatches = serve(3)
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({ getBatches } as never)
    const { wrapper } = await mountAt('/domains/3/batches', routes)
    await vi.waitFor(() => expect(wrapper.find('[data-slot="batch-table"] tbody tr').exists()).toBe(true))
    expect(getBatches).toHaveBeenCalledWith(3, 0, 25)
    const links = wrapper.findAll('[data-slot="batch-table"] tbody a').map((a) => a.attributes('href'))
    expect(links).toEqual(['/batches/3/3', '/batches/3/2', '/batches/3/1'])
    expect(wrapper.find('[data-slot="batch-count"]').text()).toBe('3 batches')
    wrapper.unmount()
  })

  it('says no batch was submitted for an empty domain', async () => {
    useFakeNode()
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({ getBatches: serve(0) } as never)
    const { wrapper } = await mountAt('/domains/3/batches', routes)
    await vi.waitFor(() => expect(wrapper.text()).toContain('No batch has been submitted yet.'))
    expect(wrapper.find('[data-slot="batch-count"]').text()).toBe('0 batches')
    wrapper.unmount()
  })

  it('pages by page number', async () => {
    useFakeNode()
    const getBatches = serve(60)
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({ getBatches } as never)
    const { wrapper } = await mountAt('/domains/3/batches', routes)
    await vi.waitFor(() => expect(wrapper.find('[data-slot="batch-table"] tbody tr').exists()).toBe(true))
    const pages = wrapper.findAll('[data-slot="pagination-item"]')
    expect(pages.map((p) => p.text())).toEqual(['1', '2', '3'])
    await pages[1].trigger('click')
    await vi.waitFor(() => expect(getBatches).toHaveBeenCalledWith(3, 1, 25))
    await flushPromises()
    await wrapper.findAll('[data-slot="pagination-item"]')[0].trigger('click')
    await vi.waitFor(() => expect(getBatches).toHaveBeenLastCalledWith(3, 0, 25))
    wrapper.unmount()
  })

  it('shows the error when the batches cannot be read', async () => {
    useFakeNode()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getBatches: vi.fn().mockRejectedValue(new Error('node unreachable')),
    } as never)
    const { wrapper } = await mountAt('/domains/3/batches', routes)
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))
    wrapper.unmount()
  })
})
