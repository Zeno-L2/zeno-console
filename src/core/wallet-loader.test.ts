import { afterEach, describe, expect, it, vi } from 'vitest'

describe('loadWallet', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('./wallet-provider-service')
  })

  it('resolves one shared adapter instance', async () => {
    const { loadWallet } = await import('./wallet-loader')
    const a = await loadWallet()
    expect(await loadWallet()).toBe(a)
  })

  it('can be retried after the adapter import fails', async () => {
    let attempts = 0
    vi.doMock('./wallet-provider-service', () => {
      attempts += 1
      if (attempts === 1) throw new Error('chunk failed')
      return { WalletProviderService: { getInstance: () => ({ id: 'adapter' }) } }
    })
    const { loadWallet } = await import('./wallet-loader')
    await expect(loadWallet()).rejects.toThrow()
    await expect(loadWallet()).resolves.toEqual({ id: 'adapter' })
  })
})
