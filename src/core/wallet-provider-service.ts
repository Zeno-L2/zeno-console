import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import { ProviderErrorCode, WalletError, hostOf } from './wallet-provider'
import type {
  NetworkCheck,
  ProviderEventName,
  WalletBlock,
  WalletErrorKind,
  ZenonProvider,
} from './wallet-provider'

const MESSAGES: Record<WalletErrorKind, string> = {
  unavailable: 'No wallet was found in this browser. Install the NoM web wallet and reload.',
  rejected: 'The request was rejected in the wallet.',
  notConnected: 'The wallet is not connected to this site. Connect it first.',
  tooManyRequests: 'The wallet has too many pending requests. Approve or reject them, then try again.',
  invalidParams: 'The wallet refused the request as invalid.',
  sendFailed: 'The wallet could not publish the transaction.',
  unknown: 'The wallet returned an error.',
}

const KIND_BY_CODE: Record<number, WalletErrorKind> = {
  [ProviderErrorCode.UserRejected]: 'rejected',
  [ProviderErrorCode.NotConnected]: 'notConnected',
  [ProviderErrorCode.WalletUnavailable]: 'unavailable',
  [ProviderErrorCode.InvalidParams]: 'invalidParams',
  [ProviderErrorCode.SendFailed]: 'sendFailed',
  [ProviderErrorCode.TooManyRequests]: 'tooManyRequests',
}

/** Maps a provider rejection to a `WalletError`. An error without a code passes through the `unknown` kind. */
export function toWalletError(error: unknown): WalletError {
  if (error instanceof WalletError) return error
  const code = (error as { code?: unknown } | null)?.code
  const detail = (error as { message?: unknown } | null)?.message
  if (typeof code === 'number') {
    const kind = KIND_BY_CODE[code] ?? 'unknown'
    const base = MESSAGES[kind]
    const text = kind === 'sendFailed' || kind === 'invalidParams' || kind === 'unknown'
      ? `${base} ${typeof detail === 'string' ? detail : ''}`.trim()
      : base
    return new WalletError(text, kind, code)
  }
  return new WalletError(error instanceof Error ? error.message : MESSAGES.unknown, 'unknown')
}

/** Converts an SDK send template to the block JSON the wallet accepts. */
export function toWalletBlock(template: AccountBlockTemplate): WalletBlock {
  if (template.blockType !== 2) {
    throw new WalletError('Only send blocks can be requested from the wallet.', 'invalidParams')
  }
  return {
    blockType: 2,
    toAddress: template.toAddress.toString(),
    tokenStandard: template.tokenStandard.toString(),
    amount: String(template.amount),
    data: Buffer.from(template.data).toString('base64'),
  }
}

/**
 * The adapter over `window.zenon`. It wraps the requests, maps the error
 * codes, and sends strictly one request at a time, because the wallet caps
 * pending requests at five and each send's account-block height follows the
 * previous one.
 */
export class WalletProviderService {
  private static instance: WalletProviderService | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly getProvider: () => ZenonProvider | undefined = () => window.zenon) {}

  static getInstance(): WalletProviderService {
    if (!WalletProviderService.instance) {
      WalletProviderService.instance = new WalletProviderService()
    }
    return WalletProviderService.instance
  }

  isAvailable(): boolean {
    return this.getProvider() !== undefined
  }

  private provider(): ZenonProvider {
    const provider = this.getProvider()
    if (!provider) throw new WalletError(MESSAGES.unavailable, 'unavailable', ProviderErrorCode.WalletUnavailable)
    return provider
  }

  private async request<T>(run: (provider: ZenonProvider) => Promise<T>): Promise<T> {
    try {
      return await run(this.provider())
    } catch (error) {
      throw toWalletError(error)
    }
  }

  /** Prompts the user. Resolves with the primary account's address. */
  connect(): Promise<string> {
    return this.request((p) => p.connect())
  }

  disconnect(): Promise<void> {
    return this.request((p) => p.disconnect())
  }

  /** The accounts this site may use. Empty when the wallet is not connected. */
  getAccounts(): Promise<string[]> {
    return this.request((p) => p.getAccounts())
  }

  getChainId(): Promise<number> {
    return this.request((p) => p.getChainId())
  }

  getNodeUrl(): Promise<string> {
    return this.request((p) => p.getNodeUrl())
  }

  /**
   * Asks the wallet to sign and publish `template`. Calls queue, so a
   * second send starts only after the first one resolved or failed.
   * Resolves with the published block as JSON.
   */
  send(template: AccountBlockTemplate): Promise<unknown> {
    const block = toWalletBlock(template)
    const run = this.queue.then(() => this.request((p) => p.sendAccountBlock(block)))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Compares the wallet's chain and node with the app's configuration. */
  async checkNetwork(expected: { chainId: number; nodeUrl: string }): Promise<NetworkCheck> {
    const [chainId, nodeUrl] = await Promise.all([this.getChainId(), this.getNodeUrl()])
    return {
      chainMismatch: chainId !== expected.chainId,
      nodeMismatch: hostOf(nodeUrl) !== hostOf(expected.nodeUrl),
    }
  }

  /** Subscribes to the provider's events. Returns a function that removes the listeners. */
  subscribe(handlers: Partial<Record<ProviderEventName, (data: unknown) => void>>): () => void {
    const provider = this.getProvider()
    if (!provider) return () => undefined
    const entries = Object.entries(handlers) as [ProviderEventName, (data: unknown) => void][]
    for (const [name, handler] of entries) provider.on(name, handler)
    return () => {
      for (const [name, handler] of entries) provider.removeListener(name, handler)
    }
  }
}
