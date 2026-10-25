import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { UnknownDomainError } from 'zeno-client'
import { BLOCK_TIME_SECONDS } from '@/config'
import { GatewayService } from '../gateway-service'
import { useSettings } from './useSettings'
import { result } from '../../../test/replay-client'
import { useDomainHeads } from './useDomainHeads'

const INTERVAL = BLOCK_TIME_SECONDS * 1000
const head = (extra: Record<string, unknown> = {}) => ({ ...result('getHead'), ...extra })

let service: GatewayService
let getHead: ReturnType<typeof vi.fn>
const stops: Array<() => void> = []

function follow(domainId: number) {
  const stop = useDomainHeads().follow(domainId)
  stops.push(stop)
  return stop
}

/** Stands in for the connected client. It tags each head with the URL the service held at call time. */
function useClient(impl?: (domainId: number, url: string) => Promise<unknown>) {
  getHead = vi.fn(async (domainId: number) =>
    impl ? impl(domainId, service.getUrl()) : head({ url: service.getUrl() })
  )
  vi.spyOn(service, 'client').mockResolvedValue({ getHead } as never)
}

describe('useDomainHeads', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    service = new GatewayService({ getBatch: async () => null } as never)
    vi.spyOn(GatewayService, 'getInstance').mockReturnValue(service)
  })

  afterEach(async () => {
    while (stops.length) stops.pop()?.()
    vi.useRealTimers()
    vi.restoreAllMocks()
    const { heads, errors } = useDomainHeads()
    heads.value = {}
    errors.value = {}
  })

  it('reads at once and then every BLOCK_TIME_SECONDS', async () => {
    useClient()
    const { heads } = useDomainHeads()
    follow(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(getHead).toHaveBeenCalledTimes(1)
    expect(heads.value[1]).toBeDefined()

    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(getHead).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(getHead).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(getHead).toHaveBeenCalledTimes(3)
  })

  it('shares one loop between two followers and stops after the last stop()', async () => {
    useClient()
    const stopA = follow(1)
    const stopB = follow(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(getHead).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(getHead).toHaveBeenCalledTimes(2)

    stopA()
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(getHead).toHaveBeenCalledTimes(3)

    stopA() // a repeated stop() does not release another follower
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(getHead).toHaveBeenCalledTimes(4)

    stopB()
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(getHead).toHaveBeenCalledTimes(4)
  })

  it('polls each followed domain on its own loop', async () => {
    useClient()
    follow(1)
    follow(2)
    await vi.advanceTimersByTimeAsync(0)
    expect(getHead.mock.calls.map(([id]) => id).sort()).toEqual([1, 2])
  })

  it('writes the error and keeps polling after a transport error, then clears it on success', async () => {
    let fail = true
    useClient(async () => {
      if (fail) throw new Error('connection refused')
      return head()
    })
    const { heads, errors } = useDomainHeads()
    follow(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(errors.value[1]).toBe('connection refused')
    expect(heads.value[1]).toBeUndefined()

    fail = false
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(errors.value[1]).toBeUndefined()
    expect(heads.value[1]).toBeDefined()
  })

  it('ends the domain loop after UnknownDomainError', async () => {
    useClient(async () => {
      throw new UnknownDomainError('zeno_getHead', { code: -32001, message: 'unknown domain' } as never)
    })
    const { errors } = useDomainHeads()
    follow(99)
    await vi.advanceTimersByTimeAsync(0)
    expect(errors.value[99]).toBe('This gateway does not serve domain 99')
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(getHead).toHaveBeenCalledTimes(1)
  })

  it('lets a head whose only change is INCONSISTENT reach heads', async () => {
    let status = 'OK'
    useClient(async () => head({ status }))
    const { heads } = useDomainHeads()
    follow(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(heads.value[1].status).toBe('OK')
    status = 'INCONSISTENT'
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(heads.value[1].status).toBe('INCONSISTENT')
  })

  it('load() reads one head with the same writes', async () => {
    useClient()
    const { heads, load } = useDomainHeads()
    await load(1)
    expect(getHead).toHaveBeenCalledTimes(1)
    expect(heads.value[1]).toBeDefined()
  })

  describe('after a gateway URL change', () => {
    afterEach(async () => {
      await useSettings().reset()
      await nextTick()
    })

    it('restarts the loop against the new URL, with no useGateway() caller', async () => {
      useClient()
      const { heads, errors } = useDomainHeads()
      follow(1)
      await vi.advanceTimersByTimeAsync(0)
      expect((heads.value[1] as never as { url: string }).url).toBe(service.getUrl())
      const before = service.getUrl()

      await useSettings().update({ gatewayUrl: 'http://new-gateway.example:1' })
      await vi.advanceTimersByTimeAsync(0)

      expect(service.getUrl()).toBe('http://new-gateway.example:1')
      expect(service.getUrl()).not.toBe(before)
      expect((heads.value[1] as never as { url: string }).url).toBe('http://new-gateway.example:1')
      expect(errors.value).toEqual({})
    })

    it('clears heads and errors at once', async () => {
      useClient(async () => new Promise(() => undefined))
      const { heads, errors } = useDomainHeads()
      heads.value = { 1: head() as never }
      errors.value = { 2: 'old error' }
      follow(1)
      await useSettings().update({ gatewayUrl: 'http://cleared.example:1' })
      await vi.advanceTimersByTimeAsync(0)
      expect(heads.value).toEqual({})
      expect(errors.value).toEqual({})
    })

    it('restarts the loop of a domain whose loop had ended', async () => {
      let known = false
      useClient(async (_domainId, url) => {
        if (!known) throw new UnknownDomainError('zeno_getHead', { code: -32001, message: 'unknown' } as never)
        return head({ url })
      })
      const { heads, errors } = useDomainHeads()
      follow(7)
      await vi.advanceTimersByTimeAsync(0)
      expect(errors.value[7]).toContain('does not serve domain 7')

      known = true
      await useSettings().update({ gatewayUrl: 'http://restart.example:1' })
      await vi.advanceTimersByTimeAsync(0)
      expect(heads.value[7]).toBeDefined()
      expect(errors.value[7]).toBeUndefined()
    })

    it('writes nothing from a getHead that started before the change', async () => {
      let releaseStale: (value: unknown) => void = () => undefined
      let calls = 0
      useClient(async (_domainId, url) => {
        calls++
        if (calls === 1) return new Promise((resolve) => (releaseStale = resolve))
        return head({ url })
      })
      const { heads, errors } = useDomainHeads()
      follow(1)
      await vi.advanceTimersByTimeAsync(0)

      await useSettings().update({ gatewayUrl: 'http://fresh.example:1' })
      await vi.advanceTimersByTimeAsync(0)
      expect((heads.value[1] as never as { url: string }).url).toBe('http://fresh.example:1')

      releaseStale(head({ url: 'stale' }))
      await vi.advanceTimersByTimeAsync(0)
      expect((heads.value[1] as never as { url: string }).url).toBe('http://fresh.example:1')
      expect(errors.value).toEqual({})
    })

    it('writes no error from a failed getHead that started before the change', async () => {
      let rejectStale: (reason: unknown) => void = () => undefined
      let calls = 0
      useClient(async (_domainId, url) => {
        calls++
        if (calls === 1) return new Promise((_, reject) => (rejectStale = reject))
        return head({ url })
      })
      const { errors } = useDomainHeads()
      follow(1)
      await vi.advanceTimersByTimeAsync(0)
      await useSettings().update({ gatewayUrl: 'http://fresh2.example:1' })
      await vi.advanceTimersByTimeAsync(0)
      rejectStale(new Error('old gateway down'))
      await vi.advanceTimersByTimeAsync(0)
      expect(errors.value).toEqual({})
    })
  })
})
