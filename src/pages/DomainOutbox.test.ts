import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { WithdrawalReadService } from '@/core'
import type { WithdrawalState } from '@/core'
import { useDomainHeads } from '@/core'
import { result } from '../../test/replay-client'
import { mountAt, useFakeClient } from '../../test/helpers'
import { advanceHead, button, pageOf, settled } from '../../test/lists'
import DomainOutbox from './DomainOutbox.vue'

const routes = [{ path: '/domains/:domainId(\\d+)/outbox', component: DomainOutbox }]
const messages = result<{ items: Record<string, any>[] }>('outbox getOutbox').items // eslint-disable-line @typescript-eslint/no-explicit-any
const withdrawal = {
  ...messages[0],
  outboxId: 'ab'.repeat(32),
  kind: 'L1_WITHDRAWAL',
  recipient: 'z16yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqvrvjf7',
  assetId: '00'.repeat(22) + '14e66318c6318c6318c6',
  amount: '100000000',
  targetContract: null,
}

function states(map: Record<string, WithdrawalState> = {}) {
  const statesOf = vi.fn(async () => new Map(Object.entries(map)))
  vi.spyOn(WithdrawalReadService, 'getInstance').mockReturnValue({ statesOf } as never)
  return statesOf
}

async function render(url = '/domains/1/outbox') {
  const mounted = await mountAt(url, routes)
  await settled(mounted.wrapper)
  await flushPromises()
  return mounted
}

describe('DomainOutbox', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
    useDomainHeads().errors.value = {}
  })

  it('lists the outbox of the domain at latest with a link to each message', async () => {
    states()
    const client = useFakeClient({ getOutbox: vi.fn(async () => pageOf(messages)) })
    const { wrapper } = await render()
    expect(client.getOutbox).toHaveBeenCalledWith(expect.objectContaining({ domainId: 1, toBatch: 'latest' }))
    expect(wrapper.findAll('[data-slot="outbox-table"] tbody tr')).toHaveLength(messages.length)
    expect(wrapper.find(`[data-slot="outbox-table"] a[href="/outbox/${messages[0].outboxId}"]`).exists()).toBe(true)
    expect(wrapper.find('[data-slot="batch-filter"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('sends fromBatch and toBatch 3 at ?batch=3 and no tag', async () => {
    states()
    const client = useFakeClient({ getOutbox: vi.fn(async () => pageOf(messages)) })
    const { wrapper } = await render('/domains/1/outbox?batch=3')
    const filter = client.getOutbox.mock.calls[0][0]
    expect(filter).toMatchObject({ domainId: 1, fromBatch: 3, toBatch: 3 })
    expect(wrapper.find('[data-slot="batch-filter"]').text()).toContain('Batch 3')
    expect(wrapper.find('[data-slot="tag-selector"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ignores a ?batch= that is not a number', async () => {
    states()
    const client = useFakeClient({ getOutbox: vi.fn(async () => pageOf(messages)) })
    const { wrapper } = await render('/domains/1/outbox?batch=abc')
    const filter = client.getOutbox.mock.calls[0][0]
    expect(filter).toMatchObject({ toBatch: 'latest' })
    expect(filter).not.toHaveProperty('fromBatch')
    wrapper.unmount()
  })

  it('shows the batch filter without the unreached note when the batch has no messages', async () => {
    states()
    useFakeClient({ getOutbox: vi.fn(async () => pageOf([], { batchId: null })) })
    const { wrapper } = await render('/domains/1/outbox?batch=3')
    expect(wrapper.find('[data-slot="unreached"]').exists()).toBe(false)
    expect(wrapper.find('[data-slot="outbox-table"]').text()).toContain('No outbox messages')
    wrapper.unmount()
  })

  it('shows the withdrawal state of an L1 withdrawal', async () => {
    const statesOf = states({ [withdrawal.outboxId]: 'relayable' })
    useFakeClient({ getOutbox: vi.fn(async () => pageOf([withdrawal])) })
    const { wrapper } = await render()
    await vi.waitFor(() => expect(wrapper.find('[data-slot="outbox-table"]').text()).toContain('Ready to relay'))
    expect(statesOf).toHaveBeenCalledWith(1, [withdrawal])
    wrapper.unmount()
  })

  it('shows Pending for a message with verified: false', async () => {
    states({ [withdrawal.outboxId]: 'pending' })
    useFakeClient({ getOutbox: vi.fn(async () => pageOf([{ ...withdrawal, verified: false }, messages[0]])) })
    const { wrapper } = await render()
    const states_ = wrapper.findAll('[data-slot="outbox-table"] [data-slot="verification-badge"]').map((b) => b.attributes('data-state'))
    expect(states_).toEqual(['pending', 'verified'])
    expect(wrapper.find('[data-slot="outbox-table"]').text()).toContain('Waiting for the batch')
    wrapper.unmount()
  })

  it('shows the error when the withdrawal states cannot be read, and still lists the messages', async () => {
    vi.spyOn(WithdrawalReadService, 'getInstance').mockReturnValue({
      statesOf: vi.fn().mockRejectedValue(new Error('node unreachable')),
    } as never)
    useFakeClient({ getOutbox: vi.fn(async () => pageOf([withdrawal])) })
    const { wrapper } = await render()
    await vi.waitFor(() => expect(wrapper.text()).toContain('node unreachable'))
    expect(wrapper.find('[data-slot="outbox-table"] tbody tr').exists()).toBe(true)
    wrapper.unmount()
  })

  it('says no batch has reached the tag when batchId is null and the page is empty', async () => {
    states()
    useFakeClient({ getOutbox: vi.fn(async () => pageOf([], { batchId: null })) })
    const { wrapper } = await render()
    expect(wrapper.find('[data-slot="unreached"]').text()).toBe('No batch has reached latest yet')
    wrapper.unmount()
  })

  it('reloads the newest page on a new batch and leaves an older page alone', async () => {
    states()
    const getOutbox = vi.fn(async (f: { cursor?: string }) =>
      f.cursor === 'c1' ? pageOf([messages[1]]) : pageOf([messages[0]], { nextCursor: 'c1' })
    )
    useFakeClient({ getOutbox })
    const { wrapper } = await render()
    await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
    let before = getOutbox.mock.calls.length
    advanceHead(9)
    await vi.waitFor(() => expect(getOutbox.mock.calls.length).toBe(before + 1))
    await button(wrapper, 'Older').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="page-number"]').text()).toBe('Page 2'))
    before = getOutbox.mock.calls.length
    advanceHead(10)
    await flushPromises()
    expect(getOutbox.mock.calls.length).toBe(before)
    wrapper.unmount()
  })

  it('pages Older with the cursor of the first page', async () => {
    states()
    const getOutbox = vi.fn(async (f: { cursor?: string }) =>
      f.cursor === 'c1' ? pageOf([messages[1]]) : pageOf([messages[0]], { nextCursor: 'c1' })
    )
    useFakeClient({ getOutbox })
    const { wrapper } = await render()
    await button(wrapper, 'Older').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-slot="page-number"]').text()).toBe('Page 2'))
    expect(getOutbox).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1', limit: 25 }))
    wrapper.unmount()
  })
})
