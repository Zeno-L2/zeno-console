import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { SETTLEMENT_ADDRESS, settlement } from 'znn-typescript-sdk'
import type { ContractFeatures, ContractInterface, TagName } from 'zeno-client'
import {
  ADDRESS,
  CONTRACT_ID,
  connectWallet,
  disconnectWallet,
  iface,
  selectorHex,
  simulation,
  useSimulateGateway,
} from './call-test-helpers'
import { useContractCall } from './useContractCall'
import { useSettings } from './useSettings'

const features = (over: Partial<ContractFeatures> = {}): ContractFeatures => ({
  upgrade: true, ownershipTransfer: true, storageQuota: true, payableCalls: true, deposits: true, nativeAddresses: false, ...over,
})

const make = (opts: { iface?: ContractInterface | null; features?: ContractFeatures; tag?: TagName; domainId?: number } = {}) =>
  useContractCall({
    domainId: ref(opts.domainId ?? 1),
    contractId: ref(CONTRACT_ID),
    iface: ref('iface' in opts ? (opts.iface ?? null) : iface),
    features: ref(opts.features ?? features()),
    tag: ref(opts.tag ?? 'latest'),
  })

const domainWord = (id: number) => id.toString(16).padStart(64, '0')

describe('useContractCall', () => {
  beforeEach(() => {
    useSimulateGateway()
  })
  afterEach(async () => {
    await disconnectWallet()
    vi.restoreAllMocks()
  })

  describe('encoding', () => {
    it('encodes the selected method and its arguments', () => {
      const c = make()
      c.selectMethod('add')
      c.argTexts.value = ['5']
      expect(c.payload.value.problem).toBeNull()
      expect(Buffer.from(c.payload.value.bytes as Uint8Array).toString('hex')).toBe(selectorHex('add') + '0000000000000005')
      expect(c.payloadSize.value).toBe(12)
    })

    it('holds the payload back until the arguments parse', () => {
      const c = make()
      c.selectMethod('add')
      c.argTexts.value = ['x']
      expect(c.payload.value.bytes).toBeNull()
      expect(c.payload.value.problem).toBe('Fix the arguments first.')
      expect(c.canSimulate.value).toBe(false)
    })

    it('asks for a method before it encodes', () => {
      expect(make().payload.value.problem).toBe('Choose a method.')
    })

    it('takes a raw hex payload when there is no interface', () => {
      const c = make({ iface: null })
      c.rawPayload.value = '0xdeadbeef'
      expect(c.hasInterface.value).toBe(false)
      expect(Buffer.from(c.payload.value.bytes as Uint8Array).toString('hex')).toBe('deadbeef')
      c.rawPayload.value = 'xyz'
      expect(c.payload.value.problem).toBe('Enter the payload as hex.')
    })

    it('refuses a payload above MaxCallPayload', () => {
      const c = make({ iface: null })
      c.rawPayload.value = '00'.repeat(settlement.MaxCallPayload + 1)
      expect(c.payload.value.problem).toMatch(/above MaxCallPayload/)
    })

    it('checks the plasma limit', () => {
      const c = make()
      c.plasmaLimit.value = 'abc'
      expect(c.plasma.value.problem).toMatch(/whole number/)
      c.plasmaLimit.value = (settlement.MaxInputGas + 1n).toString()
      expect(c.plasma.value.problem).toMatch(/above MaxInputGas/)
      c.plasmaLimit.value = '5000'
      expect(c.plasma.value.value).toBe(5000n)
    })

    it('prices the L1 send from its calldata', () => {
      const c = make()
      c.selectMethod('add')
      c.argTexts.value = ['5']
      expect(c.l1Plasma.value).toBeGreaterThanOrEqual(52_500)
    })

    it('knows which methods only read', () => {
      const c = make()
      c.selectMethod('get')
      expect(c.isReadMethod.value).toBe(true)
      c.selectMethod('add')
      expect(c.isReadMethod.value).toBe(false)
    })

    it('offers a deposit only when the domain allows payable calls', () => {
      const on = make()
      on.selectMethod('add')
      expect(on.canDeposit.value).toBe(true)
      const off = make({ features: features({ payableCalls: false }) })
      off.selectMethod('add')
      expect(off.canDeposit.value).toBe(false)
    })
  })

  describe('simulate', () => {
    it('simulates from the anonymous sender when no wallet is connected and decodes the return value', async () => {
      const rig = useSimulateGateway()
      const c = make()
      c.selectMethod('get')
      await c.simulate()
      const sent = rig.requests[0]
      expect(sent.method).toBe('zeno_simulate')
      expect(sent.params[0]).toBe(1)
      expect(sent.params[1]).toMatchObject({
        kind: 'CallL2',
        sender: 'z1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsggv2f',
        targetContract: CONTRACT_ID,
        payload: selectorHex('get'),
        plasmaLimit: 1000000,
      })
      expect(c.details.value?.returnValue).toEqual({ total: 9n })
      expect(c.details.value?.method).toBe('get')
      expect(c.simulation.value?.verified).toBe(false)
    })

    it('simulates from the connected address', async () => {
      const rig = useSimulateGateway()
      await connectWallet()
      const c = make()
      c.selectMethod('add')
      c.argTexts.value = ['3']
      await c.simulate()
      expect((rig.requests[0].params[1] as { sender: string }).sender).toBe(ADDRESS)
    })

    it('names a simulated revert and decodes its fields', async () => {
      const rig = useSimulateGateway()
      rig.answers.latest = simulation({ status: 'REVERT', abortCode: 1, returnData: '000000000000002a' })
      const c = make()
      c.selectMethod('add')
      c.argTexts.value = ['3']
      await c.simulate()
      expect(c.details.value?.tone).toBe('destructive')
      expect(c.details.value?.error).toEqual({ code: 1, name: 'Overflow', fields: { limit: 42n } })
    })

    it('falls back to latest when the gateway does not serve pending', async () => {
      const rig = useSimulateGateway()
      rig.answers.latest = simulation({ gasUsed: 77 })
      const c = make({ tag: 'pending' })
      c.selectMethod('get')
      await c.simulate()
      expect(rig.requests.map((r) => r.params[2])).toEqual(['pending', 'latest'])
      expect(c.simulatedAt.value).toBe('latest')
      expect(c.simulation.value?.gasUsed).toBe(77)
    })

    it('reads at pending when the gateway serves it', async () => {
      const rig = useSimulateGateway()
      rig.answers.pending = simulation({ gasUsed: 12 })
      const c = make({ tag: 'pending' })
      c.selectMethod('get')
      await c.simulate()
      expect(c.simulatedAt.value).toBe('pending')
    })

    it('suggests a plasma limit from the gas used, with a margin, and applies it', async () => {
      const rig = useSimulateGateway()
      rig.answers.latest = simulation({ gasUsed: 4000 })
      const c = make()
      c.selectMethod('get')
      expect(c.suggestedPlasma.value).toBeNull()
      await c.simulate()
      expect(c.suggestedPlasma.value).toBe(5000n)
      c.applySuggestedPlasma()
      expect(c.plasmaLimit.value).toBe('5000')
    })

    it('reports a gateway failure and clears the last result', async () => {
      const rig = useSimulateGateway()
      const c = make()
      c.selectMethod('get')
      await c.simulate()
      expect(c.simulation.value).not.toBeNull()
      rig.answers.latest = { code: -32006, message: 'simulation is disabled' }
      await c.simulate()
      expect(c.simulation.value).toBeNull()
      expect(c.error.value).toBe('simulation is disabled')
    })

    it('does not simulate an incomplete call', async () => {
      const rig = useSimulateGateway()
      const c = make()
      c.selectMethod('add')
      await c.simulate()
      expect(rig.requests).toHaveLength(0)
      expect(c.error.value).toBe('Fix the arguments first.')
    })
  })

  describe('domain', () => {
    it('simulates in the context domain, not the settings domain', async () => {
      const rig = useSimulateGateway()
      expect(useSettings().settings.value.domainId).toBe(1)
      const c = make({ domainId: 2 })
      c.selectMethod('get')
      await c.simulate()
      expect(rig.requests[0].params[0]).toBe(2)
    })

    it('sends a call to the context domain, not the settings domain', async () => {
      const stub = await connectWallet()
      expect(useSettings().settings.value.domainId).toBe(1)
      const c = make({ domainId: 2 })
      c.selectMethod('add')
      c.argTexts.value = ['5']
      await c.send()
      expect(c.error.value).toBeNull()
      const block = stub.calls.find((x) => x.method === 'sendAccountBlock')?.args[0] as { data: string }
      const data = Buffer.from(block.data, 'base64').toString('hex')
      expect(data.slice(8, 72)).toBe(domainWord(2))
    })

    it('keeps the domain of the click when the route changes during the send', async () => {
      const stub = await connectWallet()
      const domainId = ref(2)
      const c = useContractCall({
        domainId,
        contractId: ref(CONTRACT_ID),
        iface: ref(iface),
        features: ref(features()),
        tag: ref<TagName>('latest'),
      })
      c.selectMethod('add')
      c.argTexts.value = ['5']
      c.depositEnabled.value = true
      c.depositAmount.value = '1'
      const sending = c.send()
      domainId.value = 3
      await sending
      const block = stub.calls.find((x) => x.method === 'sendAccountBlock')?.args[0] as { data: string }
      expect(Buffer.from(block.data, 'base64').toString('hex').slice(8, 72)).toBe(domainWord(2))
    })

    it('keeps the contract of the click when the route changes during the send', async () => {
      const stub = await connectWallet()
      const contractId = ref(CONTRACT_ID)
      const c = useContractCall({
        domainId: ref(2),
        contractId,
        iface: ref(iface),
        features: ref(features()),
        tag: ref<TagName>('latest'),
      })
      c.selectMethod('add')
      c.argTexts.value = ['5']
      c.depositEnabled.value = true
      c.depositAmount.value = '1'
      const sending = c.send()
      contractId.value = '22'.repeat(32)
      await sending
      const block = stub.calls.find((x) => x.method === 'sendAccountBlock')?.args[0] as { data: string }
      const data = Buffer.from(block.data, 'base64').toString('hex')
      expect(data).toContain(CONTRACT_ID)
      expect(data).not.toContain('22'.repeat(32))
    })

    it('keeps the domain and contract of the click when the route changes during a simulation', async () => {
      const rig = useSimulateGateway()
      const domainId = ref(2)
      const contractId = ref(CONTRACT_ID)
      const c = useContractCall({
        domainId,
        contractId,
        iface: ref(iface),
        features: ref(features()),
        tag: ref<TagName>('latest'),
      })
      c.selectMethod('add')
      c.argTexts.value = ['5']
      c.depositEnabled.value = true
      c.depositAmount.value = '1'
      const simulating = c.simulate()
      domainId.value = 3
      contractId.value = '22'.repeat(32)
      await simulating
      const [domain, input] = rig.requests[0].params as [number, { targetContract: string }]
      expect(domain).toBe(2)
      expect(input.targetContract).toBe(CONTRACT_ID)
    })
  })

  describe('send', () => {
    it('asks the wallet to sign a CallL2 to Settlement and keeps the hash', async () => {
      const stub = await connectWallet()
      const c = make()
      c.selectMethod('add')
      c.argTexts.value = ['5']
      await c.send()
      expect(c.error.value).toBeNull()
      expect(c.sentHash.value).toBe('ab'.repeat(32))
      const block = stub.calls.find((x) => x.method === 'sendAccountBlock')?.args[0] as { toAddress: string; amount: string; data: string }
      expect(block.toAddress).toBe(SETTLEMENT_ADDRESS.toString())
      expect(block.amount).toBe('0')
      expect(Buffer.from(block.data, 'base64').toString('hex')).toContain(selectorHex('add') + '0000000000000005')
    })

    it('attaches the deposit, converted to base units', async () => {
      const stub = await connectWallet()
      const c = make()
      c.selectMethod('add')
      c.argTexts.value = ['5']
      c.depositEnabled.value = true
      c.depositAmount.value = '1.5'
      await c.send()
      expect(c.error.value).toBeNull()
      const block = stub.calls.find((x) => x.method === 'sendAccountBlock')?.args[0] as { amount: string }
      expect(block.amount).toBe('150000000')
    })

    it('sends even when the preview showed a revert', async () => {
      const rig = useSimulateGateway()
      rig.answers.latest = simulation({ status: 'REVERT', abortCode: 1, returnData: '000000000000002a' })
      const stub = await connectWallet()
      const c = make()
      c.selectMethod('add')
      c.argTexts.value = ['5']
      await c.simulate()
      expect(c.details.value?.tone).toBe('destructive')
      await c.send()
      expect(stub.calls.some((x) => x.method === 'sendAccountBlock')).toBe(true)
    })

    it('needs a connected wallet', async () => {
      const c = make()
      c.selectMethod('add')
      c.argTexts.value = ['5']
      await c.send()
      expect(c.error.value).toBe('Connect a wallet first.')
      expect(c.sentHash.value).toBeNull()
    })

    it('reports a rejection in the wallet', async () => {
      const stub = await connectWallet()
      stub.failures.sendAccountBlock = { code: 4001, message: 'rejected' }
      const c = make()
      c.selectMethod('add')
      c.argTexts.value = ['5']
      await c.send()
      expect(c.error.value).toBe('The request was rejected in the wallet.')
      expect(c.isSending.value).toBe(false)
    })
  })
})
