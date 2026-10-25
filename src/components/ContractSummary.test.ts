import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ContractSummary from './ContractSummary.vue'

const view = (quota: { used: number; purchased: number } | null) =>
  ({
    batchId: 4,
    verified: true,
    result: { codeHash: 'aa', sourceCodeHash: 'bb', upgradePolicy: 'IMMUTABLE', owner: null, nativeAddress: null, quota },
  }) as never

describe('ContractSummary', () => {
  it('shows hashes, policy, batch, tag and quota', () => {
    const w = mount(ContractSummary, { props: { view: view({ used: 5, purchased: 10 }), answeredTag: 'latest' } })
    const text = w.text()
    expect(text).toContain('IMMUTABLE')
    expect(text).toContain('Batch 4')
    expect(text).toContain('latest')
    expect(text).toContain('5 / 10 bytes')
    expect(text).toContain('None')
  })

  it('omits the quota when the contract has none', () => {
    const w = mount(ContractSummary, { props: { view: view(null), answeredTag: 'pending' } })
    expect(w.text()).not.toContain('Storage quota')
  })
})
