import { ref } from 'vue'
import { DEFAULT_DOMAIN_ID, DEFAULT_GATEWAY_URL, DEFAULT_LOCAL_RUNNER_URL, STORAGE_KEY_SETTINGS } from '../../config'
import { storageService } from '../storage/storage-service'

export interface Settings {
  /** The gateway's JSON-RPC endpoint (HTTP or WebSocket). */
  gatewayUrl: string
  /** The Settlement domain the apps work in. */
  domainId: number
  /** Base URL of `zeno-exec serve`, for the deploy page's test panel. */
  localRunnerUrl: string
  /** The network administrator's address, for the console's admin area. */
  adminAddress: string
}

export const DEFAULT_SETTINGS: Settings = {
  gatewayUrl: DEFAULT_GATEWAY_URL,
  domainId: DEFAULT_DOMAIN_ID,
  localRunnerUrl: DEFAULT_LOCAL_RUNNER_URL,
  adminAddress: '',
}

// Module-level reactive state, shared across every useSettings() caller
const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
const isLoaded = ref(false)

export function useSettings() {
  async function load() {
    const stored = await storageService.get<Partial<Settings>>(STORAGE_KEY_SETTINGS)
    settings.value = { ...DEFAULT_SETTINGS, ...stored }
    isLoaded.value = true
  }

  /** Merges `patch` into the settings and persists them. */
  async function update(patch: Partial<Settings>) {
    settings.value = { ...settings.value, ...patch }
    await storageService.set(STORAGE_KEY_SETTINGS, settings.value)
  }

  async function reset() {
    settings.value = { ...DEFAULT_SETTINGS }
    await storageService.remove(STORAGE_KEY_SETTINGS)
  }

  return { settings, isLoaded, load, update, reset }
}
