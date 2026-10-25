/**
 * Defaults and storage keys shared by the console and the explorer.
 * Prefer importing from here over hardcoding magic values.
 */

// --- Endpoint defaults: a local go-zenon devnet and a local gateway ---
export const DEFAULT_NODE_URL = 'ws://localhost:35998'
export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:35999'
export const DEFAULT_DOMAIN_ID = 1
export const DEFAULT_LOCAL_RUNNER_URL = 'http://127.0.0.1:8547'

// --- Storage keys ---
export const STORAGE_KEY_SELECTED_NODE = 'zeno-selected-node'
export const STORAGE_KEY_CUSTOM_NODES = 'zeno-custom-nodes'
export const STORAGE_KEY_CHAIN_ID = 'zeno-chain-id'
export const STORAGE_KEY_NETWORK_ID = 'zeno-network-id'
export const STORAGE_KEY_SETTINGS = 'zeno-settings'
export const STORAGE_KEY_WALLET_CONNECTED = 'zeno-wallet-connected'
export const STORAGE_KEY_SIDEBAR_COLLAPSED = 'zeno-sidebar-collapsed'

/** Built-in node URLs offered in the network selector. */
export const DEFAULT_NODES: string[] = [DEFAULT_NODE_URL]

/**
 * Websocket connect timeout (ms) for node switches. The SDK defaults to 30s,
 * which leaves the UI hanging that long on an unreachable node before reporting
 * failure.
 */
export const CONNECT_TIMEOUT_MS = 8000

// --- Momentum / block timing ---
/** Target time between momentums, in seconds. */
export const BLOCK_TIME_SECONDS = 10

// --- Pagination ---
export const DEFAULT_PAGE_SIZE = 25

// --- Tokens ---
/** Decimals shared by ZNN and QSR. */
export const ZNN_QSR_DECIMALS = 8
