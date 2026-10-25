import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useDomains, useSettings } from '@/core'
import { ADDRESS, connectWallet, disconnectWallet } from '@/core/composables/call-test-helpers'
import { useNavItems } from './nav'

const OTHER = 'z1qqjnwjjn286nmtnl8jehrndlqjkqlyvrcvrgy9'

function items() {
  let list: ReturnType<typeof useNavItems> | null = null
  mount({
    setup: () => {
      list = useNavItems()
      return () => null
    },
  })
  return list as unknown as ReturnType<typeof useNavItems>
}

const targets = (list: ReturnType<typeof useNavItems>) => list.value.map((i) => i.to)

describe('useNavItems', () => {
  afterEach(async () => {
    await useSettings().reset()
    await disconnectWallet()
  })

  it('shows the public items in sidebar order with no wallet', () => {
    expect(items().value.map((i) => `${i.group}:${i.label}`)).toEqual([
      'Explore:Dashboard',
      'Explore:Network',
      'Domain:Overview',
      'Domain:Batches',
      'Domain:Inputs',
      'Domain:Events',
      'Domain:Outbox',
      'Domain:Contracts',
      'Build:Playground',
      'Build:Deploy',
    ])
  })

  it('points every Domain item at the default domain outside a router', () => {
    const id = useDomains().defaultDomainId.value
    const domain = items().value.filter((i) => i.group === 'Domain')
    expect(domain.map((i) => i.to)).toEqual([
      `/domains/${id}`,
      `/domains/${id}/batches`,
      `/domains/${id}/inputs`,
      `/domains/${id}/events`,
      `/domains/${id}/outbox`,
      `/domains/${id}/contracts`,
    ])
  })

  it('points every Domain item at the domain the current route names', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/batches/:domainId(\\d+)/:batchId(\\d+)', component: { render: () => null } },
        { path: '/:pathMatch(.*)*', component: { render: () => null } },
      ],
    })
    await router.push('/batches/7/12')
    let list: ReturnType<typeof useNavItems> | null = null
    mount({ setup: () => { list = useNavItems(); return () => null } }, { global: { plugins: [router] } })
    const domain = (list as unknown as ReturnType<typeof useNavItems>).value.filter((i) => i.group === 'Domain')
    expect(domain.every((i) => i.to.startsWith('/domains/7'))).toBe(true)
  })

  it('adds Withdrawals, not Admin, for a connected wallet that is not the administrator', async () => {
    await useSettings().update({ adminAddress: OTHER })
    await connectWallet()
    const list = targets(items())
    expect(list).toContain('/withdrawals')
    expect(list).not.toContain('/admin')
  })

  it('adds Admin once the connected address is the administrator, giving twelve items', async () => {
    await useSettings().update({ adminAddress: ADDRESS })
    await connectWallet()
    const list = items()
    expect(list.value).toHaveLength(12)
    expect(list.value.at(-1)?.to).toBe('/admin')
  })

  it('hides Admin and Withdrawals when the administrator is set but no wallet is connected', async () => {
    await useSettings().update({ adminAddress: ADDRESS })
    const list = targets(items())
    expect(list).not.toContain('/admin')
    expect(list).not.toContain('/withdrawals')
  })

  it('hides Admin again after the wallet disconnects', async () => {
    await useSettings().update({ adminAddress: ADDRESS })
    await connectWallet()
    const list = items()
    expect(targets(list)).toContain('/admin')
    await disconnectWallet()
    expect(targets(list)).not.toContain('/admin')
  })

  it('keeps no nav entry pointing at the temporary contracts workbench routes', () => {
    const list = items().value
    expect(list.some((i) => i.to === '/contracts')).toBe(false)
  })
})
