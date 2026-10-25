import type { StorageAdapter } from '../../types'

/**
 * localStorage-backed storage service. These apps are plain static web
 * pages (never packaged as a browser extension), so there's no chrome.storage
 * adapter to select between: just localStorage, wrapped so private/incognito
 * mode's occasional setItem throw doesn't break callers.
 */
class StorageService implements StorageAdapter {
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = localStorage.getItem(key)
      return value ? (JSON.parse(value) as T) : null
    } catch (error) {
      console.warn(`Failed to read storage key "${key}":`, error)
      return null
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      console.warn(`Failed to write storage key "${key}":`, error)
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.warn(`Failed to remove storage key "${key}":`, error)
    }
  }
}

// Export a singleton instance
export const storageService = new StorageService()
