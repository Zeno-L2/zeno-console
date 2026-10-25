import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { TooltipProvider } from 'nom-ui'
import { h } from 'vue'
import { SettlementService, useDomains } from '@/core'
import { useNavActive, useNavItems } from '@/nav'
import AppSidebar from './AppSidebar.vue'
import DomainSelect from './DomainSelect.vue'

const Page = { render: () => null }

async function mountSidebar(url: string, collapsed = false) {
  vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
    getDomains: async () => ({ count: 2, list: [{ domainId: 1 }, { domainId: 2 }] }),
  } as never)
  await useDomains().load()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/domains/:domainId(\\d+)', name: 'domain-overview', component: Page },
      { path: '/domains/:domainId(\\d+)/batches', name: 'domain-batches', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push(url)
  await router.isReady()
  const Host = {
    setup() {
      const items = useNavItems()
      const isActive = useNavActive()
      return () => h(TooltipProvider, null, () => h(AppSidebar, { items: items.value, isActive, collapsed }))
    },
  }
  const wrapper = mount(Host, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('AppSidebar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('groups the items under their section labels, with the domain picker in the Domain section', async () => {
    const { wrapper } = await mountSidebar('/domains/2/batches')
    const text = wrapper.text()
    for (const label of ['Explore', 'Domain', 'Build', 'Overview', 'Batches', 'Events', 'Outbox']) {
      expect(text).toContain(label)
    }
    expect(wrapper.findComponent(DomainSelect).props('modelValue')).toBe(2)
    expect(wrapper.find('a[aria-current="page"]').attributes('href')).toBe('/domains/2/batches')
  })

  it('keeps the same domain page when the picker switches domain', async () => {
    const { wrapper, router } = await mountSidebar('/domains/1/batches')
    wrapper.findComponent(DomainSelect).vm.$emit('update:modelValue', 2)
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/domains/2/batches')
  })

  it("opens the new domain's overview from a page outside the domain", async () => {
    const { wrapper, router } = await mountSidebar('/deploy')
    wrapper.findComponent(DomainSelect).vm.$emit('update:modelValue', 2)
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/domains/2')
  })

  it('hides the labels and the picker in the collapsed rail, keeping an accessible name per item', async () => {
    const { wrapper } = await mountSidebar('/domains/1', true)
    expect(wrapper.findComponent(DomainSelect).exists()).toBe(false)
    expect(wrapper.find('a[aria-label="Batches"]').exists()).toBe(true)
  })
})
