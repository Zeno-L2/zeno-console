import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { GatewayVerificationError, TagUnavailableError, UnknownDomainError } from 'zeno-client'
import { useDomainHeads } from '@/core'
import { altered, result } from '../../test/replay-client'
import { mountAt, useFakeClient } from '../../test/helpers'
import { advanceHead, button, pageOf, settled } from '../../test/lists'
import DomainInputs from './DomainInputs.vue'

const routes = [{ path: '/domains/:domainId(\\d+)/inputs', component: DomainInputs }]
const recorded = result<{ items: Record<string, any>[] }>('getInputs by contract') // eslint-disable-line @typescript-eslint/no-explicit-any
const items = recorded.items.slice(0, 3)

async function render(url = '/domains/1/inputs') {
  const mounted = await mountAt(url, routes)
  await settled(mounted.wrapper)
  await flushPromises()
  return mounted
}

describe('DomainInputs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
    useDomainHeads().errors.value = {}
  })

  it('lists the inputs of the domain at latest, each row linking to its send', async () => {
    const client = useFakeClient({ getInputs: vi.fn(async () => pageOf(items)) })
    const { wrapper } = await render()
    expect(client.getInputs).toHaveBeenCalledWith(expect.objectContaining({ domainId: 1, toBatch: 'latest', limit: 25 }))
    expect(wrapper.findAll('[data-slot="input-table"] tbody tr')).toHaveLength(3)
    expect(wrapper.find(`[data-slot="input-table"] a[href="/tx/${items[0].sendHash}"]`).exists()).toBe(true)
    expect(wrapper.find('[data-slot="page-number"]').text()).toBe('Page 1')
    wrapper.unmount()
  })

  it('shows a verified and a pending badge per row', async () => {
    const mixed = [items[0], { ...items[1], verified: false }]
    useFakeClient({ getInputs: vi.fn(async () => pageOf(mixed)) })
    const { wrapper } = await render()
    const states = wrapper.findAll('[data-slot="input-table"] [data-slot="verification-badge"]').map((b) => b.attributes('data-state'))
    expect(states).toEqual(['verified', 'pending'])
    wrapper.unmount()
  })

  it('shows an inconsistent badge on every row when the domain head is INCONSISTENT', async () => {
    const client = useFakeClient({ getInputs: vi.fn(async () => pageOf(items)) })
    client.getHead.mockResolvedValue(altered('getHead', (r) => { r.status = 'INCONSISTENT'; r.inconsistentAt = 2 }).response.result)
    const { wrapper } = await render()
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]?.status).toBe('INCONSISTENT'))
    await flushPromises()
    const states = wrapper.findAll('[data-slot="input-table"] [data-slot="verification-badge"]').map((b) => b.attributes('data-state'))
    expect(states).toEqual(['inconsistent', 'inconsistent', 'inconsistent'])
    expect(wrapper.find('[data-slot="inconsistent-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('says no batch has reached the tag when batchId is null and the page is empty', async () => {
    useFakeClient({ getInputs: vi.fn(async () => pageOf([], { batchId: null })) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="unreached"]').text()).toBe('No batch has reached latest yet')
    expect(wrapper.find('[data-slot="input-table"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the empty table, not the unreached note, for an empty page of a reached batch', async () => {
    useFakeClient({ getInputs: vi.fn(async () => pageOf([])) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="unreached"]').exists()).toBe(false)
    expect(wrapper.find('[data-slot="input-table"]').text()).toContain('No inputs')
    wrapper.unmount()
  })

  it('moves Older then Newer through the cursors', async () => {
    const getInputs = vi.fn(async (f: { cursor?: string }) =>
      f.cursor === 'c1' ? pageOf([items[2]], { nextCursor: null }) : pageOf(items.slice(0, 2), { nextCursor: 'c1' })
    )
    useFakeClient({ getInputs })
    const { wrapper } = await render()
    expect(button(wrapper, 'Older').attributes('disabled')).toBeUndefined()
    expect(button(wrapper, 'Newer').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Older').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="page-number"]').text()).toBe('Page 2'))
    expect(getInputs).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }))
    expect(wrapper.findAll('[data-slot="input-table"] tbody tr')).toHaveLength(1)
    expect(button(wrapper, 'Older').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Newer').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="page-number"]').text()).toBe('Page 1'))
    expect(wrapper.findAll('[data-slot="input-table"] tbody tr')).toHaveLength(2)
    wrapper.unmount()
  })

  it('keeps Older enabled on a short page that carries a cursor', async () => {
    useFakeClient({ getInputs: vi.fn(async () => pageOf([items[0]], { nextCursor: 'budget' })) })
    const { wrapper } = await render()
    expect(button(wrapper, 'Older').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('filters by input kind when a number is typed', async () => {
    const client = useFakeClient({ getInputs: vi.fn(async () => pageOf(items)) })
    const { wrapper } = await render()
    expect(client.getInputs.mock.calls[0][0].inputKind).toBeUndefined()
    await wrapper.find('[data-slot="kind-filter"]').setValue('6')
    await vi.waitFor(() => expect(client.getInputs).toHaveBeenLastCalledWith(expect.objectContaining({ inputKind: 6 })))
    wrapper.unmount()
  })

  it('reloads the newest page when the head moves to a new batch', async () => {
    const client = useFakeClient({ getInputs: vi.fn(async () => pageOf(items)) })
    const { wrapper } = await render()
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    const before = client.getInputs.mock.calls.length
    advanceHead(9)
    await vi.waitFor(() => expect(client.getInputs.mock.calls.length).toBe(before + 1))
    wrapper.unmount()
  })

  it('does not reload when the head changes only its status', async () => {
    const client = useFakeClient({ getInputs: vi.fn(async () => pageOf(items)) })
    const { wrapper } = await render()
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    const before = client.getInputs.mock.calls.length
    const head = useDomainHeads().heads.value[1]
    useDomainHeads().heads.value = { 1: { ...head, status: 'INCONSISTENT' } }
    await flushPromises()
    expect(client.getInputs.mock.calls.length).toBe(before)
    wrapper.unmount()
  })

  it('does not reload an older page when the head moves', async () => {
    const getInputs = vi.fn(async (f: { cursor?: string }) =>
      f.cursor === 'c1' ? pageOf([items[2]]) : pageOf(items.slice(0, 2), { nextCursor: 'c1' })
    )
    useFakeClient({ getInputs })
    const { wrapper } = await render()
    await button(wrapper, 'Older').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="page-number"]').text()).toBe('Page 2'))
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    const before = getInputs.mock.calls.length
    advanceHead(9)
    await flushPromises()
    expect(getInputs.mock.calls.length).toBe(before)
    wrapper.unmount()
  })

  it('shows the error text when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useFakeClient({ getInputs: vi.fn().mockRejectedValue(new Error('boom')) })
    const { wrapper } = await render()
    expect(wrapper.find('[role="alert"]').text()).toContain('boom')
    wrapper.unmount()
  })

  it('says the gateway does not serve an unknown domain', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useFakeClient({ getInputs: vi.fn().mockRejectedValue(new UnknownDomainError('unknown domain 9', -32001)) })
    const { wrapper } = await mountAt('/domains/9/inputs', routes)
    await vi.waitFor(() => expect(wrapper.find('[data-slot="unknown-domain"]').exists()).toBe(true))
    expect(wrapper.find('[data-slot="unknown-domain"]').text()).toContain('does not serve domain 9')
    wrapper.unmount()
  })

  it('shows the failed-check alert when a gateway proof does not verify', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useFakeClient({ getInputs: vi.fn().mockRejectedValue(new GatewayVerificationError('zeno_getInputs', 'input root')) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="failed-check"]').text()).toContain('input root failed')
    wrapper.unmount()
  })

  it('falls back from pending to latest and says so', async () => {
    const getInputs = vi.fn(async (f: { toBatch: string }) => {
      if (f.toBatch === 'pending') throw new TagUnavailableError('no pending', -32004)
      return pageOf(items)
    })
    useFakeClient({ getInputs })
    const { wrapper } = await render()
    const pending = wrapper.findAll('[data-slot="tag-selector"] button').find((b) => b.text() === 'Pending')!
    await pending.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="tag-fallback"]').exists()).toBe(true))
    expect(wrapper.find('[data-slot="tag-fallback"]').text()).toContain('latest accepted state')
    wrapper.unmount()
  })
})
