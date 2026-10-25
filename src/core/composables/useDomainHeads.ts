import { effectScope, ref, watch } from 'vue'
import { UnknownDomainError } from 'zeno-client'
import type { Head } from 'zeno-client'
import { BLOCK_TIME_SECONDS } from '@/config'
import { GatewayService } from '../gateway-service'
import { useSettings } from './useSettings'

// Module-level reactive state, shared across every useDomainHeads() caller
const heads = ref<Record<number, Head>>({})
const errors = ref<Record<number, string>>({})

interface Loop {
  followers: number
  /** Identifies the running poll chain, so an older chain stops when a newer one starts. */
  run: symbol
  timer: ReturnType<typeof setTimeout> | null
}

const loops = new Map<number, Loop>()
// Bumped on each gateway URL change. A getHead that started under an older one writes nothing.
let generation = 0
let watching = false

type Outcome = 'ok' | 'error' | 'ended' | 'stale'

function setError(domainId: number, message: string) {
  errors.value = { ...errors.value, [domainId]: message }
}

async function read(domainId: number): Promise<Outcome> {
  const started = generation
  try {
    const head = await GatewayService.getInstance().getHead(domainId)
    if (started !== generation) return 'stale'
    heads.value = { ...heads.value, [domainId]: head }
    const rest = { ...errors.value }
    delete rest[domainId]
    errors.value = rest
    return 'ok'
  } catch (err) {
    if (started !== generation) return 'stale'
    if (err instanceof UnknownDomainError) {
      setError(domainId, `This gateway does not serve domain ${domainId}`)
      return 'ended'
    }
    setError(domainId, err instanceof Error ? err.message : 'The gateway could not be reached')
    return 'error'
  }
}

function start(domainId: number, loop: Loop) {
  const run = Symbol('heads')
  loop.run = run
  const tick = async () => {
    loop.timer = null
    const outcome = await read(domainId)
    if (loop.run !== run || outcome === 'stale' || outcome === 'ended') return
    loop.timer = setTimeout(tick, BLOCK_TIME_SECONDS * 1000)
  }
  tick()
}

function halt(loop: Loop) {
  loop.run = Symbol('stopped')
  if (loop.timer !== null) clearTimeout(loop.timer)
  loop.timer = null
}

/** Heads keyed by domain, kept current by a poll of `getHead` for each followed domain. */
export function useDomainHeads() {
  const { settings } = useSettings()

  if (!watching) {
    watching = true
    // A detached scope keeps the watch alive after its first caller unmounts.
    effectScope(true).run(() => {
      watch(
        () => settings.value.gatewayUrl,
        (url) => {
          // configure returns early for an unchanged URL, so the order against useGateway's watch is free.
          GatewayService.getInstance().configure(url)
          generation++
          heads.value = {}
          errors.value = {}
          for (const [domainId, loop] of loops) {
            halt(loop)
            start(domainId, loop)
          }
        }
      )
    })
  }

  /** One getHead for `domainId`. */
  async function load(domainId: number): Promise<void> {
    await read(domainId)
  }

  /**
   * Polls getHead for `domainId` every BLOCK_TIME_SECONDS until the returned
   * stop function runs. The poll is shared and reference-counted per domain.
   */
  function follow(domainId: number): () => void {
    let loop = loops.get(domainId)
    if (!loop) {
      loop = { followers: 0, run: Symbol('idle'), timer: null }
      loops.set(domainId, loop)
      start(domainId, loop)
    }
    loop.followers++
    const joined = loop
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      joined.followers--
      if (joined.followers === 0) {
        halt(joined)
        loops.delete(domainId)
      }
    }
  }

  return { heads, errors, load, follow }
}
