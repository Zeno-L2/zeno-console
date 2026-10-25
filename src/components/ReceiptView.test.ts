import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { selectorOf, sha3 } from 'zeno-client'
import type { ContractInterface, ReceiptResult } from 'zeno-client'
import { TooltipProvider } from 'nom-ui'
import { result } from '../../test/replay-client'
import type { ReceiptCheck } from '../core/tx-tracker-service'
import ReceiptView from './ReceiptView.vue'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

const iface: ContractInterface = {
  interface_version: 1,
  encoding: 'zeno-selector-v1',
  code_hash: '00'.repeat(32),
  methods: [
    {
      name: 'add',
      selector: hex(selectorOf('add')),
      payable: false,
      readonly: false,
      inputs: [{ name: 'amount', type: 'u64' }],
      outputs: [{ name: 'total', type: 'u64' }],
    },
  ],
  on_deposit: null,
  events: [
    { name: 'Added', topic: hex(sha3(new TextEncoder().encode('Added'))), fields: [{ name: 'amount', type: 'u64', indexed: false }] },
  ],
  errors: [{ code: 1, name: 'Overflow', fields: [{ name: 'limit', type: 'u64' }], description: 'The limit is reached.' }],
  storage: [],
}

const base = (): ReceiptResult => structuredClone(result<ReceiptResult>('getReceipt success'))
const source = '00'.repeat(32)
const withdrawal = {
  outboxId: '11'.repeat(32),
  sourceContract: source,
  inputIndex: 11,
  outboxIndex: 0,
  kind: 'L1_WITHDRAWAL',
  targetContract: null,
  recipient: 'z1qpeet8dcjg0m6x6m3tg437wnc42aa2nez2fzth',
  assetId: '22'.repeat(32),
  amount: '50000000000',
  payload: '',
}
const event = { contractId: '11'.repeat(32), inputIndex: 1, eventIndex: 0, topics: [hex(sha3(new TextEncoder().encode('Added')))], data: '0000000000000005' }

const finalize = (): ReceiptResult => ({ ...base(), events: [event], outbox: [withdrawal] }) as unknown as ReceiptResult
const upgrade = (): ReceiptResult => ({ ...base(), input: { kind: 'UpgradeContract', inputKind: 5, sourceAccountBlockHash: source } }) as unknown as ReceiptResult
const call = (): ReceiptResult =>
  ({
    ...base(),
    returnData: '0000000000000009',
    input: { kind: 'CallL2', inputKind: 0, sourceAccountBlockHash: source, payload: hex(selectorOf('add')) + '0000000000000005' },
  }) as unknown as ReceiptResult
const revert = (): ReceiptResult =>
  ({
    ...call(),
    receipt: { ...base().receipt, status: 'REVERT', abortCode: 1 },
    returnData: '000000000000002a',
    outbox: [withdrawal],
  }) as unknown as ReceiptResult

const view = (receipt: ReceiptResult, proof: ReceiptCheck) =>
  mount({ render: () => h(TooltipProvider, null, () => h(ReceiptView, { receipt, iface, proof })) })

const COMMON = ['Batch', 'Input index', 'Gas used', 'Abort code', 'Contract', 'Input', 'Events']
const cases: [string, () => ReceiptResult, string[]][] = [
  ['a deploy finalize', finalize, [...COMMON, 'Deployed', 'Return data']],
  ['an upgrade', upgrade, [...COMMON, 'Upgraded', 'Return data']],
  ['a call', call, [...COMMON, 'Method', 'Return value']],
  ['a revert', revert, [...COMMON, 'Method', 'Overflow']],
]

describe('ReceiptView unchecked marks', () => {
  it.each(cases)('marks every field of %s until the receipt is verified', (_name, make, labels) => {
    const w = view(make(), { state: 'bound' })
    const text = w.text()
    for (const label of labels) expect(text, label).toContain(`${label} (unchecked)`)
    expect(text).toContain('Domain')
    expect(text).not.toContain('Domain (unchecked)')
    expect(text).not.toContain('Sender (unchecked)')
    w.unmount()
  })

  it.each(cases)('marks nothing of %s once the receipt is verified', (_name, make) => {
    const w = view(make(), { state: 'verified' })
    expect(w.text()).not.toContain('(unchecked)')
    w.unmount()
  })

  it('marks the refund and outbox sentences', () => {
    const bound = view(revert(), { state: 'bound' })
    const refund = bound.find('[data-slot="status-explanation"] p:nth-child(2)').text()
    expect(refund).toContain('refunded')
    expect(refund.endsWith(' (unchecked)')).toBe(true)
    bound.unmount()

    const outbox = view(finalize(), { state: 'bound' })
    const sentence = outbox.findAll('p').find((p) => p.text().includes('outbox'))?.text() ?? ''
    expect(sentence).toContain('outbox')
    expect(sentence.endsWith(' (unchecked)')).toBe(true)
    outbox.unmount()

    const verified = view(revert(), { state: 'verified' })
    expect(verified.find('[data-slot="status-explanation"]').text()).not.toContain('(unchecked)')
    verified.unmount()
  })

  it('marks Domain and Sender while the bindings are unchecked', () => {
    const w = view(call(), { state: 'waiting', reason: 'x', bindingsChecked: false })
    expect(w.text()).toContain('Domain (unchecked)')
    expect(w.text()).toContain('Sender (unchecked)')
    w.unmount()
  })

  it('marks only the tag for a held latest copy that passed', () => {
    const w = view(call(), { state: 'waiting', reason: 'x', bindingsChecked: true, latestChecked: true })
    const text = w.text()
    expect(text).toContain('read at latest (unchecked)')
    expect(text).not.toContain('SUCCESS (unchecked)')
    expect(text).not.toContain('Gas used (unchecked)')
    expect(text).not.toContain('Events (unchecked)')
    w.unmount()
  })
})
