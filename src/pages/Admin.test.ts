import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { TooltipProvider } from 'nom-ui'
import { createMemoryHistory, createRouter } from 'vue-router'
import { SettlementService, useSettings } from '@/core'
import { fakeZenonService } from '../../test/rpc-fixture'
import { ADDRESS, connectWallet, disconnectWallet } from '@/core/composables/call-test-helpers'
import { useNavItems } from '@/nav'
import { actionFor } from '@/core/admin-actions'
import { AdminSendError } from '@/core/admin-service'
import { setAdminService } from '@/core/composables/useAdmin'
import type { AdminService } from '@/core/admin-service'
import Admin from './Admin.vue'

async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] })
  const wrapper = mount({ render: () => h(TooltipProvider, null, () => h(Admin)) }, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('Admin page', () => {
  beforeEach(() => {
    const { service } = fakeZenonService(1000)
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue(new SettlementService(service))
  })
  afterEach(async () => {
    await useSettings().reset()
    await disconnectWallet()
    setAdminService(null)
    vi.restoreAllMocks()
  })

  const HASH = 'cd'.repeat(32)
  const texts = { znnPerByteOfBytecode: '100', znnPerByteOfState: '200' }

  /** An AdminService whose send and pause run `send`. */
  function fakeAdmin(send: () => Promise<string>) {
    setAdminService({
      parse: (a: ReturnType<typeof actionFor>, t: Record<string, string>) => ({ params: a.parse(t as never), hashed: { key: 'k', hash: 'h' } }),
      send,
      pause: send,
      saved: async () => null,
    } as unknown as AdminService)
  }

  async function fillAndSend(w: Awaited<ReturnType<typeof render>>) {
    for (const [key, value] of Object.entries(texts)) await w.find(`#a-${key}`).setValue(value)
    await flushPromises()
    await w.findAll('[data-slot="admin-action"] button').find((b) => /Propose|Execute|Replace/.test(b.text()))?.trigger('click')
    await flushPromises()
  }

  it('turns away a visitor who is not the administrator', async () => {
    await connectWallet()
    const w = await render()
    expect(w.find('[data-slot="admin-denied"]').exists()).toBe(true)
    expect(w.find('[data-slot="admin-action"]').exists()).toBe(false)
    expect(w.find('[data-slot="pause-panel"]').exists()).toBe(false)
  })

  it('turns away a connected wallet when no administrator is configured', async () => {
    await connectWallet()
    await useSettings().update({ adminAddress: '' })
    expect((await render()).find('[data-slot="admin-denied"]').exists()).toBe(true)
  })

  it('shows the pending challenges, the pause panel and the action forms to the administrator', async () => {
    await connectWallet()
    await useSettings().update({ adminAddress: ADDRESS })
    const w = await render()
    expect(w.find('[data-slot="admin-denied"]').exists()).toBe(false)
    await vi.waitFor(() => expect(w.find('[data-slot="time-challenges"]').exists()).toBe(true))
    expect(w.text()).toContain('SetAssetConfig/3/')
    expect(w.find('[data-slot="pause-panel"]').exists()).toBe(true)
    expect(w.find('[data-slot="admin-action"]').exists()).toBe(true)
  })

  it('tells the administrator to check the signer', async () => {
    await connectWallet()
    await useSettings().update({ adminAddress: ADDRESS })
    const w = await render()
    expect(w.find('[data-slot="admin-signer"]').text()).toContain(ADDRESS)
  })

  it('labels the send link as sent after a confirmed send', async () => {
    await connectWallet()
    await useSettings().update({ adminAddress: ADDRESS })
    fakeAdmin(async () => HASH)
    const w = await render()
    await fillAndSend(w)
    expect(w.find('[data-slot="admin-sent"]').text()).toContain('Sent.')
  })

  it('does not call a refused send sent, and keeps its link', async () => {
    await connectWallet()
    await useSettings().update({ adminAddress: ADDRESS })
    fakeAdmin(async () => {
      throw new AdminSendError('Settlement refused this send, so nothing changed.', HASH, true)
    })
    const w = await render()
    await fillAndSend(w)
    const sent = w.find('[data-slot="admin-sent"]')
    expect(sent.text()).not.toContain('Sent.')
    expect(sent.text()).toContain('Published, refused')
    expect(sent.find('a').attributes('href')).toBe(`/tx/${HASH}`)
    expect(w.text()).toContain('Settlement refused this send')
  })

  it('labels a send with an unknown result as unknown, not refused', async () => {
    await connectWallet()
    await useSettings().update({ adminAddress: ADDRESS })
    fakeAdmin(async () => {
      throw new AdminSendError('Settlement has not received this send, so the console cannot tell.', HASH)
    })
    const w = await render()
    await fillAndSend(w)
    const sent = w.find('[data-slot="admin-sent"]')
    expect(sent.text()).toContain('Published, result unknown')
    expect(sent.text()).not.toContain('refused')
  })

  it('keeps the pause waiting line and the form waiting label apart', async () => {
    await connectWallet()
    await useSettings().update({ adminAddress: ADDRESS })
    let release: (hash: string) => void = () => undefined
    fakeAdmin(() => new Promise((resolve) => (release = resolve)))
    const w = await render()
    const formButtons = () => w.findAll('[data-slot="admin-action"] button').map((b) => b.text())

    await w.findAll('[data-slot="pause-panel"] button').find((b) => b.text() === 'Resume')?.trigger('click')
    await flushPromises()
    expect(w.find('[data-slot="pause-waiting"]').exists()).toBe(true)
    expect(formButtons().some((t) => t.includes('Waiting'))).toBe(false)
    release(HASH)
    await flushPromises()

    for (const [key, value] of Object.entries(texts)) await w.find(`#a-${key}`).setValue(value)
    await flushPromises()
    await w.findAll('[data-slot="admin-action"] button').find((b) => /Propose/.test(b.text()))?.trigger('click')
    await flushPromises()
    expect(w.find('[data-slot="pause-waiting"]').exists()).toBe(false)
    expect(formButtons().some((t) => t.includes('Waiting'))).toBe(true)
    release(HASH)
    await flushPromises()
  })

  it('warns before relay is paused and keeps the pause button disabled until confirmed', async () => {
    await connectWallet()
    await useSettings().update({ adminAddress: ADDRESS })
    const w = await render()
    expect(w.find('[data-slot="relay-warning"]').exists()).toBe(false)
    await w.find('#s-relay').trigger('click')
    await flushPromises()
    expect(w.find('[data-slot="relay-warning"]').exists()).toBe(true)
    const pause = () => w.findAll('[data-slot="pause-panel"] button').find((b) => b.text() === 'Pause')
    expect(pause()?.attributes('disabled')).toBeDefined()
    await w.find('#relay-confirm').trigger('click')
    await flushPromises()
    expect(pause()?.attributes('disabled')).toBeUndefined()
  })
})

describe('navigation', () => {
  afterEach(async () => {
    await useSettings().reset()
    await disconnectWallet()
  })

  const items = () => {
    let list: ReturnType<typeof useNavItems> | null = null
    mount({ setup: () => { list = useNavItems(); return () => null } })
    return list as unknown as ReturnType<typeof useNavItems>
  }

  it('lists the admin entry only for the administrator', async () => {
    await connectWallet()
    expect(items().value.some((i) => i.to === '/admin')).toBe(false)
    await useSettings().update({ adminAddress: ADDRESS })
    expect(items().value.some((i) => i.to === '/admin')).toBe(true)
    expect(items().value.find((i) => i.to === '/admin')?.requires).toBe('admin')
  })

  it('lists Deploy always and Withdrawals only with a connected wallet', async () => {
    const has = (to: string) => items().value.some((i) => i.to === to)
    expect(has('/deploy')).toBe(true)
    expect(has('/withdrawals')).toBe(false)
    await connectWallet()
    expect(has('/withdrawals')).toBe(true)
  })
})
