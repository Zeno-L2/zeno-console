import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { StubProvider } from '../stub-provider'
import { STORAGE_KEY_WALLET_CONNECTED } from '../../config'
import { storageService } from '../storage/storage-service'
import { useNetwork } from './useNetwork'
import { useWalletProvider } from './useWalletProvider'

const ACCOUNT = 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'

describe('useWalletProvider', () => {
  let stub: StubProvider

  beforeEach(async () => {
    stub = new StubProvider()
    window.zenon = stub
    // The console has loaded its persisted network settings.
    const network = useNetwork()
    network.chainId.value = 1
    network.currentNode.value = 'ws://localhost:35998'
    network.isInitialized.value = true
    // The wallet starts disconnected: no accounts until the user connects.
    stub.results.getAccounts = []
    await useWalletProvider().connect()
    localStorage.clear()
    stub.calls = []
  })

  afterEach(async () => {
    const w = useWalletProvider()
    stub.results.getAccounts = []
    await w.disconnect()
    delete window.zenon
    useNetwork().isInitialized.value = false
  })

  it('reads a disconnected wallet without prompting', () => {
    const w = useWalletProvider()
    expect(w.isAvailable.value).toBe(true)
    expect(w.isConnected.value).toBe(false)
    expect(w.address.value).toBeNull()
    expect(stub.calls.map((c) => c.method)).not.toContain('connect')
  })

  it('connects and exposes the primary address', async () => {
    const w = useWalletProvider()
    stub.results.getAccounts = ['z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp', 'z1other']
    await w.connect()
    expect(w.isConnected.value).toBe(true)
    expect(w.address.value).toBe('z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp')
    expect(w.isConnecting.value).toBe(false)
    expect(w.mismatch.value).toEqual({ chainMismatch: false, nodeMismatch: false })
  })

  it('records the reason when the user rejects the connection', async () => {
    const w = useWalletProvider()
    stub.failures.connect = { code: 4001, message: 'User rejected the request.' }
    await w.connect()
    expect(w.isConnected.value).toBe(false)
    expect(w.error.value).toBe('The request was rejected in the wallet.')
    expect(w.isConnecting.value).toBe(false)
  })

  it('flags a wallet on another chain', async () => {
    const w = useWalletProvider()
    stub.results.getAccounts = ['z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp']
    stub.results.getChainId = 9
    await w.connect()
    expect(w.mismatch.value.chainMismatch).toBe(true)
    expect(w.walletChainId.value).toBe(9)
  })

  it('follows account and chain events from the wallet', async () => {
    const w = useWalletProvider()
    stub.results.getAccounts = ['z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp']
    await w.connect()
    expect(w.mismatch.value.chainMismatch).toBe(false)

    stub.results.getChainId = 4
    stub.emit('chainChanged', 4)
    await flushPromises()
    expect(w.mismatch.value.chainMismatch).toBe(true)

    stub.emit('accountsChanged', [])
    await flushPromises()
    expect(w.isConnected.value).toBe(false)
    expect(w.mismatch.value).toEqual({ chainMismatch: false, nodeMismatch: false })
  })

  it('clears the account on disconnect', async () => {
    const w = useWalletProvider()
    stub.results.getAccounts = ['z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp']
    await w.connect()
    await w.disconnect()
    expect(w.isConnected.value).toBe(false)
    expect(stub.calls.map((c) => c.method)).toContain('disconnect')
  })

  describe('before the console has loaded its network settings', () => {
    beforeEach(() => {
      const network = useNetwork()
      network.isInitialized.value = false
      network.chainId.value = 1
      network.currentNode.value = 'wss://placeholder.example:35998'
    })

    it('reports no mismatch while the console still holds placeholder values', async () => {
      const w = useWalletProvider()
      const network = useNetwork()
      stub.results.getAccounts = [ACCOUNT]
      stub.results.getChainId = 69
      stub.results.getNodeUrl = 'ws://localhost:35998'
      await w.connect()
      expect(w.walletChainId.value).toBe(69)
      expect(w.mismatch.value).toEqual({ chainMismatch: false, nodeMismatch: false })

      network.chainId.value = 69
      network.currentNode.value = 'ws://localhost:35998'
      network.isInitialized.value = true
      expect(w.mismatch.value).toEqual({ chainMismatch: false, nodeMismatch: false })
    })

    it('reports a chain mismatch once the loaded values differ from the wallet', async () => {
      const w = useWalletProvider()
      const network = useNetwork()
      stub.results.getAccounts = [ACCOUNT]
      stub.results.getChainId = 69
      await w.connect()

      network.chainId.value = 7
      network.isInitialized.value = true
      expect(w.mismatch.value.chainMismatch).toBe(true)
    })

    it('reports a node mismatch once the loaded node differs from the wallet', async () => {
      const w = useWalletProvider()
      const network = useNetwork()
      stub.results.getAccounts = [ACCOUNT]
      stub.results.getNodeUrl = 'wss://wallet.example:35998'
      await w.connect()

      network.currentNode.value = 'wss://console.example:35998'
      network.isInitialized.value = true
      expect(w.mismatch.value.nodeMismatch).toBe(true)

      network.currentNode.value = 'ws://wallet.example:1234'
      expect(w.mismatch.value.nodeMismatch).toBe(false)
    })
  })

  it('follows a change of the console network after the wallet is read', async () => {
    const w = useWalletProvider()
    const network = useNetwork()
    stub.results.getAccounts = [ACCOUNT]
    await w.connect()
    expect(w.mismatch.value.chainMismatch).toBe(false)

    network.chainId.value = 5
    expect(w.mismatch.value.chainMismatch).toBe(true)
    network.chainId.value = 1
    expect(w.mismatch.value.chainMismatch).toBe(false)
  })

  const methods = () => stub.calls.map((c) => c.method)
  const flag = () => storageService.get<boolean>(STORAGE_KEY_WALLET_CONNECTED)

  it('connects without a prompt when the origin already holds a grant', async () => {
    stub.results.getAccounts = [ACCOUNT]
    await useWalletProvider().connect()
    expect(methods()).not.toContain('connect')
    expect(useWalletProvider().isConnected.value).toBe(true)
  })

  it('prompts when the origin holds no grant', async () => {
    await useWalletProvider().connect()
    expect(methods()).toContain('connect')
  })

  it('sets the flag on connect and clears it on disconnect', async () => {
    stub.results.getAccounts = [ACCOUNT]
    const w = useWalletProvider()
    await w.connect()
    expect(await flag()).toBe(true)
    await w.disconnect()
    expect(await flag()).toBeNull()
  })

  it('restore makes no provider call without the flag', async () => {
    stub.results.getAccounts = [ACCOUNT]
    await useWalletProvider().restore()
    expect(stub.calls).toEqual([])
    expect(useWalletProvider().isConnected.value).toBe(false)
  })

  it('restore with the flag and a granted origin connects without a prompt', async () => {
    await storageService.set(STORAGE_KEY_WALLET_CONNECTED, true)
    stub.results.getAccounts = [ACCOUNT]
    await useWalletProvider().restore()
    expect(methods()).not.toContain('connect')
    expect(useWalletProvider().address.value).toBe(ACCOUNT)
  })

  it('restore with the flag and no accounts clears the flag without a prompt', async () => {
    await storageService.set(STORAGE_KEY_WALLET_CONNECTED, true)
    await useWalletProvider().restore()
    expect(methods()).not.toContain('connect')
    expect(await flag()).toBeNull()
    expect(useWalletProvider().isConnected.value).toBe(false)
  })

  it('clears the flag when the wallet reports no accounts', async () => {
    stub.results.getAccounts = [ACCOUNT]
    await useWalletProvider().connect()
    stub.emit('accountsChanged', [])
    await flushPromises()
    expect(await flag()).toBeNull()
  })

  it('restore with the flag never prompts when reading the accounts fails', async () => {
    await storageService.set(STORAGE_KEY_WALLET_CONNECTED, true)
    stub.failures.getAccounts = { code: 4900, message: 'wallet unavailable' }
    await useWalletProvider().restore()
    expect(methods()).not.toContain('connect')
    expect(useWalletProvider().isConnected.value).toBe(false)
  })

  it('restore with the flag and no wallet installed does nothing', async () => {
    await storageService.set(STORAGE_KEY_WALLET_CONNECTED, true)
    delete window.zenon
    await useWalletProvider().restore()
    expect(useWalletProvider().isConnected.value).toBe(false)
    expect(stub.calls).toEqual([])
  })
})
