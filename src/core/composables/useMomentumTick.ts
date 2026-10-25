import { onScopeDispose } from 'vue'
import { BLOCK_TIME_SECONDS } from '@/config'
import { useNetwork } from './useNetwork'

const listeners = new Set<(height: number) => void>()
let timer: ReturnType<typeof setInterval> | null = null
let lastHeight = 0

async function poll() {
  const network = useNetwork()
  await network.loadFrontierMomentum()
  const height = network.currentMomentum.value
  const rose = lastHeight > 0 && height > lastHeight
  lastHeight = height
  if (rose) for (const listener of [...listeners]) listener(height)
}

/**
 * Calls `onTick` with the new frontier height whenever it rises. One shared
 * poll of the frontier momentum runs every BLOCK_TIME_SECONDS while any caller
 * is mounted.
 */
export function useMomentumTick(onTick: (height: number) => void): void {
  listeners.add(onTick)
  if (timer === null) {
    lastHeight = useNetwork().currentMomentum.value
    timer = setInterval(poll, BLOCK_TIME_SECONDS * 1000)
    poll()
  }
  onScopeDispose(() => {
    listeners.delete(onTick)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  })
}
