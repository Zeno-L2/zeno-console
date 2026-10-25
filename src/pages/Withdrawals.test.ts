import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { TooltipProvider } from 'nom-ui'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ADDRESS, connectWallet, disconnectWallet } from '@/core/composables/call-test-helpers'
import { RelayRefusedError } from '@/core/withdrawal-service'
import { setWithdrawalService } from '@/core/composables/useWithdrawals'
import type { WithdrawalService } from '@/core/withdrawal-service'
import type { Withdrawal } from '@/core'
import Withdrawals from './Withdrawals.vue'

const ZNN_ASSET = '00'.repeat(22) + '14e66318c6318c6318c6'
const row = (id: string, state: Withdrawal['state']): Withdrawal => ({
  state,
  item: { outboxId: id.repeat(32), kind: 'L1_WITHDRAWAL', batchId: 5, verified: true, recipient: 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp', assetId: ZNN_ASSET, amount: '250000000', sourceContract: '', inputIndex: 1, outboxIndex: 0, targetContract: null, payload: '' },
})

const domains = {
  listed: [] as number[],
  relayed: [] as number[],
  released: [] as number[],
  /** The recipient argument of each list call. */
  recipients: [] as (string | undefined)[],
}

function fake(rows: Withdrawal[] | ((domainId: number) => Promise<Withdrawal[]>), opts: { paused?: boolean; relayError?: Error; more?: boolean } = {}) {
  const relays: string[] = []
  domains.listed.length = domains.relayed.length = domains.released.length = domains.recipients.length = 0
  const service = {
    list: async (domainId: number, recipient?: string) => {
      domains.listed.push(domainId)
      domains.recipients.push(recipient)
      return { withdrawals: typeof rows === 'function' ? await rows(domainId) : rows, more: opts.more ?? false }
    },
    relayPaused: async () => opts.paused ?? false,
    relay: async (domainId: number, id: string) => {
      if (opts.relayError) throw opts.relayError
      domains.relayed.push(domainId)
      relays.push(id)
      return 'ef'.repeat(32)
    },
    release: async (domainId: number) => {
      domains.released.push(domainId)
      return 'cd'.repeat(32)
    },
  } as unknown as WithdrawalService
  setWithdrawalService(service)
  return relays
}

const mounted: { unmount(): void }[] = []

let router: ReturnType<typeof createRouter>

async function render(path = '/withdrawals') {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount({ render: () => h(TooltipProvider, null, () => h(Withdrawals)) }, { global: { plugins: [router] } })
  await vi.waitFor(() => expect(wrapper.find('table').exists() || wrapper.text().includes('No withdrawals')).toBe(true))
  await flushPromises()
  mounted.push(wrapper)
  return wrapper
}

const rows = [row('01', 'relayable'), row('02', 'queued'), row('03', 'released'), row('04', 'pending')]

describe('Withdrawals page', () => {
  afterEach(async () => {
    // A page left mounted would reload when the next test connects its wallet.
    mounted.splice(0).forEach((w) => w.unmount())
    setWithdrawalService(null)
    await disconnectWallet()
    vi.restoreAllMocks()
  })

  it('lists each withdrawal with its amount and state', async () => {
    await connectWallet()
    fake(rows)
    const w = await render()
    expect(w.findAll('tbody tr')).toHaveLength(4)
    expect(w.text()).toContain('2.50000000')
    expect(w.text()).toContain('ZNN')
    for (const label of ['Ready to relay', 'Queued for release', 'Released', 'Waiting for the batch']) {
      expect(w.text()).toContain(label)
    }
  })

  it('offers Relay only for a withdrawal that is ready', async () => {
    await connectWallet()
    fake(rows)
    const w = await render()
    const relayButtons = w.findAll('tbody button').filter((b) => b.text().includes('Relay'))
    expect(relayButtons).toHaveLength(1)
    expect(w.find('tr[data-state="relayable"] button').exists()).toBe(true)
    expect(w.find('tr[data-state="queued"] button').exists()).toBe(false)
  })

  it('relays the chosen withdrawal and shows the sent hash', async () => {
    await connectWallet()
    const relays = fake(rows)
    const w = await render()
    await w.find('tr[data-state="relayable"] button').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="withdrawal-sent"]').exists()).toBe(true))
    expect(relays).toEqual(['01'.repeat(32)])
  })

  it('disables Relay and says why when relaying is paused', async () => {
    await connectWallet()
    fake(rows, { paused: true })
    const w = await render()
    expect(w.find('[data-slot="relay-paused"]').exists()).toBe(true)
    expect(w.find('tr[data-state="relayable"] button').attributes('disabled')).toBeDefined()
  })

  it('shows why a relay was refused before any send', async () => {
    await connectWallet()
    fake(rows, { relayError: new RelayRefusedError('The inclusion proof does not rebuild the outbox root the gateway named.') })
    const w = await render()
    await w.find('tr[data-state="relayable"] button').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="withdrawal-error"]').exists()).toBe(true))
    expect(w.find('[data-slot="withdrawal-error"]').text()).toContain('does not rebuild')
  })

  it('says there is nothing to show when the address has no withdrawals', async () => {
    await connectWallet()
    fake([])
    const w = await render()
    expect(w.text()).toContain('No withdrawals are addressed to this address.')
  })

  it('lists, relays and releases in the domain of ?domain=, not the settings domain', async () => {
    await connectWallet()
    fake(rows)
    const w = await render('/withdrawals?domain=2')
    expect(domains.listed).toEqual([2])
    await w.find('tr[data-state="relayable"] button').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="withdrawal-sent"]').exists()).toBe(true))
    await flushPromises()
    expect(domains.relayed).toEqual([2])
    expect(domains.listed).toEqual([2, 2])
    await w.findAll('button').find((b) => b.text().includes('Release withdrawals'))!.trigger('click')
    await flushPromises()
    expect(domains.released).toEqual([2])
  })

  it('uses the default domain without ?domain=', async () => {
    await connectWallet()
    fake(rows)
    await render('/withdrawals')
    expect(domains.listed).toEqual([1])
  })

  it.each(['abc', '-2', '1.5'])('falls back to the default domain for ?domain=%s', async (value) => {
    await connectWallet()
    fake(rows)
    await render(`/withdrawals?domain=${value}`)
    expect(domains.listed).toEqual([1])
  })

  it('keeps the refusal message of a relay and does not reload the list', async () => {
    await connectWallet()
    fake(rows, { relayError: new RelayRefusedError('Refused for the test.') })
    const w = await render('/withdrawals?domain=2')
    await w.find('tr[data-state="relayable"] button').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="withdrawal-error"]').exists()).toBe(true))
    await flushPromises()
    expect(w.find('[data-slot="withdrawal-error"]').text()).toContain('Refused for the test.')
    expect(domains.listed).toEqual([2])
  })

  it('writes the chosen domain to the query from the select', async () => {
    await connectWallet()
    fake(rows)
    const w = await render('/withdrawals')
    w.findComponent({ name: 'DomainSelect' }).vm.$emit('update:modelValue', 4)
    await flushPromises()
    expect(router.currentRoute.value.query.domain).toBe('4')
    expect(domains.listed).toEqual([1, 4])
  })

  it('reloads when the page domain changes', async () => {
    await connectWallet()
    fake(rows)
    await render('/withdrawals?domain=1')
    await router.push('/withdrawals?domain=2')
    await flushPromises()
    expect(domains.listed).toEqual([1, 2])
  })

  it('keeps the rows of the current domain when a relay in another domain resolves late', async () => {
    await connectWallet()
    const byDomain = (domainId: number) => (domainId === 1 ? [row('0a', 'relayable')] : [row('0b', 'queued')])
    fake(async (domainId) => byDomain(domainId))
    const w = await render('/withdrawals?domain=1')
    let finish: (hash: string) => void = () => undefined
    const service = {
      list: async (domainId: number) => ({ withdrawals: byDomain(domainId), more: false }),
      relayPaused: async () => false,
      relay: (domainId: number) => {
        domains.relayed.push(domainId)
        return new Promise<string>((resolve) => (finish = resolve))
      },
      release: async () => 'cd'.repeat(32),
    } as unknown as WithdrawalService
    setWithdrawalService(service)
    await w.find('tr[data-state="relayable"] button').trigger('click')
    await router.push('/withdrawals?domain=2')
    await flushPromises()
    expect(w.find('tr[data-state="queued"]').exists()).toBe(true)
    finish('ef'.repeat(32))
    await flushPromises()
    expect(domains.relayed).toEqual([1])
    expect(w.find('tr[data-state="queued"]').exists()).toBe(true)
    expect(w.find('tr[data-state="relayable"]').exists()).toBe(false)
  })

  it('removes the rows of the previous domain when the new domain fails to load', async () => {
    await connectWallet()
    const relays = fake(async (domainId) => {
      if (domainId === 2) throw new Error('boom')
      return [row('0a', 'relayable')]
    })
    const w = await render('/withdrawals?domain=1')
    expect(w.find('tr[data-state="relayable"]').exists()).toBe(true)
    await router.push('/withdrawals?domain=2')
    await flushPromises()
    expect(w.find('[data-slot="withdrawal-error"]').exists()).toBe(true)
    expect(w.find('tr[data-state="relayable"]').exists()).toBe(false)
    expect(relays).toEqual([])
  })

  it('removes the rows of the previous domain while the new domain loads', async () => {
    await connectWallet()
    let release: (rows: Withdrawal[]) => void = () => undefined
    fake((domainId) =>
      domainId === 2 ? new Promise<Withdrawal[]>((resolve) => (release = resolve)) : Promise.resolve([row('0a', 'relayable')])
    )
    const w = await render('/withdrawals?domain=1')
    expect(w.find('tr[data-state="relayable"]').exists()).toBe(true)
    await router.push('/withdrawals?domain=2')
    await flushPromises()
    expect(w.find('tr[data-state="relayable"]').exists()).toBe(false)
    release([row('0b', 'relayable')])
    await flushPromises()
    expect(w.find('tr[data-state="relayable"]').exists()).toBe(true)
  })

  it('asks for a wallet when none is connected', async () => {
    fake(rows)
    const w = await render()
    expect(w.text()).toContain('Connect a wallet')
  })

  it('lists with the connected address while Mine only is on, and with none once it is off', async () => {
    await connectWallet()
    fake(rows)
    const w = await render()
    expect(domains.recipients[0]).toBe(ADDRESS)
    await w.find('button[role="switch"]').trigger('click')
    await flushPromises()
    expect(domains.recipients.at(-1)).toBeUndefined()
    expect(w.findAll('tbody tr')).toHaveLength(4)
  })

  it('turns Mine only on when a wallet connects and off when it disconnects', async () => {
    fake(rows)
    const w = await render()
    expect(w.find('button[role="switch"]').exists()).toBe(false)
    await connectWallet()
    await flushPromises()
    expect(w.find('button[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(domains.recipients.at(-1)).toBe(ADDRESS)
    await disconnectWallet()
    await flushPromises()
    expect(domains.recipients.at(-1)).toBeUndefined()
    expect(w.find('button[role="switch"]').exists()).toBe(false)
  })

  it('lists every withdrawal of the domain with no wallet', async () => {
    fake(rows)
    const w = await render()
    expect(w.findAll('tbody tr')).toHaveLength(4)
    expect(domains.recipients).toEqual([undefined])
    expect(w.find('tr[data-state="relayable"] button').attributes('disabled')).toBeDefined()
    expect(w.findAll('button').find((b) => b.text().includes('Release withdrawals'))!.attributes('disabled')).toBeDefined()
    expect(w.find('button[role="switch"]').exists()).toBe(false)
  })

  it('says when the list stops early', async () => {
    await connectWallet()
    fake(rows, { more: true })
    expect((await render()).find('[data-slot="withdrawals-more"]').exists()).toBe(true)
    fake(rows, { more: false })
    expect((await render()).find('[data-slot="withdrawals-more"]').exists()).toBe(false)
  })

  it('says no withdrawals are among the newest outbox messages', async () => {
    await connectWallet()
    fake([], { more: true })
    expect((await render()).text()).toContain('No withdrawals among the newest outbox messages.')
  })

  it('shows the stop notice with Mine only on, off and with no wallet', async () => {
    await connectWallet()
    fake(rows, { more: true })
    const page = await render()
    expect(page.find('[data-slot="withdrawals-more"]').exists()).toBe(true)
    await page.find('button[role="switch"]').trigger('click')
    await flushPromises()
    expect(domains.recipients.at(-1)).toBeUndefined()
    expect(page.find('[data-slot="withdrawals-more"]').exists()).toBe(true)
    await disconnectWallet()
    fake(rows, { more: true })
    expect((await render()).find('[data-slot="withdrawals-more"]').exists()).toBe(true)
  })

  it('names the address in the empty state when Mine only is on and the list is complete', async () => {
    await connectWallet()
    fake([])
    expect((await render()).text()).toContain('No withdrawals are addressed to this address.')
  })

  it('says the domain has no withdrawals when there is no wallet and the list is complete', async () => {
    fake([])
    expect((await render()).text()).toContain('No withdrawals in this domain.')
  })
})
