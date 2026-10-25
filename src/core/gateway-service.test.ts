import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayClient } from 'zeno-client'
import { Hash } from 'znn-typescript-sdk'
import { GatewayService } from './gateway-service'
import { MissingSendError, NodeReadError } from './tx-tracker-service'

const MARKER = { marker: true }
const KNOWN = 'ab'.repeat(32)

function setup(getBatch: () => Promise<unknown> = async () => null) {
  const fakes: { close: ReturnType<typeof vi.fn> }[] = []
  const options: NonNullable<Parameters<typeof GatewayClient.connect>[1]>[] = []
  const send = async (index: number, hash: Hash) => {
    const sends = options[index].sends
    if (!sends) throw new Error('no send source')
    return sends(hash)
  }
  vi.spyOn(GatewayClient, 'connect').mockImplementation(async (_url, opts) => {
    options.push(opts ?? {})
    const fake = { close: vi.fn() }
    fakes.push(fake)
    return fake as never
  })
  const getAccountBlock = vi.fn(async (hash: Hash) => {
    if (hash.toString() === 'ee'.repeat(32)) throw new Error('node down')
    return hash.toString() === KNOWN ? MARKER : null
  })
  const node = { url: 'ws://node-a' }
  const service = new GatewayService({ getBatch, getAccountBlock } as never, () => node.url)
  return { fakes, options, getAccountBlock, service, send, node }
}

describe('GatewayService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads send blocks from the node and throws a typed error for a missing one', async () => {
    const { getAccountBlock, service, send } = setup()
    await service.client()
    const hash = Hash.parse(KNOWN)
    await expect(send(0, hash)).resolves.toBe(MARKER)
    expect(getAccountBlock).toHaveBeenCalledWith(hash)
    await expect(send(0, Hash.parse('cd'.repeat(32)))).rejects.toBeInstanceOf(MissingSendError)
  })

  it('wraps a failed node read in a NodeReadError', async () => {
    const { options, send, service } = setup(async () => {
      throw new Error('node down')
    })
    await service.client()
    await expect(send(0, Hash.parse('ee'.repeat(32)))).rejects.toBeInstanceOf(NodeReadError)
    await expect(options[0].batches?.(1, 0)).rejects.toBeInstanceOf(NodeReadError)
  })

  it('connects again after the node changes and closes the first client', async () => {
    const { fakes, node, service } = setup()
    const first = await service.client()
    expect(await service.client()).toBe(first)
    node.url = 'ws://node-b'
    const second = await service.client()
    expect(second).not.toBe(first)
    expect(fakes).toHaveLength(2)
    await vi.waitFor(() => expect(fakes[0].close).toHaveBeenCalledTimes(1))
    expect(fakes[1].close).not.toHaveBeenCalled()
  })

  it('connects again after the connection reports an error', async () => {
    const { fakes, options, service } = setup()
    const first = await service.client()
    expect(await service.client()).toBe(first)
    expect(fakes).toHaveLength(1)
    options[0].onError?.(new Error('the gateway WebSocket is closed'))
    await vi.waitFor(() => expect(fakes[0].close).toHaveBeenCalledTimes(1))
    expect(await service.client()).toBe(fakes[1])
    expect(fakes).toHaveLength(2)
  })

  it('ignores an error from a connection the URL change already replaced', async () => {
    const { fakes, options, service } = setup()
    await service.client()
    service.configure('http://other.example:1')
    const second = await service.client()
    options[0].onError?.(new Error('the gateway WebSocket is closed'))
    expect(await service.client()).toBe(second)
    expect(fakes).toHaveLength(2)
  })
})
