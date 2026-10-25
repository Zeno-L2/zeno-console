import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { TooltipProvider } from 'nom-ui'
import { Hash, SettlementTimeChallenge } from 'znn-typescript-sdk'
import { SettlementService, useSettings, useSettlement } from '@/core'
import { fakeZenonService } from '../../test/rpc-fixture'
import { ADDRESS, connectWallet, disconnectWallet } from '@/core/composables/call-test-helpers'
import { actionFor, hashOf } from '@/core/admin-actions'
import { setAdminService, useAdmin } from '@/core/composables/useAdmin'
import { AdminSendError } from '@/core/admin-service'
import type { AdminService } from '@/core/admin-service'
import AdminActionForm from './AdminActionForm.vue'

const action = actionFor('SetPeripheryConfig')
const texts = { znnPerByteOfBytecode: '100', znnPerByteOfState: '200' }
const hashed = hashOf(action, action.parse(texts))

const challenge = (hash: string, due: number) => new SettlementTimeChallenge(hashed.key, Hash.parse(hash), due - 100, due)

/** The administrator address each fake send received. */
const admins: string[] = []

/** The hashes the form emitted with `sent`. */
const emitted: string[] = []

function fakeService(saved: Record<string, string> | null = null, refusal: Error | null = null) {
  const sends: Record<string, string>[] = []
  admins.length = 0
  const service = {
    parse: (a: typeof action, t: Record<string, string>) => {
      const params = a.parse(t as never)
      return { params, hashed: hashOf(a, params) }
    },
    send: async (_a: unknown, t: Record<string, string>, admin: string) => {
      sends.push(t)
      admins.push(admin)
      if (refusal) throw refusal
      return 'cd'.repeat(32)
    },
    saved: async () => (saved ? { method: action.method, texts: saved, hash: '', sendHash: '', sentAt: 1 } : null),
  } as unknown as AdminService
  setAdminService(service)
  return sends
}

async function render() {
  const wrapper = mount({ render: () => h(TooltipProvider, null, () => h(AdminActionForm, { action, onSent: (hash: string) => emitted.push(hash) })) })
  await flushPromises()
  return wrapper
}

const fill = async (w: ReturnType<typeof mount>, values: Record<string, string>) => {
  for (const [key, value] of Object.entries(values)) await w.find(`#a-${key}`).setValue(value)
  await flushPromises()
}

const submit = (w: ReturnType<typeof mount>) => w.findAll('button').find((b) => /Propose|Execute|Replace|Waiting/.test(b.text()))!

describe('AdminActionForm', () => {
  const s = useSettlement()

  beforeEach(async () => {
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue(new SettlementService(fakeZenonService(1000).service))
    await connectWallet()
    await useSettings().update({ adminAddress: ADDRESS })
    s.challenges.value = []
    s.frontierHeight.value = 1000
  })
  afterEach(async () => {
    setAdminService(null)
    await useSettings().reset()
    await disconnectWallet()
    vi.restoreAllMocks()
  })

  it('shows what the values parsed to and proposes when nothing is pending', async () => {
    const sends = fakeService()
    const w = await render()
    await fill(w, texts)
    expect(w.find('[data-slot="admin-state"]').text()).toContain('Nothing pending')
    expect(w.text()).toContain('The send succeeds with no visible change')
    expect(submit(w).text()).toBe('Propose')
    await submit(w).trigger('click')
    await flushPromises()
    expect(sends).toEqual([texts])
  })

  it('emits sent for a confirmed send and not for a refused one', async () => {
    fakeService()
    emitted.length = 0
    const ok = await render()
    await fill(ok, texts)
    await submit(ok).trigger('click')
    await flushPromises()
    expect(emitted).toEqual(['cd'.repeat(32)])

    fakeService(null, new AdminSendError('Settlement refused this send.', 'cd'.repeat(32)))
    emitted.length = 0
    const refused = await render()
    await fill(refused, texts)
    await submit(refused).trigger('click')
    await flushPromises()
    expect(emitted).toEqual([])
  })

  it('shows the refusal and keeps the send hash when the wallet signed with another address', async () => {
    const hash = 'cd'.repeat(32)
    fakeService(null, new AdminSendError('The wallet signed this send with z1qother.', hash))
    const w = await render()
    await fill(w, texts)
    await submit(w).trigger('click')
    await flushPromises()
    expect(w.text()).toContain('The wallet signed this send with z1qother.')
    expect(useAdmin().lastHash.value).toBe(hash)
    expect(admins).toEqual([ADDRESS])
  })

  it('blocks Execute before the due height and shows the momentums left', async () => {
    const sends = fakeService()
    s.challenges.value = [challenge(hashed.hash, 1800)]
    const w = await render()
    await fill(w, texts)
    expect(w.find('[data-slot="admin-state"]').text()).toContain('Pending, 800 momentums to go')
    expect(submit(w).attributes('disabled')).toBeDefined()
    await submit(w).trigger('click')
    expect(sends).toEqual([])
  })

  it('enables Execute once the due height passes and the values hash to the pending proposal', async () => {
    const sends = fakeService()
    s.challenges.value = [challenge(hashed.hash, 1800)]
    s.frontierHeight.value = 1800
    const w = await render()
    await fill(w, texts)
    expect(w.find('[data-slot="admin-state"]').text()).toContain('Ready to execute')
    expect(submit(w).text()).toBe('Execute')
    expect(submit(w).attributes('disabled')).toBeUndefined()
    await submit(w).trigger('click')
    await flushPromises()
    expect(sends).toEqual([texts])
  })

  it('warns that different values replace the pending proposal', async () => {
    fakeService()
    s.challenges.value = [challenge('ef'.repeat(32), 1800)]
    s.frontierHeight.value = 5000
    const w = await render()
    await fill(w, texts)
    expect(w.find('[data-slot="admin-state"]').text()).toContain('A different proposal is pending')
    expect(w.text()).toContain('restarts the challenge')
    expect(submit(w).text()).toBe('Replace the pending proposal')
  })

  it('does not enable Execute for different values even when the pending proposal is due', async () => {
    const sends = fakeService()
    s.challenges.value = [challenge(hashed.hash, 1800)]
    s.frontierHeight.value = 1800
    const w = await render()
    await fill(w, { znnPerByteOfBytecode: '100', znnPerByteOfState: '201' })
    expect(submit(w).text()).toBe('Replace the pending proposal')
    expect(w.text()).not.toContain('Ready to execute')
    expect(sends).toEqual([])
  })

  it('explains an invalid value and keeps the button disabled', async () => {
    fakeService()
    const w = await render()
    await fill(w, { znnPerByteOfBytecode: 'x', znnPerByteOfState: '1' })
    expect(w.find('[data-slot="admin-problem"]').text()).toContain('whole number')
    expect(submit(w).attributes('disabled')).toBeDefined()
  })

  it('loads the values saved for the same key', async () => {
    fakeService(texts)
    const w = await render()
    await fill(w, { znnPerByteOfBytecode: '1', znnPerByteOfState: '2' })
    await w.findAll('button').find((b) => b.text() === 'Load saved values')?.trigger('click')
    await flushPromises()
    expect((w.find('#a-znnPerByteOfBytecode').element as HTMLInputElement).value).toBe('100')
    expect((w.find('#a-znnPerByteOfState').element as HTMLInputElement).value).toBe('200')
  })

  it('refuses to send for an address that is not the administrator', async () => {
    const sends = fakeService()
    await useSettings().update({ adminAddress: 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7' })
    const w = await render()
    await fill(w, texts)
    await submit(w).trigger('click')
    await flushPromises()
    expect(sends).toEqual([])
    expect(w.text()).toContain('Only the network administrator can send this.')
    expect(useAdmin().isAdmin.value).toBe(false)
  })
})
