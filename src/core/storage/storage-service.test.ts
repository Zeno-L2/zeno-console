import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageService } from './storage-service'

describe('storageService', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips a JSON value and removes it', async () => {
    await storageService.set('k', { a: [1, 2] })
    expect(await storageService.get('k')).toEqual({ a: [1, 2] })
    await storageService.remove('k')
    expect(await storageService.get('k')).toBeNull()
  })

  it('returns null for a missing key', async () => {
    expect(await storageService.get('missing')).toBeNull()
  })

  it('does not throw when storage fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await expect(storageService.set('k', 1)).resolves.toBeUndefined()
  })
})
