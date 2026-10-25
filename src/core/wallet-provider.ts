/**
 * The browser wallet's injected provider. `nom-webwallet` defines
 * `window.zenon` at document_start; its requests travel as the `znn_*`
 * family (`znn_connect`, `znn_accounts`, `znn_signAndSendBlock`, ...).
 * This file only types what the console calls. It holds no key material.
 */

export type ProviderEventName = 'accountsChanged' | 'chainChanged' | 'nodeChanged'

export interface ZenonProvider {
  /** Prompts the user to connect. Resolves with the primary account's address. */
  connect(): Promise<string>
  disconnect(): Promise<void>
  getAccounts(): Promise<string[]>
  getChainId(): Promise<number>
  getNodeUrl(): Promise<string>
  /** Signs and publishes one block. Resolves with the published block as JSON. */
  sendAccountBlock(block: unknown): Promise<unknown>
  on(event: ProviderEventName, listener: (data: unknown) => void): void
  removeListener(event: ProviderEventName, listener: (data: unknown) => void): void
}

declare global {
  interface Window {
    zenon?: ZenonProvider
  }
}

/** The wallet's EIP-1193 style error codes. */
export const ProviderErrorCode = {
  UserRejected: 4001,
  NotConnected: 4100,
  UnknownMethod: 4200,
  WalletUnavailable: 4900,
  InvalidParams: -32602,
  SendFailed: -32603,
  TooManyRequests: -32005,
} as const

/** A send block as the wallet accepts it: `data` is base64 and `amount` a decimal string. */
export interface WalletBlock {
  blockType: 2
  toAddress: string
  tokenStandard: string
  amount: string
  data: string
}

export type WalletErrorKind =
  | 'unavailable'
  | 'rejected'
  | 'notConnected'
  | 'tooManyRequests'
  | 'invalidParams'
  | 'sendFailed'
  | 'unknown'

/** A wallet failure with the reason named, so the UI says what to do. */
export class WalletError extends Error {
  constructor(
    message: string,
    readonly kind: WalletErrorKind,
    readonly code?: number
  ) {
    super(message)
    this.name = 'WalletError'
  }
}

export interface NetworkCheck {
  /** The wallet signs for a different chain id than the app is configured for. */
  chainMismatch: boolean
  /** The wallet is on a different node host than the app. */
  nodeMismatch: boolean
}

// Only the host is compared: the wallet may reach the same node over http
// while the console uses its websocket port.
export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
