import { beforeAll, describe, expect, it } from 'vitest'
import { AccountBlockTemplate, Hash, SETTLEMENT_ADDRESS, Zenon } from 'znn-typescript-sdk'
import { StubProvider } from './stub-provider'
import { ProviderErrorCode, WalletError } from './wallet-provider'
import { WalletProviderService, toWalletBlock, toWalletError } from './wallet-provider-service'

const rejection = async (promise: Promise<unknown>): Promise<WalletError> => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(WalletError)
    return error as WalletError
  }
  throw new Error('expected the call to fail')
}

const sendTemplate = () =>
  Zenon.getInstance().embedded.settlement.callL2(1, Hash.parse('11'.repeat(32)), 1000n, Uint8Array.of(1, 2, 3))

describe('WalletProviderService', () => {
  let stub: StubProvider
  let service: WalletProviderService

  beforeAll(() => {
    Zenon.setChainID(1)
  })

  const setup = () => {
    stub = new StubProvider()
    service = new WalletProviderService(() => stub)
  }

  describe('requests', () => {
    it('connects and reads the accounts, chain id and node url', async () => {
      setup()
      expect(await service.connect()).toBe(stub.results.connect)
      expect(await service.getAccounts()).toEqual(stub.results.getAccounts)
      expect(await service.getChainId()).toBe(1)
      expect(await service.getNodeUrl()).toBe('ws://localhost:35998')
      expect(stub.calls.map((c) => c.method)).toEqual(['connect', 'getAccounts', 'getChainId', 'getNodeUrl'])
    })

    it('reports an unavailable wallet', async () => {
      const none = new WalletProviderService(() => undefined)
      expect(none.isAvailable()).toBe(false)
      const error = await rejection(none.connect())
      expect(error.kind).toBe('unavailable')
      expect(error.code).toBe(ProviderErrorCode.WalletUnavailable)
    })

    it('maps a user rejection (4001)', async () => {
      setup()
      stub.failures.connect = { code: 4001, message: 'User rejected the request.' }
      const error = await rejection(service.connect())
      expect(error.kind).toBe('rejected')
      expect(error.message).toBe('The request was rejected in the wallet.')
    })

    it('maps not connected (4100)', async () => {
      setup()
      stub.failures.getAccounts = { code: 4100, message: 'Not connected.' }
      expect((await rejection(service.getAccounts())).kind).toBe('notConnected')
    })

    it('maps the pending request cap (-32005)', async () => {
      setup()
      stub.failures.sendAccountBlock = { code: -32005, message: 'Too many requests.' }
      const error = await rejection(service.send(sendTemplate()))
      expect(error.kind).toBe('tooManyRequests')
      expect(error.code).toBe(-32005)
    })

    it("keeps the wallet's detail for a failed send (-32603) and invalid params (-32602)", async () => {
      setup()
      stub.failures.sendAccountBlock = { code: -32603, message: 'Node refused the block.' }
      const sent = await rejection(service.send(sendTemplate()))
      expect(sent.kind).toBe('sendFailed')
      expect(sent.message).toContain('Node refused the block.')
      stub.failures.sendAccountBlock = { code: -32602, message: 'Block data must be base64.' }
      const invalid = await rejection(service.send(sendTemplate()))
      expect(invalid.kind).toBe('invalidParams')
      expect(invalid.message).toContain('Block data must be base64.')
    })

    it('maps an unknown code and an error without one', () => {
      expect(toWalletError({ code: 9999, message: 'odd' }).kind).toBe('unknown')
      const plain = toWalletError(new Error('socket closed'))
      expect(plain.kind).toBe('unknown')
      expect(plain.message).toBe('socket closed')
    })
  })

  describe('send', () => {
    it('asks the wallet to publish a block converted from the template', async () => {
      setup()
      const result = await service.send(sendTemplate())
      expect(result).toEqual(stub.results.sendAccountBlock)
      const block = stub.calls[0].args[0] as ReturnType<typeof toWalletBlock>
      expect(block.blockType).toBe(2)
      expect(block.toAddress).toBe(SETTLEMENT_ADDRESS.toString())
      expect(block.amount).toBe('0')
      expect(Buffer.from(block.data, 'base64').length).toBeGreaterThan(4)
    })

    it('rejects a block that is not a send', () => {
      expect(() => toWalletBlock(AccountBlockTemplate.receive(Hash.parse('22'.repeat(32))))).toThrow(WalletError)
    })

    it('sends one request at a time, in order', async () => {
      setup()
      stub.gateSends = true
      const first = service.send(sendTemplate())
      const second = service.send(sendTemplate())
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(stub.calls.filter((c) => c.method === 'sendAccountBlock')).toHaveLength(1)

      stub.sendGates[0]()
      await first
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(stub.calls.filter((c) => c.method === 'sendAccountBlock')).toHaveLength(2)
      stub.sendGates[1]()
      await second
    })

    it('starts the next send after one fails', async () => {
      setup()
      stub.failures.sendAccountBlock = { code: 4001, message: 'rejected' }
      await rejection(service.send(sendTemplate()))
      delete stub.failures.sendAccountBlock
      expect(await service.send(sendTemplate())).toEqual(stub.results.sendAccountBlock)
    })
  })

  describe('network check', () => {
    it('finds no mismatch for the same chain id and node host', async () => {
      setup()
      expect(await service.checkNetwork({ chainId: 1, nodeUrl: 'http://localhost:35997' })).toEqual({
        chainMismatch: false,
        nodeMismatch: false,
      })
    })

    it('flags a different chain id and a different node host', async () => {
      setup()
      stub.results.getChainId = 3
      stub.results.getNodeUrl = 'wss://node.example:35998'
      expect(await service.checkNetwork({ chainId: 1, nodeUrl: 'ws://localhost:35998' })).toEqual({
        chainMismatch: true,
        nodeMismatch: true,
      })
    })
  })

  describe('events', () => {
    it('delivers provider events and stops after unsubscribe', () => {
      setup()
      const seen: unknown[] = []
      const stop = service.subscribe({ accountsChanged: (d) => seen.push(d), chainChanged: (d) => seen.push(d) })
      stub.emit('accountsChanged', ['a'])
      stub.emit('chainChanged', 2)
      stub.emit('nodeChanged', 'x')
      expect(seen).toEqual([['a'], 2])
      stop()
      stub.emit('accountsChanged', ['b'])
      expect(seen).toHaveLength(2)
      expect(stub.listenerCount('accountsChanged')).toBe(0)
    })
  })
})
