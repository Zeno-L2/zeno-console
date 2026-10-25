import type { WalletProviderService } from './wallet-provider-service'

let loading: Promise<WalletProviderService> | null = null

/** Loads the wallet adapter on first use, so a visitor who never connects never downloads it. */
export function loadWallet(): Promise<WalletProviderService> {
  loading ??= import('./wallet-provider-service')
    .then((m) => m.WalletProviderService.getInstance())
    .catch((err) => {
      loading = null
      throw err
    })
  return loading
}

/** The `send` dependency of the write services, through the lazily loaded adapter. */
export const lazyWallet: Pick<WalletProviderService, 'send'> = {
  send: async (template) => (await loadWallet()).send(template),
}
