import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { toast } from 'vue-sonner'
import { GatewayClient, parseInterface } from 'zeno-client'
import { DEFAULT_PAGE_SIZE } from '@/config'
import { ContractRegistryService, useSettings } from '@/core'
import { useDomainHeads } from '@/core'
import { altered, call, calls, emptyPage, result } from '../../test/replay-client'
import { mountAt, useFakeClient, useRecordedGateway } from '../../test/helpers'
import { advanceHead, button, pageOf } from '../../test/lists'
import { connectWallet, disconnectWallet } from '@/core/composables/call-test-helpers'
import ContractDetail from './ContractDetail.vue'

const routes = [{ path: '/contracts/:domainId(\\d+)/:contractId', component: ContractDetail }]
const CONTRACT_ID = (call('read contract').params as [number, string, { contractId: string }])[2]
  .contractId
const ABSENT_ID = (
  call('read contract absent').params as [number, string, { contractId: string }]
)[2].contractId
const SOURCE_HASH = (result('read contract') as { result: { sourceCodeHash: string } }).result
  .sourceCodeHash
const SENDER = 'z16yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqvrvjf7'

const ifaceOf = (codeHash: string) => ({
  interface_version: 1,
  encoding: 'zeno-selector-v1',
  code_hash: codeHash,
  methods: [],
  on_deposit: null,
  events: [],
  errors: [],
  storage: [
    { name: 'total', kind: 'item', namespace: '0x01', key: [], hashed: false, value: 'u64' },
  ],
})

const mapIfaceOf = (codeHash: string) => ({
  ...ifaceOf(codeHash),
  storage: [
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

/** An in-memory registry, holding `iface` for the recorded contract when given. */
function useRegistry(iface?: ReturnType<typeof ifaceOf | typeof mapIfaceOf>) {
  const rows = new Map<string, unknown>()
  if (iface) {
    rows.set('zeno-contracts', {
      [`1:${CONTRACT_ID}`]: { contractId: CONTRACT_ID, domainId: 1, iface, addedAt: 1 },
    })
  }
  const storage = {
    get: async <T>(key: string) =>
      (rows.has(key) ? structuredClone(rows.get(key)) : null) as T | null,
    set: vi.fn(async <T>(key: string, value: T) => void rows.set(key, structuredClone(value))),
    remove: async (key: string) => void rows.delete(key),
  }
  vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue(
    new ContractRegistryService(storage as never, () => 2)
  )
  return storage
}

async function render(url = `/contracts/1/${CONTRACT_ID}`) {
  const { wrapper, router } = await mountAt(url, routes)
  await vi.waitFor(() =>
    expect(wrapper.find('[data-slot="verification-badge"], [role="alert"]').exists()).toBe(true)
  )
  await flushPromises()
  return { wrapper, router }
}

const state = (w: VueWrapper) => w.find('[data-slot="verification-badge"]').attributes('data-state')
const activeTab = (w: VueWrapper) => w.find('[role="tab"][data-state="active"]').text()

describe('ContractDetail', () => {
  const settingsBefore = { ...useSettings().settings.value }

  beforeEach(() => {
    useRegistry()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    useDomainHeads().heads.value = {}
    useDomainHeads().errors.value = {}
    useSettings().settings.value = { ...settingsBefore }
  })

  describe('Overview', () => {
    it('shows a verified contract with its code hashes, policy and quota', async () => {
      useRecordedGateway()
      const { wrapper } = await render()
      expect(state(wrapper)).toBe('verified')
      const text = wrapper.text()
      expect(text).toContain('IMMUTABLE')
      expect(text).toContain('CodeHash')
      expect(text).toContain('0 / 0 bytes')
      expect(text).toContain('Download module')
      expect(wrapper.find('a[href="/domains/1"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('shows Pending for a result the gateway did not verify', async () => {
      useRecordedGateway([
        altered('read contract', (r) => {
          r.verified = false
        }),
      ])
      const { wrapper } = await render()
      expect(state(wrapper)).toBe('pending')
      wrapper.unmount()
    })

    it('shows Inconsistent and no contract data when a proof was tampered with', async () => {
      useRecordedGateway([
        altered('read contract', (r) => {
          const value = Buffer.from(r.proofs[0].value, 'hex')
          value[0] ^= 1
          r.proofs[0].value = value.toString('hex')
        }),
      ])
      const { wrapper } = await render()
      expect(state(wrapper)).toBe('inconsistent')
      expect(wrapper.text()).toContain('A check failed')
      expect(wrapper.text()).not.toContain('IMMUTABLE')
      wrapper.unmount()
    })

    it('shows Inconsistent and the banner when the domain head is INCONSISTENT', async () => {
      useRecordedGateway([
        altered('getHead', (r) => {
          r.status = 'INCONSISTENT'
          r.inconsistentAt = 2
        }),
      ])
      const { wrapper } = await render()
      await vi.waitFor(() =>
        expect(wrapper.find('[data-slot="inconsistent-banner"]').exists()).toBe(true)
      )
      expect(state(wrapper)).toBe('inconsistent')
      wrapper.unmount()
    })

    it('says there is no contract when the id is absent at that tag', async () => {
      useRecordedGateway()
      const { wrapper } = await render(`/contracts/1/${ABSENT_ID}`)
      expect(state(wrapper)).toBe('verified')
      expect(wrapper.text()).toContain('No contract at this id')
      expect(wrapper.text()).not.toContain('Download module')
      wrapper.unmount()
    })

    it('shows the "Not a contract id" alert and reads nothing for an id that is not 64 hex characters', async () => {
      const requests = useRecordedGateway()
      const { wrapper } = await mountAt('/contracts/1/not-an-id', routes)
      await flushPromises()
      expect(wrapper.find('[role="alert"]').text()).toContain('Not a contract id')
      expect(wrapper.find('[data-slot="verification-badge"]').exists()).toBe(false)
      expect(requests.filter((r) => r.method === 'zeno_read')).toHaveLength(0)
      wrapper.unmount()
    })

    it('shows no Native address row for another runtimeKind whose chainInfo sets no nativeAddresses', async () => {
      useRecordedGateway([
        altered('chainInfo', (r) => {
          r.runtimeKind = 'OTHER'
          for (const profile of r.profiles) delete profile.features.nativeAddresses
        }),
      ])
      const { wrapper } = await render()
      expect(state(wrapper)).toBe('verified')
      expect(wrapper.text()).toContain('IMMUTABLE')
      expect(wrapper.text()).not.toContain('Native address')
      wrapper.unmount()
    })

    it('clears the old contract when the route moves to another id', async () => {
      useRecordedGateway()
      const { wrapper, router } = await render()
      expect(wrapper.text()).toContain('IMMUTABLE')
      await router.push(`/contracts/1/${ABSENT_ID}`)
      await vi.waitFor(() => expect(wrapper.text()).toContain('No contract at this id'))
      expect(wrapper.text()).not.toContain('IMMUTABLE')
      wrapper.unmount()
    })
  })

  describe('inconsistent read', () => {
    it('shows one banner with the error text and no red paragraph when the read answers -32003', async () => {
      const read = call('read contract')
      useRecordedGateway([
        {
          ...read,
          response: { error: { code: -32003, message: 'domain 1 is inconsistent at batch 2' } },
        },
      ])
      const { wrapper } = await mountAt(`/contracts/1/${CONTRACT_ID}`, routes)
      await vi.waitFor(() =>
        expect(wrapper.find('[data-slot="inconsistent-banner"]').exists()).toBe(true)
      )
      await flushPromises()
      expect(wrapper.findAll('[data-slot="inconsistent-banner"]')).toHaveLength(1)
      expect(wrapper.find('[data-slot="inconsistent-banner"]').text()).toContain(
        'domain 1 is inconsistent at batch 2'
      )
      expect(wrapper.find('[data-slot="contract-error"]').exists()).toBe(false)
      wrapper.unmount()
    })
  })

  describe('tabs', () => {
    it('opens Events for #events', async () => {
      useRecordedGateway([
        emptyPage('zeno_getEvents', { domainId: 1, contractId: CONTRACT_ID, toBatch: 'latest', limit: DEFAULT_PAGE_SIZE }),
      ])
      const { wrapper } = await render(`/contracts/1/${CONTRACT_ID}#events`)
      expect(activeTab(wrapper)).toBe('Events')
      wrapper.unmount()
    })

    it('opens Overview for an unknown fragment', async () => {
      useRecordedGateway()
      const { wrapper } = await render(`/contracts/1/${CONTRACT_ID}#bogus`)
      expect(activeTab(wrapper)).toBe('Overview')
      expect(wrapper.text()).toContain('IMMUTABLE')
      wrapper.unmount()
    })

    it('writes the fragment of the tab that is clicked', async () => {
      useRecordedGateway()
      const { wrapper, router } = await render()
      await wrapper
        .findAll('[role="tab"]')
        .find((t) => t.text() === 'State')!
        .trigger('mousedown')
      await vi.waitFor(() => expect(router.currentRoute.value.hash).toBe('#state'))
      wrapper.unmount()
    })
  })

  describe('State', () => {
    it('reads an item through the saved interface file and shows its badge', async () => {
      useRegistry(ifaceOf(SOURCE_HASH))
      const storage = vi.fn(async () => ({
        result: { present: true, value: '0000000000000010' },
        verified: true,
        batchId: 3,
      }))
      useFakeClient({
        contracts: vi.fn(async () => ({
          features: {},
          interfaceEncodings: [],
          contract: async () => result('read contract'),
          storage,
        })),
      })
      const { wrapper } = await mountAt(`/contracts/1/${CONTRACT_ID}#state`, routes)
      await vi.waitFor(() =>
        expect(wrapper.find('[data-slot="storage-value"]').exists()).toBe(true)
      )
      expect(storage).toHaveBeenCalledWith(CONTRACT_ID, '01', 'latest')
      expect(wrapper.find('[data-slot="storage-value"]').text()).toBe('16')
      expect(
        wrapper
          .find('[data-slot="storage-entry"] [data-slot="verification-badge"]')
          .attributes('data-state')
      ).toBe('verified')
      wrapper.unmount()
    })

    it('keeps the typed map key and its value, and reads again, when the head moves', async () => {
      useRegistry(mapIfaceOf(SOURCE_HASH))
      const storage = vi.fn(async () => ({
        result: { present: true, value: (250).toString(16).padStart(64, '0') },
        verified: true,
        batchId: 3,
      }))
      useFakeClient({
        contracts: vi.fn(async () => ({
          features: {},
          interfaceEncodings: [],
          contract: async () => result('read contract'),
          storage,
        })),
      })
      const { wrapper } = await mountAt(`/contracts/1/${CONTRACT_ID}#state`, routes)
      await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
      const card = () => wrapper.find('[data-slot="storage-entry"][data-name="balances"]')
      await vi.waitFor(() => expect(card().find('input').exists()).toBe(true))
      await card().find('input').setValue('3')
      await button(card() as never, 'Read').trigger('click')
      await vi.waitFor(() => expect(card().find('[data-slot="storage-value"]').exists()).toBe(true))
      expect(storage).toHaveBeenCalledTimes(1)
      advanceHead(99)
      await vi.waitFor(() => expect(storage).toHaveBeenCalledTimes(2))
      await flushPromises()
      expect((card().find('input').element as HTMLInputElement).value).toBe('3')
      expect(card().find('[data-slot="storage-value"]').text()).toBe('250')
      wrapper.unmount()
    })

    it('reads a raw localKey without an interface file and shows Not set for the recorded absent path', async () => {
      useRecordedGateway()
      const { wrapper } = await render(`/contracts/1/${CONTRACT_ID}#state`)
      expect(wrapper.find('[data-slot="no-interface"]').exists()).toBe(true)
      const card = wrapper.find('[data-slot="storage-entry"][data-name="localKey"]')
      await card.find('input').setValue('00')
      await card
        .findAll('button')
        .find((b) => b.text() === 'Read')!
        .trigger('click')
      await vi.waitFor(() => expect(card.find('[data-slot="storage-not-set"]').exists()).toBe(true))
      expect(card.find('[data-slot="verification-badge"]').attributes('data-state')).toBe(
        'verified'
      )
      wrapper.unmount()
    })
  })

  describe('live refresh', () => {
    it('refreshes Events on the newest page after a head move and not on an older page', async () => {
      const getEvents = vi.fn(async (f: { cursor?: string }) =>
        f.cursor === 'c1' ? pageOf([]) : pageOf([], { nextCursor: 'c1' })
      )
      useFakeClient({
        contracts: vi.fn(async () => ({
          features: {},
          interfaceEncodings: [],
          contract: async () => result('read contract'),
        })),
        getEvents,
      })
      const { wrapper } = await mountAt(`/contracts/1/${CONTRACT_ID}#events`, routes)
      await vi.waitFor(() => expect(getEvents).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(useDomainHeads().heads.value[1]).toBeDefined())
      await flushPromises()
      advanceHead(99)
      await vi.waitFor(() => expect(getEvents).toHaveBeenCalledTimes(2))
      await button(wrapper, 'Older').trigger('click')
      await vi.waitFor(() => expect(getEvents).toHaveBeenCalledTimes(3))
      await flushPromises()
      advanceHead(100)
      await flushPromises()
      expect(getEvents).toHaveBeenCalledTimes(3)
      wrapper.unmount()
    })
  })

  describe('Activity', () => {
    it('sends contractId, sender and inputKind in one filter', async () => {
      const requests = useRecordedGateway()
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { wrapper } = await render(`/contracts/1/${CONTRACT_ID}#activity`)
      const inputs = () => requests.filter((r) => r.method === 'zeno_getInputs')
      await vi.waitFor(() => expect(inputs().length).toBeGreaterThan(0))
      expect(inputs()[0].params[0]).toMatchObject({ domainId: 1, contractId: CONTRACT_ID })
      expect(inputs()[0].params[0]).not.toHaveProperty('sender')
      await wrapper.find('[data-slot="sender-filter"]').setValue(SENDER)
      await wrapper.find('[data-slot="kind-filter"]').setValue('6')
      await vi.waitFor(() =>
        expect(inputs().at(-1)!.params[0]).toMatchObject({
          domainId: 1,
          contractId: CONTRACT_ID,
          sender: SENDER,
          inputKind: 6,
        })
      )
      wrapper.unmount()
    })

    it('ignores a sender that is not a z1 address', async () => {
      const requests = useRecordedGateway()
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { wrapper } = await render(`/contracts/1/${CONTRACT_ID}#activity`)
      await wrapper.find('[data-slot="sender-filter"]').setValue('nobody')
      await flushPromises()
      const last = requests.filter((r) => r.method === 'zeno_getInputs').at(-1)!
      expect(last.params[0]).not.toHaveProperty('sender')
      wrapper.unmount()
    })
  })

  describe('Call and Manage', () => {
    const tabs = (w: VueWrapper) => w.findAll('[role="tab"]').map((t) => t.text())

    afterEach(async () => {
      await disconnectWallet()
    })

    it('offers Call without a wallet for an existing contract and no Manage', async () => {
      useRecordedGateway()
      const { wrapper } = await render()
      expect(tabs(wrapper)).toEqual(['Overview', 'Call', 'State', 'Events', 'Activity'])
      wrapper.unmount()
    })

    it('offers Manage once a wallet is connected', async () => {
      await connectWallet()
      useRecordedGateway()
      const { wrapper } = await render()
      expect(tabs(wrapper)).toEqual(['Overview', 'Call', 'State', 'Events', 'Activity', 'Manage'])
      wrapper.unmount()
    })

    it('opens Overview for #manage without a wallet', async () => {
      useRecordedGateway()
      const { wrapper } = await render(`/contracts/1/${CONTRACT_ID}#manage`)
      expect(activeTab(wrapper)).toBe('Overview')
      wrapper.unmount()
    })

    it('opens Manage for #manage with a wallet', async () => {
      await connectWallet()
      useRecordedGateway()
      const { wrapper } = await render(`/contracts/1/${CONTRACT_ID}#manage`)
      expect(activeTab(wrapper)).toBe('Manage')
      wrapper.unmount()
    })

    it('opens Overview and shows the failed check for #call when the read fails', async () => {
      useRecordedGateway([
        altered('read contract', (r) => {
          const value = Buffer.from(r.proofs[0].value, 'hex')
          value[0] ^= 1
          r.proofs[0].value = value.toString('hex')
        }),
      ])
      const { wrapper } = await render(`/contracts/1/${CONTRACT_ID}#call`)
      expect(activeTab(wrapper)).toBe('Overview')
      expect(wrapper.text()).toContain('A check failed')
      wrapper.unmount()
    })

    it('opens Overview and offers neither tab for an absent contract', async () => {
      await connectWallet()
      useRecordedGateway()
      const { wrapper } = await render(`/contracts/1/${ABSENT_ID}#call`)
      expect(activeTab(wrapper)).toBe('Overview')
      expect(tabs(wrapper)).not.toContain('Call')
      expect(tabs(wrapper)).not.toContain('Manage')
      wrapper.unmount()
    })
  })

  describe('contract route', () => {
    /** Every recorded call for domain 1, repeated for the given domain. */
    const onDomain = (domainId: number) =>
      calls
        .filter((c) => c.params[0] === 1)
        .map((c) => ({ ...c, params: [domainId, ...c.params.slice(1)] }))

    it('opens Call for #call without a wallet', async () => {
      useRecordedGateway()
      const { wrapper } = await render(`/contracts/1/${CONTRACT_ID}#call`)
      expect(activeTab(wrapper)).toBe('Call')
      wrapper.unmount()
    })

    it('simulates a Call preview in the route domain while Settings holds another', async () => {
      useRecordedGateway(onDomain(2))
      const simulate = vi.fn(async () => {
        throw new Error('stop here')
      })
      vi.spyOn(GatewayClient.prototype, 'simulate').mockImplementation(simulate as never)
      expect(useSettings().settings.value.domainId).toBe(1)
      const { wrapper } = await render(`/contracts/2/${CONTRACT_ID}#call`)
      expect(activeTab(wrapper)).toBe('Call')
      await wrapper.find('#raw-payload').setValue('00')
      await wrapper.findAll('button').find((b) => b.text() === 'Preview')?.trigger('click')
      await vi.waitFor(() => expect(simulate).toHaveBeenCalled())
      expect((simulate.mock.calls[0] as unknown[])[0]).toBe(2)
      wrapper.unmount()
    })

    it('empties the Call form when the route moves to another domain', async () => {
      useRecordedGateway(onDomain(2))
      const { wrapper, router } = await render(`/contracts/1/${CONTRACT_ID}#call`)
      await wrapper.find('#raw-payload').setValue('aabb')
      await router.push(`/contracts/2/${CONTRACT_ID}#call`)
      await vi.waitFor(() => expect(wrapper.find('#raw-payload').exists()).toBe(true))
      await flushPromises()
      expect((wrapper.find('#raw-payload').element as HTMLInputElement).value).toBe('')
      wrapper.unmount()
    })

    it('shows the pending fallback notice on Overview', async () => {
      useRecordedGateway()
      const { wrapper } = await render()
      await wrapper.find('[aria-label="Pending"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('[data-slot="tag-fallback"]').exists()).toBe(true))
      expect(wrapper.text()).toContain('Showing the latest accepted state')
      wrapper.unmount()
    })

    it('prompts to import the interface file again when the saved interface was cleared', async () => {
      useRecordedGateway()
      const rows = new Map<string, unknown>([
        [
          'zeno-contracts',
          {
            [`1:${CONTRACT_ID}`]: {
              contractId: CONTRACT_ID,
              domainId: 1,
              name: 'Saved name',
              iface: { interface_version: 1, methods: [{ name: 'get', inputs: [], output: 'u64' }] },
              addedAt: 1,
            },
          },
        ],
      ])
      const storage = {
        get: async <T>(key: string) => (rows.has(key) ? structuredClone(rows.get(key)) : null) as T | null,
        set: async <T>(key: string, value: T) => void rows.set(key, structuredClone(value)),
        remove: async (key: string) => void rows.delete(key),
      }
      vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue(
        new ContractRegistryService(storage as never, () => 2)
      )
      const { wrapper } = await render()
      expect(wrapper.text()).toContain('Import the interface file again')
      wrapper.unmount()
    })

    it('shows no re-import prompt for a contract that was never saved', async () => {
      useRecordedGateway()
      const { wrapper } = await render()
      expect(wrapper.text()).not.toContain('Import the interface file again')
      wrapper.unmount()
    })
  })

  describe('interface import', () => {
    it('shows the registry error and stores nothing for a file with a different code_hash', async () => {
      const storage = useRegistry()
      useRecordedGateway()
      const error = vi.spyOn(toast, 'error').mockImplementation((() => 0) as never)
      const { wrapper } = await render()
      const wrong = ifaceOf('ab'.repeat(32))
      expect(() => parseInterface(wrong)).not.toThrow()
      const file = new File([JSON.stringify(wrong)], 'contract.interface.json', {
        type: 'application/json',
      })
      const input = wrapper.find('input[type="file"]')
      Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
      await input.trigger('change')
      await vi.waitFor(() => expect(error).toHaveBeenCalled())
      expect(error.mock.calls[0][0]).toContain('belongs to a different module')
      expect(storage.set).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain(
        'Add the interface file to decode calls and events and read named state.'
      )
      wrapper.unmount()
    })

    it("uses an interface saved for another contract running this contract's code", async () => {
      const rows = new Map<string, unknown>([
        ['zeno-contracts', { [`1:${'cd'.repeat(32)}`]: { contractId: 'cd'.repeat(32), domainId: 1, iface: ifaceOf(SOURCE_HASH), addedAt: 1 } }],
      ])
      vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue(
        new ContractRegistryService(
          { get: async <T>(key: string) => (rows.get(key) ?? null) as T | null, set: async () => {}, remove: async () => {} } as never,
          () => 2
        )
      )
      useRecordedGateway()
      const { wrapper } = await render()
      await vi.waitFor(() =>
        expect(wrapper.text()).toContain("Calls and events decode with the interface known for this contract's code")
      )
      expect(wrapper.text()).toContain(SOURCE_HASH.slice(0, 10))
      wrapper.unmount()
    })

    it('stores the interface for a file whose code_hash matches', async () => {
      const storage = useRegistry()
      useRecordedGateway()
      const success = vi.spyOn(toast, 'success').mockImplementation((() => 0) as never)
      const { wrapper } = await render()
      const file = new File([JSON.stringify(ifaceOf(SOURCE_HASH))], 'contract.interface.json', {
        type: 'application/json',
      })
      const input = wrapper.find('input[type="file"]')
      Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
      await input.trigger('change')
      await vi.waitFor(() => expect(success).toHaveBeenCalledWith('Interface saved', undefined))
      expect(storage.set).toHaveBeenCalled()
      await vi.waitFor(() =>
        expect(wrapper.text()).toContain('An interface is loaded for this contract.')
      )
      wrapper.unmount()
    })
  })
})
