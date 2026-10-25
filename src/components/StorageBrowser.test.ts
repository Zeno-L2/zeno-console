import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { TooltipProvider } from 'nom-ui'
import { GatewayVerificationError, parseInterface } from 'zeno-client'
import type { ContractInterface } from 'zeno-client'
import { useFakeClient } from '../../test/helpers'
import StorageBrowser from './StorageBrowser.vue'

const CONTRACT = 'f3'.repeat(32)

const iface: ContractInterface = parseInterface({
  interface_version: 1,
  encoding: 'zeno-selector-v1',
  code_hash: '39'.repeat(32),
  methods: [],
  on_deposit: null,
  events: [],
  errors: [],
  storage: [
    {
      name: 'total',
      kind: 'item',
      namespace: '0x01',
      key: [],
      hashed: false,
      value: 'u64',
      description: 'The running total.',
    },
    {
      name: 'balances',
      kind: 'map',
      namespace: '0x02',
      key: [{ name: 'id', type: 'u64' }],
      hashed: false,
      value: 'u256',
    },
  ],
})

const hex64 = (n: number) => n.toString(16).padStart(16, '0')
const hex256 = (n: number) => n.toString(16).padStart(64, '0')

type Stored = { present: boolean; value: string | null }
const view = (stored: Stored, extra: Record<string, unknown> = {}) => ({
  result: stored,
  verified: true,
  batchId: 3,
  ...extra,
})

/** A gateway whose storage view answers from `rows`, keyed by local key hex. */
function useStorage(rows: Record<string, string>, extra: Record<string, unknown> = {}) {
  const storage = vi.fn(async (_id: string, key: string) =>
    view(
      rows[key] === undefined
        ? { present: false, value: null }
        : { present: true, value: rows[key] },
      extra
    )
  )
  useFakeClient({ contracts: vi.fn(async () => ({ storage })) })
  return storage
}

async function render(props: Partial<InstanceType<typeof StorageBrowser>['$props']> = {}) {
  const wrapper = mount(
    {
      render: () =>
        h(TooltipProvider, null, () =>
          h(StorageBrowser, {
            domainId: 1,
            contractId: CONTRACT,
            iface,
            tag: 'latest',
            domainStatus: null,
            ...props,
          })
        ),
    },
    { attachTo: document.body }
  )
  await flushPromises()
  return wrapper
}

const entry = (w: Awaited<ReturnType<typeof render>>, name: string) =>
  w.find(`[data-slot="storage-entry"][data-name="${name}"]`)

describe('StorageBrowser', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('reads every item on mount through the interface file and shows the decoded value with its badge', async () => {
    const storage = useStorage({ '01': hex64(16) })
    const w = await render()
    expect(storage).toHaveBeenCalledTimes(1)
    expect(storage).toHaveBeenCalledWith(CONTRACT, '01', 'latest')
    const total = entry(w, 'total')
    expect(total.find('[data-slot="storage-value"]').text()).toBe('16')
    expect(total.find('[data-slot="verification-badge"]').attributes('data-state')).toBe('verified')
    expect(total.text()).toContain('The running total.')
    w.unmount()
  })

  it('reads a map entry only after the typed key is entered, at the namespace plus the encoded key', async () => {
    const storage = useStorage({ '020000000000000003': hex256(250) })
    const w = await render()
    const card = entry(w, 'balances')
    const read = card.findAll('button').find((b) => b.text() === 'Read')!
    expect(read.attributes('disabled')).toBeDefined()
    expect(card.find('[data-slot="storage-result"]').exists()).toBe(false)
    await card.find('input').setValue('3')
    expect(read.attributes('disabled')).toBeUndefined()
    await read.trigger('click')
    await flushPromises()
    expect(storage).toHaveBeenLastCalledWith(CONTRACT, '020000000000000003', 'latest')
    expect(card.find('[data-slot="storage-value"]').text()).toBe('250')
    expect(card.find('[data-slot="verification-badge"]').attributes('data-state')).toBe('verified')
    w.unmount()
  })

  it('rejects a map key that does not parse and does not enable Read', async () => {
    const storage = useStorage({})
    const w = await render()
    const card = entry(w, 'balances')
    await card.find('input').setValue('not a number')
    expect(card.find('[role="alert"], [data-slot="field-error"]').exists()).toBe(true)
    expect(
      card
        .findAll('button')
        .find((b) => b.text() === 'Read')!
        .attributes('disabled')
    ).toBeDefined()
    expect(storage).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('reads a raw localKey without an interface file and shows the stored bytes', async () => {
    const storage = useStorage({ '00': 'deadbeef' })
    const w = await render({ iface: null })
    expect(w.find('[data-slot="no-interface"]').exists()).toBe(true)
    expect(storage).not.toHaveBeenCalled()
    const card = entry(w, 'localKey')
    await card.find('input').setValue('0x00')
    await card
      .findAll('button')
      .find((b) => b.text() === 'Read')!
      .trigger('click')
    await flushPromises()
    expect(storage).toHaveBeenCalledWith(CONTRACT, '00', 'latest')
    expect(card.text()).toContain('deadbeef')
    expect(card.find('[data-slot="verification-badge"]').attributes('data-state')).toBe('verified')
    w.unmount()
  })

  it('shows Not set for a path that is absent', async () => {
    useStorage({})
    const w = await render()
    expect(entry(w, 'total').find('[data-slot="storage-not-set"]').text()).toBe('Not set')
    expect(
      entry(w, 'total').find('[data-slot="verification-badge"]').attributes('data-state')
    ).toBe('verified')
    w.unmount()
  })

  it('shows Pending for a value the gateway did not verify', async () => {
    useStorage({ '01': hex64(1) }, { verified: false })
    const w = await render()
    expect(
      entry(w, 'total').find('[data-slot="verification-badge"]').attributes('data-state')
    ).toBe('pending')
    w.unmount()
  })

  it('shows Inconsistent on every read when the domain is INCONSISTENT', async () => {
    useStorage({ '01': hex64(1) })
    const w = await render({ domainStatus: 'INCONSISTENT' })
    expect(
      entry(w, 'total').find('[data-slot="verification-badge"]').attributes('data-state')
    ).toBe('inconsistent')
    w.unmount()
  })

  it('shows the bytes and a decode error when the stored value has the wrong length', async () => {
    useStorage({ '01': 'aabb' })
    const w = await render()
    const card = entry(w, 'total')
    expect(card.find('[data-slot="storage-error"]').text()).toContain('2 bytes')
    expect(card.text()).toContain('aabb')
    w.unmount()
  })

  it('falls back to a raw local key when the interface encoding has no encoder', async () => {
    useStorage({})
    const w = await render({ iface: { ...iface, encoding: 'other-v9' } as ContractInterface })
    expect(w.find('[data-slot="unsupported-encoding"]').exists()).toBe(true)
    expect(entry(w, 'localKey').exists()).toBe(true)
    expect(entry(w, 'total').exists()).toBe(false)
    w.unmount()
  })

  it('shows the read error and no value when the gateway fails', async () => {
    const storage = vi.fn(async () => {
      throw new Error('gateway down')
    })
    useFakeClient({ contracts: vi.fn(async () => ({ storage })) })
    const w = await render()
    const card = entry(w, 'total')
    expect(card.find('[data-slot="storage-error"]').text()).toBe('gateway down')
    expect(card.find('[data-slot="storage-result"]').exists()).toBe(false)
    w.unmount()
  })

  it('shows an Inconsistent badge on the item card when the first read fails its proof check', async () => {
    const storage = vi.fn(async () => {
      throw new GatewayVerificationError('zeno_read', 'storage proof')
    })
    useFakeClient({ contracts: vi.fn(async () => ({ storage })) })
    const w = await render()
    const total = entry(w, 'total')
    expect(total.find('[data-slot="storage-error"]').exists()).toBe(true)
    expect(total.find('[data-slot="verification-badge"]').attributes('data-state')).toBe(
      'inconsistent'
    )
    w.unmount()
  })

  it('starts empty and reads again when the contract changes', async () => {
    const storage = useStorage({ '01': hex64(7) })
    const w = mount(StorageBrowser, {
      props: { domainId: 1, contractId: CONTRACT, iface, tag: 'latest', domainStatus: null },
      global: { stubs: { VerificationBadge: true } },
    })
    await flushPromises()
    await w.setProps({ contractId: 'a1'.repeat(32) })
    await flushPromises()
    expect(storage).toHaveBeenLastCalledWith('a1'.repeat(32), '01', 'latest')
    w.unmount()
  })
})
