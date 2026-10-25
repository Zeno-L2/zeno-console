import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { Address, Hash, TokenStandard, ZNN_ZTS, extractNumberDecimals } from 'znn-typescript-sdk'
import type { ContractFeatures, ContractView } from 'zeno-client'
import { AccountService } from '../account-service'
import { SettlementService } from '../settlement-service'
import { SettlementWriteService } from '../settlement-write-service'
import { loadWallet } from '../wallet-loader'
import { useWalletProvider } from './useWalletProvider'

const ZERO_ADDRESS = 'z1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsggv2f'

export interface ManageContext {
  domainId: Ref<number>
  contractId: Ref<string>
  view: Ref<ContractView | null>
  features: Ref<ContractFeatures | null>
}

/** The contract's own actions: deposit, buy storage, change owner and upgrade. */
export function useContractManage(ctx: ManageContext) {
  const wallet = useWalletProvider()
  const writer = SettlementWriteService.getInstance()

  const isSending = ref(false)
  const error = ref<string | null>(null)
  const lastHash = ref<string | null>(null)

  const isOwner = computed(
    () => ctx.view.value?.owner != null && ctx.view.value.owner === wallet.address.value
  )
  const flag = (name: keyof ContractFeatures) => ctx.features.value?.[name] === true

  /** What the Manage tab offers. An action whose flag is unset is hidden. */
  const available = computed(() => ({
    deposit: flag('deposits'),
    buyStorage: flag('storageQuota'),
    ownership: flag('ownershipTransfer') && isOwner.value,
    upgrade: flag('upgrade') && ctx.view.value?.upgradePolicy === 'OWNER_UPGRADEABLE' && isOwner.value,
  }))

  /** The domain and contract of the click, so a route change during an await cannot redirect the send. */
  const captured = () => ({ domainId: ctx.domainId.value, contractId: ctx.contractId.value })

  async function run(build: () => Promise<ReturnType<typeof writer.buyStorage>>) {
    error.value = null
    lastHash.value = null
    if (!wallet.isConnected.value) {
      error.value = 'Connect a wallet first.'
      return
    }
    isSending.value = true
    try {
      const published = await (await loadWallet()).send(await build())
      const hash = (published as { hash?: unknown } | null)?.hash
      lastHash.value = typeof hash === 'string' ? hash : null
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'The send failed.'
    } finally {
      isSending.value = false
    }
  }

  /** A ZTS deposit with no payload. `amount` is typed in the token's own units. */
  function deposit(token: string, amount: string, plasmaLimit: bigint) {
    const { domainId, contractId } = captured()
    return run(async () => {
      const decimals = await AccountService.getInstance().getTokenDecimals(token)
      if (decimals === null) throw new Error('The token does not exist.')
      const base = extractNumberDecimals(amount.trim(), decimals)
      if (base <= 0n) throw new Error('Enter an amount above zero.')
      return writer.deposit(domainId, Hash.parse(contractId), plasmaLimit, TokenStandard.parse(token), base)
    })
  }

  /** The fee for `bytes` of storage, or null when the price is unset. */
  async function storageFee(bytes: bigint): Promise<bigint | null> {
    const prices = await SettlementService.getInstance().getPeripheryConfig()
    return prices ? bytes * prices.znnPerByteOfState : null
  }

  function buyStorage(bytes: bigint) {
    const { domainId, contractId } = captured()
    return run(async () => {
      if (bytes < 1n) throw new Error('Buy at least one byte.')
      const prices = await SettlementService.getInstance().getPeripheryConfig()
      if (!prices) throw new Error('The state price is not set yet, so Settlement rejects storage purchases.')
      return writer.buyStorage(domainId, Hash.parse(contractId), bytes, prices.znnPerByteOfState)
    })
  }

  function transferOwnership(newOwner: string) {
    const { domainId, contractId } = captured()
    return run(async () => {
      const owner = Address.parse(newOwner.trim())
      return writer.transferOwnership(domainId, Hash.parse(contractId), owner)
    })
  }

  /** Transfers ownership to the zero address. It is permanent. */
  function renounceOwnership() {
    return transferOwnership(ZERO_ADDRESS)
  }

  return { isOwner, available, isSending, error, lastHash, deposit, buyStorage, storageFee, transferOwnership, renounceOwnership, ZNN: ZNN_ZTS.toString() }
}
