import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { SettlementContract } from 'znn-typescript-sdk'
import type { ContractFeatures, ContractView } from 'zeno-client'
import { AccountService } from '../account-service'
import { SettlementService } from '../settlement-service'
import { ADDRESS, CONTRACT_ID, connectWallet, disconnectWallet } from './call-test-helpers'
import { useContractManage } from './useContractManage'
import { useSettings } from './useSettings'

const features = (over: Partial<ContractFeatures> = {}): ContractFeatures => ({
  upgrade: true, ownershipTransfer: true, storageQuota: true, payableCalls: true, deposits: true, nativeAddresses: false, ...over,
})

const view = (over: Partial<ContractView> = {}): ContractView => ({
  codeHash: '22'.repeat(32), sourceCodeHash: '33'.repeat(32), upgradePolicy: 'OWNER_UPGRADEABLE', owner: ADDRESS,
  ownerCaller: '44'.repeat(32), quota: { purchased: 0, used: 0 }, nativeAddress: null, ...over,
})

const make = (v: ContractView | null = view(), f: ContractFeatures | null = features(), domainId = 1) =>
  useContractManage({ domainId: ref(domainId), contractId: ref(CONTRACT_ID), view: ref(v), features: ref(f) })

const sighash = (name: string) => SettlementContract.abi.getSighash(name).replace(/^0x/, '')
const dataOf = (stub: { calls: { method: string; args: unknown[] }[] }) =>
  Buffer.from((stub.calls.find((c) => c.method === 'sendAccountBlock')?.args[0] as { data: string }).data, 'base64').toString('hex')
const amountOf = (stub: { calls: { method: string; args: unknown[] }[] }) =>
  (stub.calls.find((c) => c.method === 'sendAccountBlock')?.args[0] as { amount: string }).amount

describe('useContractManage', () => {
  afterEach(async () => {
    await disconnectWallet()
    vi.restoreAllMocks()
  })

  describe('which actions are offered', () => {
    it('offers every action to the owner of an upgradeable contract on a domain that allows them', async () => {
      await connectWallet()
      expect(make().available.value).toEqual({ deposit: true, buyStorage: true, ownership: true, upgrade: true })
    })

    it('hides each action whose flag is unset', async () => {
      await connectWallet()
      expect(make(view(), features({ deposits: false })).available.value.deposit).toBe(false)
      expect(make(view(), features({ storageQuota: false })).available.value.buyStorage).toBe(false)
      expect(make(view(), features({ ownershipTransfer: false })).available.value.ownership).toBe(false)
      expect(make(view(), features({ upgrade: false })).available.value.upgrade).toBe(false)
    })

    it('hides ownership and upgrade from an address that is not the owner', async () => {
      await connectWallet('z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7')
      const a = make().available.value
      expect(a.ownership).toBe(false)
      expect(a.upgrade).toBe(false)
      expect(a.deposit).toBe(true)
    })

    it('hides the upgrade of an immutable contract', async () => {
      await connectWallet()
      expect(make(view({ upgradePolicy: 'IMMUTABLE', owner: null })).available.value.upgrade).toBe(false)
    })

    it('offers nothing before the features are known', async () => {
      await connectWallet()
      expect(Object.values(make(view(), null).available.value)).toEqual([false, false, false, false])
    })
  })

  describe('domain', () => {
    const word = (id: number) => id.toString(16).padStart(64, '0')

    it('sends a deposit, a storage purchase and an ownership change to the context domain', async () => {
      vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
        getPeripheryConfig: async () => ({ znnPerByteOfState: 200n }),
      } as never)
      expect(useSettings().settings.value.domainId).toBe(1)
      const stub = await connectWallet()
      const m = make(view(), features(), 2)
      const sent = () =>
        stub.calls
          .filter((c) => c.method === 'sendAccountBlock')
          .map((c) => Buffer.from((c.args[0] as { data: string }).data, 'base64').toString('hex'))
      await m.deposit(m.ZNN, '1', 1000n)
      await m.buyStorage(10n)
      await m.transferOwnership('z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7')
      expect(m.error.value).toBeNull()
      expect(sent()).toHaveLength(3)
      for (const data of sent()) expect(data.slice(8, 72)).toBe(word(2))
    })

    it('keeps the domain of the click when the route changes during the send', async () => {
      const stub = await connectWallet()
      const domainId = ref(2)
      const m = useContractManage({ domainId, contractId: ref(CONTRACT_ID), view: ref(view()), features: ref(features()) })
      const sending = m.deposit(m.ZNN, '1', 1000n)
      domainId.value = 3
      await sending
      expect(dataOf(stub).slice(8, 72)).toBe(word(2))
    })

    it('keeps the contract of the click when the route changes during the send', async () => {
      const stub = await connectWallet()
      const contractId = ref(CONTRACT_ID)
      const m = useContractManage({ domainId: ref(2), contractId, view: ref(view()), features: ref(features()) })
      const sending = m.deposit(m.ZNN, '1', 1000n)
      contractId.value = '22'.repeat(32)
      await sending
      expect(dataOf(stub)).toContain(CONTRACT_ID)
      expect(dataOf(stub)).not.toContain('22'.repeat(32))
    })
  })

  describe('actions', () => {
    it('deposits a typed amount in base units', async () => {
      const stub = await connectWallet()
      const m = make()
      await m.deposit(m.ZNN, '2', 1000n)
      expect(m.error.value).toBeNull()
      expect(amountOf(stub)).toBe('200000000')
      expect(dataOf(stub).startsWith(sighash('Deposit'))).toBe(true)
      expect(m.lastHash.value).toBe('ab'.repeat(32))
    })

    it('refuses a deposit of zero and an unknown token', async () => {
      await connectWallet()
      const m = make()
      await m.deposit(m.ZNN, '0', 1000n)
      expect(m.error.value).toBe('Enter an amount above zero.')
      vi.spyOn(AccountService, 'getInstance').mockReturnValue({ getTokenDecimals: async () => null } as never)
      await m.deposit('zts1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', '1', 1000n)
      expect(m.error.value).toBe('The token does not exist.')
    })

    it('buys storage and attaches bytes times the state price', async () => {
      vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
        getPeripheryConfig: async () => ({ znnPerByteOfState: 200n }),
      } as never)
      const stub = await connectWallet()
      const m = make()
      await m.buyStorage(1024n)
      expect(m.error.value).toBeNull()
      expect(amountOf(stub)).toBe((1024n * 200n).toString())
      expect(dataOf(stub).startsWith(sighash('BuyStorage'))).toBe(true)
      expect(await m.storageFee(10n)).toBe(2000n)
    })

    it('refuses to buy storage while the state price is unset', async () => {
      vi.spyOn(SettlementService, 'getInstance').mockReturnValue({ getPeripheryConfig: async () => null } as never)
      const stub = await connectWallet()
      const m = make()
      await m.buyStorage(10n)
      expect(m.error.value).toMatch(/state price is not set/)
      expect(stub.calls.some((c) => c.method === 'sendAccountBlock')).toBe(false)
      expect(await m.storageFee(10n)).toBeNull()
    })

    it('refuses to buy zero bytes', async () => {
      await connectWallet()
      const m = make()
      await m.buyStorage(0n)
      expect(m.error.value).toBe('Buy at least one byte.')
    })

    it('transfers ownership to a new address', async () => {
      const stub = await connectWallet()
      const m = make()
      await m.transferOwnership('z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7')
      expect(m.error.value).toBeNull()
      const data = dataOf(stub)
      expect(data.startsWith(sighash('TransferContractOwnership'))).toBe(true)
      expect(data.slice(-64)).not.toBe('0'.repeat(64))
    })

    it('renounces ownership by transferring to the zero address', async () => {
      const stub = await connectWallet()
      const m = make()
      await m.renounceOwnership()
      expect(m.error.value).toBeNull()
      const data = dataOf(stub)
      expect(data.startsWith(sighash('TransferContractOwnership'))).toBe(true)
      expect(data.slice(-64)).toBe('0'.repeat(64))
    })

    it('rejects an address that does not parse', async () => {
      const stub = await connectWallet()
      const m = make()
      await m.transferOwnership('not-an-address')
      expect(m.error.value).toBeTruthy()
      expect(stub.calls.some((c) => c.method === 'sendAccountBlock')).toBe(false)
    })

    it('needs a connected wallet', async () => {
      const m = make()
      await m.buyStorage(10n)
      expect(m.error.value).toBe('Connect a wallet first.')
    })
  })
})
