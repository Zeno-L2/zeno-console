import { computed, ref } from 'vue'
import { useNetwork } from './useNetwork'
import { STORAGE_KEY_WALLET_CONNECTED } from '../../config'
import { storageService } from '../storage/storage-service'
import { WalletError, hostOf } from '../wallet-provider'
import type { NetworkCheck } from '../wallet-provider'
import { loadWallet } from '../wallet-loader'

// Module-level reactive state, shared across every useWalletProvider() caller
const isAvailable = ref(false)
const isConnecting = ref(false)
const accounts = ref<string[]>([])
const walletChainId = ref<number | null>(null)
const walletNodeUrl = ref<string | null>(null)
const error = ref<string | null>(null)

let unsubscribe: (() => void) | null = null

export function useWalletProvider() {
  isAvailable.value = window.zenon !== undefined
  const network = useNetwork()

  /** The connected account the console acts as, or null. */
  const address = computed(() => accounts.value[0] ?? null)
  const isConnected = computed(() => address.value !== null)

  /**
   * Compares the wallet's chain and node with the console's current values.
   * It reports no mismatch until the console has loaded its persisted network
   * settings, because the values before that are placeholders.
   */
  const mismatch = computed<NetworkCheck>(() => {
    if (!isConnected.value || !network.isInitialized.value) {
      return { chainMismatch: false, nodeMismatch: false }
    }
    return {
      chainMismatch: walletChainId.value !== null && walletChainId.value !== network.chainId.value,
      nodeMismatch:
        walletNodeUrl.value !== null &&
        hostOf(walletNodeUrl.value) !== hostOf(network.currentNode.value),
    }
  })

  function recordError(err: unknown) {
    error.value = err instanceof WalletError ? err.message : 'The wallet returned an error.'
  }

  async function recheckNetwork() {
    try {
      const service = await loadWallet()
      const [chainId, nodeUrl] = await Promise.all([service.getChainId(), service.getNodeUrl()])
      walletChainId.value = chainId
      walletNodeUrl.value = nodeUrl
    } catch (err) {
      recordError(err)
    }
  }

  async function setConnectedFlag(connected: boolean) {
    if (connected) await storageService.set(STORAGE_KEY_WALLET_CONNECTED, true)
    else await storageService.remove(STORAGE_KEY_WALLET_CONNECTED)
  }

  /**
   * Loads the adapter, subscribes to the provider's events and reads the
   * accounts. It never prompts.
   */
  async function attach() {
    const service = await loadWallet()
    // Subscribe afresh on every attach so the listeners are never doubled and
    // always sit on the provider that is injected now.
    unsubscribe?.()
    unsubscribe = service.subscribe({
      accountsChanged: (data) => {
        accounts.value = Array.isArray(data) ? (data as string[]) : []
        if (accounts.value.length > 0) void recheckNetwork()
        else void setConnectedFlag(false)
      },
      chainChanged: () => void recheckNetwork(),
      nodeChanged: () => void recheckNetwork(),
    })
    accounts.value = await service.getAccounts()
    return service
  }

  /** Connects the wallet. It prompts only when this site holds no grant yet. */
  async function connect() {
    isConnecting.value = true
    error.value = null
    try {
      const service = await attach()
      if (accounts.value.length === 0) {
        await service.connect()
        accounts.value = await service.getAccounts()
      }
      await recheckNetwork()
      await setConnectedFlag(true)
    } catch (err) {
      recordError(err)
    } finally {
      isConnecting.value = false
    }
  }

  /**
   * Restores the session of a browser that connected before. It does nothing
   * without the remembered-connection flag and never prompts.
   */
  async function restore() {
    if (!isAvailable.value) return
    try {
      if (!(await storageService.get<boolean>(STORAGE_KEY_WALLET_CONNECTED))) return
      await attach()
      if (accounts.value.length > 0) await recheckNetwork()
      else await setConnectedFlag(false)
    } catch (err) {
      recordError(err)
    }
  }

  async function disconnect() {
    error.value = null
    try {
      await (await loadWallet()).disconnect()
    } catch (err) {
      recordError(err)
      return
    }
    accounts.value = []
    await setConnectedFlag(false)
  }

  return {
    isAvailable,
    isConnecting,
    isConnected,
    accounts,
    address,
    walletChainId,
    walletNodeUrl,
    mismatch,
    error,
    connect,
    restore,
    disconnect,
    recheckNetwork,
  }
}
