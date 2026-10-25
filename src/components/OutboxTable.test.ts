import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { TooltipProvider } from 'nom-ui'
import { h } from 'vue'
import { QSR_ZTS, settlement } from 'znn-typescript-sdk'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { OutboxItem } from 'zeno-client'
import { result } from '../../test/replay-client'
import OutboxTable from './OutboxTable.vue'

const message = result<{ items: OutboxItem[] }>('outbox getOutbox').items[0]
const RECIPIENT = 'z16yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqvrvjf7'
const ZNN_ASSET = '00'.repeat(22) + '14e66318c6318c6318c6'
const withdrawal = { ...message, kind: 'L1_WITHDRAWAL', recipient: RECIPIENT, assetId: ZNN_ASSET, amount: '100000000' } as OutboxItem

function render(props: Record<string, unknown>) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] })
  return mount({ render: () => h(TooltipProvider, null, () => h(OutboxTable, props as never)) }, { global: { plugins: [router] } })
}

describe('OutboxTable', () => {
  it('says there are no messages for an empty list', () => {
    const w = render({ items: [], domainId: 5, states: new Map(), domainStatus: null })
    expect(w.text()).toContain('No outbox messages.')
  })

  it('links the batch and the recipient to the domain', () => {
    const w = render({ items: [withdrawal], domainId: 5, states: new Map(), domainStatus: null })
    expect(w.find(`a[href="/batches/5/${withdrawal.batchId}"]`).exists()).toBe(true)
    expect(w.find(`a[href="/address/${RECIPIENT}?domain=5"]`).exists()).toBe(true)
  })

  it('shows a ZNN amount formatted and another asset raw', () => {
    const w = render({
      items: [withdrawal, { ...withdrawal, outboxId: 'cd'.repeat(32), assetId: '11'.repeat(32), amount: '777' }],
      domainId: 5,
      states: new Map(),
      domainStatus: null,
    })
    const rows = w.findAll('tbody tr')
    expect(rows[0].text()).toContain('ZNN')
    expect(rows[0].text()).toContain('1')
    expect(rows[1].text()).toContain('777')
    expect(rows[1].text()).not.toContain('ZNN')
  })

  it('shows a QSR amount formatted with the QSR symbol', () => {
    const qsr = { ...withdrawal, assetId: settlement.assetIdFromZts(QSR_ZTS).toString(), amount: '100000000' }
    const w = render({ items: [qsr], domainId: 5, states: new Map(), domainStatus: null })
    const amount = w.find('tbody tr')
    expect(amount.text()).toContain('QSR')
    expect(amount.text()).toContain('1')
    expect(amount.text()).not.toContain('100000000')
  })

  it('labels each withdrawal state', () => {
    const w = render({ items: [withdrawal], domainId: 5, states: new Map([[withdrawal.outboxId, 'queued']]), domainStatus: null })
    expect(w.text()).toContain('Queued for release')
  })

  it('shows verified, pending and inconsistent badges', () => {
    const items = [withdrawal, { ...withdrawal, outboxId: 'cd'.repeat(32), verified: false }]
    const ok = render({ items, domainId: 5, states: new Map(), domainStatus: 'OK' })
    expect(ok.findAll('[data-slot="verification-badge"]').map((b) => b.attributes('data-state'))).toEqual(['verified', 'pending'])
    const bad = render({ items, domainId: 5, states: new Map(), domainStatus: 'INCONSISTENT' })
    expect(bad.findAll('[data-slot="verification-badge"]').map((b) => b.attributes('data-state'))).toEqual(['inconsistent', 'inconsistent'])
  })
})
