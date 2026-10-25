import { WsClient, newClient } from 'znn-typescript-sdk'
import type { Client } from 'znn-typescript-sdk'
import { CONNECT_TIMEOUT_MS } from '@/config'
import { useSettings } from './composables/useSettings'

export interface PlaygroundResponse {
  result?: unknown
  error?: { code: number; message: string }
  elapsedMs: number
}

const SUBSCRIPTIONS = ['zeno_subscribe', 'zeno_unsubscribe']

/** Raw requests to the settings gateway, on a transport of its own. */
export class PlaygroundService {
  private static instance: PlaygroundService | null = null
  private pending: Promise<Client> | null = null

  static getInstance(): PlaygroundService {
    if (!PlaygroundService.instance) {
      PlaygroundService.instance = new PlaygroundService()
    }
    return PlaygroundService.instance
  }

  /** Opens the transport on first use. A failed open does not stick. */
  private open(): Promise<Client> {
    if (!this.pending) {
      const { settings } = useSettings()
      const url = settings.value.gatewayUrl
      const rpc = newClient(url)
      // A WsClient that fails to open reconnects forever, so a failed open stops it.
      const opening: Promise<Client> =
        rpc instanceof WsClient
          ? rpc.initialize(url, CONNECT_TIMEOUT_MS).then(
              () => rpc,
              (err) => {
                rpc.stop()
                throw err
              }
            )
          : Promise.resolve(rpc)
      this.pending = opening
      opening.catch(() => {
        if (this.pending === opening) this.pending = null
      })
    }
    return this.pending
  }

  /**
   * Sends one raw request to the settings gateway. Refuses any method outside
   * zeno_*, and refuses zeno_subscribe and zeno_unsubscribe.
   */
  async send(method: string, params: unknown[]): Promise<PlaygroundResponse> {
    if (!method.startsWith('zeno_')) throw new Error('Only zeno_* methods can be sent to the gateway')
    if (SUBSCRIPTIONS.includes(method)) throw new Error('Subscriptions need a held connection and are not sent here')
    const startedAt = performance.now()
    const rpc = await this.open()
    const elapsed = () => Math.round(performance.now() - startedAt)
    try {
      const result = await rpc.sendRequest(method, params)
      return { result, elapsedMs: elapsed() }
    } catch (err) {
      const { code, message } = err as { code?: unknown; message?: unknown }
      if (typeof code !== 'number') throw err
      return { error: { code, message: typeof message === 'string' ? message : 'gateway error' }, elapsedMs: elapsed() }
    }
  }

  /** Closes the transport. The next send opens a new one. */
  close(): void {
    const closing = this.pending
    this.pending = null
    closing
      ?.then((rpc) => {
        if (rpc instanceof WsClient) rpc.stop()
      })
      .catch(() => undefined)
  }
}
