import { storageService } from '../storage/storage-service'

/**
 * Composable for accessing the storage service.
 */
export function useStorage() {
  async function get<T>(key: string): Promise<T | null> {
    return storageService.get<T>(key)
  }

  async function set<T>(key: string, value: T): Promise<void> {
    return storageService.set(key, value)
  }

  async function remove(key: string): Promise<void> {
    return storageService.remove(key)
  }

  return { get, set, remove }
}
