import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { TooltipProvider } from 'nom-ui'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ADDRESS, CONTRACT_ID, connectWallet, disconnectWallet } from '@/core/composables/call-test-helpers'
import ManageTab from './ManageTab.vue'

const features = { upgrade: true, ownershipTransfer: true, storageQuota: true, payableCalls: true, deposits: true, nativeAddresses: false }
const view = {
  codeHash: '22'.repeat(32), sourceCodeHash: '33'.repeat(32), upgradePolicy: 'OWNER_UPGRADEABLE', owner: ADDRESS,
  ownerCaller: '44'.repeat(32), quota: { purchased: 0, used: 0 }, nativeAddress: null,
}

async function render(props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] })
  const wrapper = mount(
    { render: () => h(TooltipProvider, null, () => h(ManageTab, { domainId: 1, contractId: CONTRACT_ID, view, features, ...props } as never)) },
    { global: { plugins: [router] } }
  )
  await flushPromises()
  return wrapper
}

const slots = (w: ReturnType<typeof mount>) =>
  ['manage-deposit', 'manage-storage', 'manage-ownership', 'manage-upgrade'].filter((s) => w.find(`[data-slot="${s}"]`).exists())

describe('ManageTab', () => {
  afterEach(async () => {
    await disconnectWallet()
    vi.restoreAllMocks()
  })

  it('shows every action to the owner when every flag is set', async () => {
    await connectWallet()
    expect(slots(await render())).toEqual(['manage-deposit', 'manage-storage', 'manage-ownership', 'manage-upgrade'])
  })

  it('hides the action of each unset flag', async () => {
    await connectWallet()
    expect(slots(await render({ features: { ...features, deposits: false } }))).not.toContain('manage-deposit')
    expect(slots(await render({ features: { ...features, storageQuota: false } }))).not.toContain('manage-storage')
    expect(slots(await render({ features: { ...features, ownershipTransfer: false } }))).not.toContain('manage-ownership')
    expect(slots(await render({ features: { ...features, upgrade: false } }))).not.toContain('manage-upgrade')
  })

  it('says there is nothing to manage when no action applies', async () => {
    await connectWallet()
    const w = await render({ features: { ...features, deposits: false, storageQuota: false, ownershipTransfer: false, upgrade: false } })
    expect(slots(w)).toEqual([])
    expect(w.text()).toContain('Nothing to manage')
  })

  it('asks for a wallet when none is connected', async () => {
    const w = await render()
    expect(w.text()).toContain('Connect a wallet')
  })

  it('keeps renounce disabled until the user confirms it is permanent', async () => {
    await connectWallet()
    const w = await render()
    const renounce = () => w.findAll('button').find((b) => b.text() === 'Renounce ownership')
    expect(renounce()?.attributes('disabled')).toBeDefined()
    await w.find('#m-renounce').trigger('click')
    await flushPromises()
    expect(renounce()?.attributes('disabled')).toBeUndefined()
  })

  it('links the upgrade to the deploy flow with the contract id and its domain', async () => {
    await connectWallet()
    const w = await render({ domainId: 2 })
    expect(w.find('[data-slot="manage-upgrade"] a').attributes('href')).toBe(`/deploy?upgrade=${CONTRACT_ID}&domain=2`)
  })
})
