import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WsClient, newClient } from 'znn-typescript-sdk'
import { useSettings } from './composables/useSettings'
import { PLAYGROUND_METHODS } from './playground-methods'
import { PlaygroundService } from './playground-service'

vi.mock('znn-typescript-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('znn-typescript-sdk')>()),
  newClient: vi.fn(),
}))

const sendRequest = vi.fn()
const service = PlaygroundService.getInstance()

function wsClient() {
  return Object.assign(Object.create(WsClient.prototype), {
    initialize: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    sendRequest,
  })
}

describe('PlaygroundService', () => {
  beforeEach(() => {
    vi.mocked(newClient).mockReset()
    vi.mocked(newClient).mockReturnValue({ sendRequest } as never)
    sendRequest.mockReset()
    sendRequest.mockResolvedValue({ ok: true })
  })
  afterEach(async () => {
    service.close()
    await useSettings().reset()
  })

  it('is a singleton and opens no transport until the first send', async () => {
    expect(PlaygroundService.getInstance()).toBe(service)
    expect(newClient).not.toHaveBeenCalled()
    await service.send('zeno_getHead', [1])
    expect(newClient).toHaveBeenCalledTimes(1)
  })

  it('opens the transport with the settings gateway URL and reuses it', async () => {
    await useSettings().update({ gatewayUrl: 'http://gw.example:1' })
    const first = await service.send('zeno_getHead', [1])
    await service.send('zeno_getBatch', [1, 3])
    expect(newClient).toHaveBeenCalledTimes(1)
    expect(newClient).toHaveBeenCalledWith('http://gw.example:1')
    expect(sendRequest).toHaveBeenNthCalledWith(1, 'zeno_getHead', [1])
    expect(first.result).toEqual({ ok: true })
    expect(first.error).toBeUndefined()
    expect(first.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it.each(['embedded.settlement.getBatch', 'ledger.getFrontierMomentum', 'getHead', '', 'ZENO_getHead'])(
    'refuses %j before any request',
    async (method) => {
      await expect(service.send(method, [])).rejects.toThrow('Only zeno_* methods')
      expect(newClient).not.toHaveBeenCalled()
      expect(sendRequest).not.toHaveBeenCalled()
    }
  )

  it.each(['zeno_subscribe', 'zeno_unsubscribe'])('refuses %s before any request', async (method) => {
    await expect(service.send(method, ['heads', [1]])).rejects.toThrow('Subscriptions')
    expect(newClient).not.toHaveBeenCalled()
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('returns a gateway JSON-RPC error as data', async () => {
    sendRequest.mockRejectedValue({ code: -32001, message: 'unknown domain' })
    const response = await service.send('zeno_getHead', [99])
    expect(response.error).toEqual({ code: -32001, message: 'unknown domain' })
    expect(response.result).toBeUndefined()
  })

  it('rethrows a transport failure that carries no code', async () => {
    sendRequest.mockRejectedValue(new Error('socket closed'))
    await expect(service.send('zeno_getHead', [1])).rejects.toThrow('socket closed')
  })

  it('opens a new transport after close()', async () => {
    await service.send('zeno_getHead', [1])
    service.close()
    await service.send('zeno_getHead', [1])
    expect(newClient).toHaveBeenCalledTimes(2)
  })

  it('does not keep a transport whose open failed', async () => {
    const failing = wsClient()
    failing.initialize.mockRejectedValue(new Error('connect timeout'))
    vi.mocked(newClient).mockReturnValueOnce(failing)
    await expect(service.send('zeno_getHead', [1])).rejects.toThrow('connect timeout')
    await service.send('zeno_getHead', [1])
    expect(newClient).toHaveBeenCalledTimes(2)
  })

  it('stops a WebSocket client whose open failed', async () => {
    const failing = wsClient()
    failing.initialize.mockRejectedValue(new Error('connect timeout'))
    vi.mocked(newClient).mockReturnValueOnce(failing)
    await expect(service.send('zeno_getHead', [1])).rejects.toThrow('connect timeout')
    expect(failing.stop).toHaveBeenCalledTimes(1)
  })

  it('stops a WebSocket client whose open fails after close()', async () => {
    const failing = wsClient()
    let reject: (err: Error) => void = () => undefined
    failing.initialize.mockReturnValue(new Promise((_, r) => (reject = r)))
    vi.mocked(newClient).mockReturnValueOnce(failing)
    const sent = service.send('zeno_getHead', [1])
    const settled = expect(sent).rejects.toThrow('connect timeout')
    service.close()
    reject(new Error('connect timeout'))
    await settled
    expect(failing.stop).toHaveBeenCalledTimes(1)
  })

  it('initializes a WebSocket transport and stops it on close()', async () => {
    const ws = wsClient()
    vi.mocked(newClient).mockReturnValue(ws)
    await useSettings().update({ gatewayUrl: 'ws://gw.example:2' })
    await service.send('zeno_getHead', [1])
    expect(ws.initialize).toHaveBeenCalledWith('ws://gw.example:2', expect.any(Number))
    service.close()
    await vi.waitFor(() => expect(ws.stop).toHaveBeenCalledTimes(1))
  })

  it('does nothing on close() when no transport is open', () => {
    expect(() => service.close()).not.toThrow()
  })
})

describe('PLAYGROUND_METHODS', () => {
  it('lists fourteen zeno_* request methods and no subscription', () => {
    expect(PLAYGROUND_METHODS).toHaveLength(14)
    for (const { method, params } of PLAYGROUND_METHODS) {
      expect(method.startsWith('zeno_')).toBe(true)
      expect(Array.isArray(params)).toBe(true)
    }
    const names = PLAYGROUND_METHODS.map((m) => m.method)
    expect(new Set(names).size).toBe(14)
    expect(names).not.toContain('zeno_subscribe')
    expect(names).not.toContain('zeno_unsubscribe')
  })
})
