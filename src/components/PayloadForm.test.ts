import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { Address, TooltipProvider } from 'nom-ui'
import PayloadForm from './PayloadForm.vue'

const ADDRESS = 'z1qpeet8dcjg0m6x6m3tg437wnc42aa2nez2fzth'
const CALLER = 'b0ebd11e758ddc06bc598e4d693943a807f9e9838b2840946e2c4c2f6ace00fa'
const ZNN = 'zts1znnxxxxxxxxxxxxx9z4ulx'
const params = [
  { name: 'account', type: 'hash' },
  { name: 'asset', type: 'bytes32' },
  { name: 'count', type: 'u64' },
  { name: 'tag', type: 'bytes16' },
]

function render(modelValue: string[]) {
  return mount({
    render: () => h(TooltipProvider, null, () => h(PayloadForm, { params, modelValue } as never)),
  })
}

describe('PayloadForm 32-byte fields', () => {
  it('shows a hint under an empty 32-byte field only', () => {
    const w = render(['', '', '', ''])
    const hints = w.findAll('[data-slot="key-hint"]')
    expect(hints).toHaveLength(2)
    expect(hints[0].text()).toContain('z1 address')
    expect(hints[0].text()).toContain('zts1 token standard')
  })

  it('shows what an address and a token standard resolved to', () => {
    const w = render([ADDRESS, ZNN, '', ''])
    const lines = w.findAll('[data-slot="resolved"]')
    expect(lines).toHaveLength(2)
    expect(lines[0].text()).toContain('Resolved: caller of')
    expect(lines[0].findAllComponents(Address).map((a: { props: (k: string) => unknown }) => String(a.props('address')))).toEqual([ADDRESS, CALLER])
    expect(lines[1].text()).toContain('Resolved: asset id of')
    expect(w.find('[data-slot="key-hint"]').exists()).toBe(false)
  })

  it('shows no resolved line for plain hex', () => {
    const w = render([CALLER, '', '', ''])
    expect(w.findAll('[data-slot="resolved"]')).toHaveLength(0)
  })

  it('offers ZNN and QSR on the asset field and fills the token standard', async () => {
    const w = render(['', '', '', ''])
    const shortcuts = w.findAll('[data-slot="asset-shortcuts"]')
    expect(shortcuts).toHaveLength(1)
    const buttons = shortcuts[0].findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(['ZNN', 'QSR'])
    await buttons[0].trigger('click')
    const form = w.findComponent(PayloadForm)
    expect(form.emitted('update:modelValue')?.[0]).toEqual([['', ZNN, '', '']])
    await buttons[1].trigger('click')
    expect(form.emitted('update:modelValue')?.[1]).toEqual([['', 'zts1qsrxxxxxxxxxxxxxmrhjll', '', '']])
  })
})
