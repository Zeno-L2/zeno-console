import type { ProviderEventName, ZenonProvider } from './wallet-provider'

type Listener = (data: unknown) => void

/**
 * A stand-in for `window.zenon` that follows the real provider's request
 * names and error codes (`nom-webwallet`'s `src/inpage.ts`). Tests set
 * `results` and `failures` per method and read `calls`.
 */
export class StubProvider implements ZenonProvider {
  calls: { method: string; args: unknown[] }[] = []
  results: Record<string, unknown> = {
    connect: 'z1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsggv2f',
    getAccounts: ['z1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsggv2f'],
    getChainId: 1,
    getNodeUrl: 'ws://localhost:35998',
    sendAccountBlock: { hash: 'ab'.repeat(32) },
  }
  failures: Record<string, { code: number; message: string }> = {}
  private listeners = new Map<ProviderEventName, Set<Listener>>()
  /** When set, `sendAccountBlock` waits for these before resolving, in call order. */
  sendGates: (() => void)[] = []
  gateSends = false

  private async handle(method: string, args: unknown[] = []): Promise<unknown> {
    this.calls.push({ method, args })
    const failure = this.failures[method]
    if (failure) throw failure
    return this.results[method]
  }

  connect() {
    return this.handle('connect') as Promise<string>
  }

  disconnect() {
    return this.handle('disconnect') as Promise<void>
  }

  getAccounts() {
    return this.handle('getAccounts') as Promise<string[]>
  }

  getChainId() {
    return this.handle('getChainId') as Promise<number>
  }

  getNodeUrl() {
    return this.handle('getNodeUrl') as Promise<string>
  }

  async sendAccountBlock(block: unknown) {
    const result = this.handle('sendAccountBlock', [block])
    if (this.gateSends) {
      await new Promise<void>((resolve) => this.sendGates.push(resolve))
    }
    return result
  }

  on(event: ProviderEventName, listener: Listener) {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
  }

  removeListener(event: ProviderEventName, listener: Listener) {
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: ProviderEventName, data: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(data)
  }

  listenerCount(event: ProviderEventName) {
    return this.listeners.get(event)?.size ?? 0
  }
}
