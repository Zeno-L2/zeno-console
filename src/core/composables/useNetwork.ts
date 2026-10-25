import { ref } from 'vue'
import { ZenonService } from '../zenon-service'
import {
  DEFAULT_NODE_URL,
  STORAGE_KEY_CHAIN_ID,
  STORAGE_KEY_NETWORK_ID,
  STORAGE_KEY_SELECTED_NODE,
} from '../../config'
import { storageService } from '../storage/storage-service'

// Module-level reactive state, shared across every useNetwork() caller
const isConnected = ref(false)
const currentNode = ref(DEFAULT_NODE_URL)
const isChecking = ref(false)
const error = ref<string | null>(null)
const currentMomentum = ref<number>(0)
const chainId = ref<number>(1)
const networkId = ref<number>(1)
// True once chainId, networkId and currentNode hold the persisted values
const isInitialized = ref(false)

export function useNetwork() {
  const zenonService = ZenonService.getInstance()

  // Verify connection by making a real API call
  async function checkConnection() {
    isChecking.value = true
    error.value = null

    try {
      await zenonService.ensureInitialized()
      const momentum = await zenonService.getZenon().ledger.getFrontierMomentum()
      currentMomentum.value = momentum.height
      isConnected.value = true
    } catch (err) {
      isConnected.value = false
      error.value = err instanceof Error ? err.message : 'Connection failed'
      console.error('Failed to check connection:', err)
    } finally {
      isChecking.value = false
    }
  }

  // Change node and persist
  async function changeNode(nodeUrl: string) {
    isChecking.value = true
    error.value = null

    const previousNode = currentNode.value
    try {
      currentNode.value = nodeUrl
      await zenonService.changeNode(nodeUrl)
      await checkConnection()
      if (!isConnected.value) {
        // checkConnection() swallows its error but records the reason in
        // error.value, so surface it for the caller to report the failure.
        throw new Error(error.value ?? 'Failed to connect to node')
      }
      // Persist only after the node is proven reachable, so a node that can't
      // connect is never stored and reapplied on next boot.
      await storageService.set(STORAGE_KEY_SELECTED_NODE, nodeUrl)
    } catch (err) {
      currentNode.value = previousNode
      isConnected.value = false
      error.value = err instanceof Error ? err.message : 'Failed to change node'
      // The service may have connected to the new (unverified) node before the
      // verification call failed. Restore the previous node so the service and UI
      // don't disagree, and so the next operation doesn't silently reuse the bad
      // node. Best-effort: never mask the original failure.
      if (zenonService.getNodeUrl() !== previousNode) {
        try {
          await zenonService.changeNode(previousNode)
          isConnected.value = zenonService.isConnected()
        } catch {
          // ignore: surfacing the original error is what matters
        }
      }
      throw err
    } finally {
      isChecking.value = false
    }
  }

  // Persist chain/network IDs, then apply them to the SDK and reactive state.
  // Writing first means a failed save (which rejects to the caller) never leaves
  // the live session on un-persisted IDs that would silently revert on reboot.
  async function updateNetworkConfig(newChainId: number, newNetworkId: number) {
    await Promise.all([
      storageService.set(STORAGE_KEY_CHAIN_ID, newChainId),
      storageService.set(STORAGE_KEY_NETWORK_ID, newNetworkId),
    ])
    ZenonService.updateNetworkConfig(newChainId, newNetworkId)
    chainId.value = newChainId
    networkId.value = newNetworkId
  }

  // Load frontier momentum
  async function loadFrontierMomentum() {
    try {
      await zenonService.ensureInitialized()
      const momentum = await zenonService.getZenon().ledger.getFrontierMomentum()
      currentMomentum.value = momentum.height
    } catch (err) {
      console.error('Failed to load frontier momentum:', err)
    }
  }

  // Initialize network (call on app mount).
  //
  // ZenonService resolves the persisted node + network config from storage
  // before opening its first connection (see applyPersistedConfig), so any data
  // load that races us still connects straight to the saved node, with no
  // default-node round-trip. Here we just trigger the connection and mirror the
  // resolved values into reactive state for the UI.
  async function initialize() {
    await checkConnection()
    currentNode.value = zenonService.getNodeUrl()
    chainId.value = zenonService.getChainId()
    networkId.value = zenonService.getNetworkId()
    isInitialized.value = true
  }

  return {
    // State
    isConnected,
    currentNode,
    isChecking,
    error,
    currentMomentum,
    chainId,
    networkId,
    isInitialized,

    // Methods
    checkConnection,
    changeNode,
    updateNetworkConfig,
    initialize,
    loadFrontierMomentum,
  }
}
