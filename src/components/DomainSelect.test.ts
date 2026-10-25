import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { SettlementService, useDomains } from '@/core'
import DomainSelect from './DomainSelect.vue'

describe('DomainSelect', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('names the selected domain before and after the domain list loads', async () => {
    const domains = useDomains()
    domains.domains.value = []
    const wrapper = mount(DomainSelect, { props: { modelValue: 1 }, attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('[data-slot="domain-select"]').text()).toBe('Domain 1')

    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getDomains: async () => ({ count: 2, list: [{ domainId: 1 }, { domainId: 2 }] }),
    } as never)
    await domains.load()
    await flushPromises()
    expect(wrapper.find('[data-slot="domain-select"]').text()).toBe('Domain 1')

    await wrapper.setProps({ modelValue: 2 })
    expect(wrapper.find('[data-slot="domain-select"]').text()).toBe('Domain 2')
    wrapper.unmount()
  })
})
