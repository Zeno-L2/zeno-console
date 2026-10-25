import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { BLOCK_TIME_SECONDS } from '@/config'
import { ZenonService } from '../zenon-service'
import { useMomentumTick } from './useMomentumTick'

const INTERVAL = BLOCK_TIME_SECONDS * 1000

let height = 100
let getFrontierMomentum: ReturnType<typeof vi.fn>

describe('useMomentumTick', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    height = 100
    getFrontierMomentum = vi.fn(async () => ({ height }))
    vi.spyOn(ZenonService, 'getInstance').mockReturnValue({
      ensureInitialized: async () => undefined,
      getZenon: () => ({ ledger: { getFrontierMomentum } }),
    } as never)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('treats the first height as a baseline and calls back only when it rises', async () => {
    const onTick = vi.fn()
    const scope = effectScope()
    scope.run(() => useMomentumTick(onTick))
    await vi.advanceTimersByTimeAsync(0)
    expect(onTick).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(onTick).not.toHaveBeenCalled()

    height = 101
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(onTick).toHaveBeenCalledTimes(1)
    expect(onTick).toHaveBeenCalledWith(101)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(onTick).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('runs one shared poll for several callers and stops after the last one is disposed', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const a = effectScope()
    const b = effectScope()
    a.run(() => useMomentumTick(first))
    b.run(() => useMomentumTick(second))
    await vi.advanceTimersByTimeAsync(0)
    expect(getFrontierMomentum).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(getFrontierMomentum).toHaveBeenCalledTimes(2)

    height = 105
    a.stop()
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(105)
    expect(getFrontierMomentum).toHaveBeenCalledTimes(3)

    b.stop()
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(getFrontierMomentum).toHaveBeenCalledTimes(3)
  })
})
