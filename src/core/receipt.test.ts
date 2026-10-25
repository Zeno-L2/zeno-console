import { describe, expect, it } from 'vitest'
import { selectorOf, sha3, zenoSelectorV1 } from 'zeno-client'
import type { ContractInterface, ReceiptResult } from 'zeno-client'
import recorded from '../../test/fixtures/gateway-go.json'
import { STATUS_INFO, describeEvents, describeReceipt, describeSimulation, describeStatus } from './receipt'
import type { ReceiptStatusName } from './receipt'

type Call = { name: string; response: { result: unknown } }
const result = (name: string) => (recorded.calls as unknown as Call[]).find((c) => c.name === name)!.response.result as ReceiptResult

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
    {
      name: 'reset',
      selector: hex(selectorOf('reset')),
      payable: false,
      readonly: false,
      inputs: [],
      outputs: [],
    },
  ],
  on_deposit: null,
  events: [
    {
      name: 'Added',
      topic: hex(sha3(new TextEncoder().encode('Added'))),
      fields: [{ name: 'amount', type: 'u64', indexed: false }],
    },
  ],
  errors: [{ code: 1, name: 'Overflow', fields: [{ name: 'limit', type: 'u64' }], description: 'The limit is reached.' }],
  storage: [],
}

const base = (): ReceiptResult => structuredClone(result('getReceipt success'))

describe('describeReceipt', () => {
  it('reads the deploy result from a recorded successful finalize', () => {
    const d = describeReceipt(result('getReceipt success'))
    expect(d.status).toBe('SUCCESS')
    expect(d.tone).toBe('success')
    expect(d.deployed?.sourceCodeHash).toHaveLength(64)
    expect(d.deployed?.codeHash).toHaveLength(64)
    expect(d.deployed?.codeHash).toBe(result('getReceipt success').receipt.codeHash)
  })

  it('marks a recorded unauthorized receipt as a failure with no deploy result', () => {
    const d = describeReceipt(result('getReceipt unauthorized'))
    expect(d.status).toBe('UNAUTHORIZED')
    expect(d.tone).toBe('destructive')
    expect(d.deployed).toBeUndefined()
  })

  it('decodes a call: the method, the return value and the events', () => {
    const r = base()
    r.input = { kind: 'CallL2', inputKind: 0, sourceAccountBlockHash: '00'.repeat(32), payload: hex(selectorOf('add')) + '0000000000000005' }
    r.returnData = '0000000000000009'
    r.events = [{ contractId: '11'.repeat(32), inputIndex: 1, eventIndex: 0, topics: [iface.events[0].topic!], data: '0000000000000005' }]
    const d = describeReceipt(r, iface)
    expect(d.method).toBe('add')
    expect(d.returnValue).toEqual({ total: 9n })
    expect(d.events[0].decoded).toEqual({ name: 'Added', fields: { amount: 5n } })
  })

  it('leaves the return value undefined for a method with no outputs', () => {
    const r = base()
    r.input = { kind: 'CallL2', inputKind: 0, sourceAccountBlockHash: '00'.repeat(32), payload: hex(selectorOf('reset')) }
    r.returnData = ''
    const d = describeReceipt(r, iface)
    expect(d.method).toBe('reset')
    expect(d.returnValue).toBeUndefined()
    expect(d.decodeError).toBeUndefined()
  })

  it('names a revert and decodes its fields', () => {
    const r = base()
    r.receipt.status = 'REVERT'
    r.receipt.abortCode = 1
    r.returnData = '000000000000002a'
    r.input = { kind: 'CallL2', inputKind: 0, sourceAccountBlockHash: '00'.repeat(32), payload: hex(selectorOf('add')) + '0000000000000005' }
    const d = describeReceipt(r, iface)
    expect(d.tone).toBe('destructive')
    expect(d.error).toEqual({ code: 1, name: 'Overflow', fields: { limit: 42n } })
    expect(d.returnValue).toBeUndefined()
  })

  it('leaves return data and events raw without an interface', () => {
    const r = base()
    r.events = [{ contractId: '11'.repeat(32), inputIndex: 1, eventIndex: 0, topics: ['aa'.repeat(32)], data: '00' }]
    const d = describeReceipt(r)
    expect(d.events[0].decoded).toBeNull()
    expect(d.events[0].raw.data).toBe('00')
    expect(d.method).toBeUndefined()
  })

  it('reports when the interface does not fit the data instead of throwing', () => {
    const r = base()
    r.input = { kind: 'CallL2', inputKind: 0, sourceAccountBlockHash: '00'.repeat(32), payload: hex(selectorOf('add')) }
    r.returnData = 'ff'
    const d = describeReceipt(r, iface)
    expect(d.decodeError).toBeTruthy()
    expect(zenoSelectorV1.encoding).toBe('zeno-selector-v1')
  })

  describe('describeSimulation', () => {
    const sim = (over: Record<string, unknown> = {}) =>
      ({
        domainId: 1, batchId: 3, postStateRoot: '', verified: false, simulated: true, inputIndex: 14, momentumHeight: 1, momentumTime: 1,
        momentumHash: '', status: 'SUCCESS', gasUsed: 321, abortCode: 0, contractId: '11'.repeat(32), codeHash: '22'.repeat(32),
        returnData: '0000000000000009', events: [], outbox: [], stateDiff: [], ...over,
      }) as never

    const payload = hex(selectorOf('add')) + '0000000000000005'

    it('decodes the return value of the called method', () => {
      const d = describeSimulation(sim(), iface, payload)
      expect(d.method).toBe('add')
      expect(d.returnValue).toEqual({ total: 9n })
      expect(d.gasUsed).toBe(321)
    })

    it('names a simulated revert and its fields', () => {
      const d = describeSimulation(sim({ status: 'REVERT', abortCode: 1, returnData: '000000000000002a' }), iface, payload)
      expect(d.tone).toBe('destructive')
      expect(d.error).toEqual({ code: 1, name: 'Overflow', fields: { limit: 42n } })
    })

    it('decodes simulated events', () => {
      const events = [{ contractId: '11'.repeat(32), inputIndex: 14, eventIndex: 0, topics: [iface.events[0].topic!], data: '0000000000000005' }]
      expect(describeSimulation(sim({ events }), iface, payload).events[0].decoded?.name).toBe('Added')
    })

    it('leaves the data raw without an interface', () => {
      const d = describeSimulation(sim(), null, payload)
      expect(d.method).toBeUndefined()
      expect(d.returnValue).toBeUndefined()
    })
  })
})

describe('describeStatus', () => {
  const statuses = Object.keys(STATUS_INFO) as ReceiptStatusName[]

  it('explains every status in a sentence or two', () => {
    expect(statuses).toHaveLength(9)
    for (const status of statuses) {
      const { summary } = describeStatus(status)
      expect(summary.length).toBeGreaterThan(20)
      expect(summary.split(/[.!?](?:\s|$)/).filter(Boolean).length).toBeLessThanOrEqual(2)
    }
  })

  it('tells the owner of a full quota to buy storage', () => {
    expect(describeStatus('STORAGE_QUOTA_EXCEEDED').summary).toContain('Buy storage')
  })

  it('falls back to a generic explanation for an unknown status', () => {
    expect(describeStatus('FROM_THE_FUTURE').summary).toContain('not known')
    expect(describeStatus('toString').summary).toContain('not known')
  })

  it('refunds a deposit on every failure except an unsupported input', () => {
    const refunding = statuses.filter((s) => describeStatus(s).refundsDeposit)
    expect(refunding).toEqual([
      'REVERT',
      'OUT_OF_GAS',
      'RUNTIME_FAULT',
      'VALIDATION_FAILED',
      'RESULT_TOO_LARGE',
      'UNAUTHORIZED',
      'STORAGE_QUOTA_EXCEEDED',
    ])
  })
})

describe('describeReceipt refund', () => {
  const withdrawal = {
    outboxId: '11'.repeat(32),
    sourceContract: '00'.repeat(32),
    inputIndex: 11,
    outboxIndex: 0,
    kind: 'L1_WITHDRAWAL',
    targetContract: null,
    recipient: 'z1qpeet8dcjg0m6x6m3tg437wnc42aa2nez2fzth',
    assetId: '22'.repeat(32),
    amount: '50000000000',
    payload: '',
  }
  const failed = (status: string, outbox: unknown[]) =>
    ({
      ...result('getReceipt success'),
      receipt: { ...result('getReceipt success').receipt, status, outboxCount: outbox.length },
      outbox,
    }) as unknown as ReceiptResult

  it('reads the deposit refund from a failed receipt', () => {
    const details = describeReceipt(failed('STORAGE_QUOTA_EXCEEDED', [withdrawal]))
    expect(details.explanation).toBe(STATUS_INFO.STORAGE_QUOTA_EXCEEDED.summary)
    expect(details.refund).toEqual({ recipient: withdrawal.recipient, assetId: withdrawal.assetId, amount: '50000000000' })
  })

  it('reports no refund when the outbox has none', () => {
    expect(describeReceipt(failed('REVERT', [])).refund).toBeUndefined()
  })

  it('does not treat a successful call withdrawal as a refund', () => {
    expect(describeReceipt(failed('SUCCESS', [withdrawal])).refund).toBeUndefined()
  })
})

describe('describeEvents', () => {
  const event = (data: string, topics = [iface.events[0].topic!]) => ({
    contractId: '11'.repeat(32),
    inputIndex: 1,
    eventIndex: 0,
    topics,
    data,
  })

  it('keeps every event raw without an interface', () => {
    const raw = [event('0000000000000005'), event('0000000000000006')]
    const out = describeEvents(raw)
    expect(out.map((e) => e.decoded)).toEqual([null, null])
    expect(out.map((e) => e.raw)).toEqual(raw)
  })

  it('keeps events raw for a null interface', () => {
    expect(describeEvents([event('00')], null)[0].decoded).toBeNull()
  })

  it('decodes each event with the interface', () => {
    const out = describeEvents([event('0000000000000005'), event('0000000000000007')], iface)
    expect(out.map((e) => e.decoded)).toEqual([
      { name: 'Added', fields: { amount: 5n } },
      { name: 'Added', fields: { amount: 7n } },
    ])
  })

  it('returns an empty list for no events', () => {
    expect(describeEvents([], iface)).toEqual([])
  })

  it('throws when the interface does not fit an event', () => {
    expect(() => describeEvents([event('00')], iface)).toThrow()
  })
})
