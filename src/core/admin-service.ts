import { settlement } from 'znn-typescript-sdk'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import { BLOCK_TIME_SECONDS } from '../config'
import { storageService } from './storage/storage-service'
import type { StorageAdapter } from '../types/index'
import { hashOf } from './admin-actions'
import type { AdminAction, Hashed } from './admin-actions'
import { SettlementWriteService } from './settlement-write-service'
import type { WalletProviderService } from './wallet-provider-service'
import { SettlementService } from './settlement-service'
import { lazyWallet } from './wallet-loader'
import { liveLedger } from './tracker-ledger'
import type { TrackerLedger } from './tx-tracker-service'

export const STORAGE_KEY_ADMIN_PROPOSALS = 'zeno-admin-proposals'

/** What the browser remembers of a proposal: the typed values, since the chain keeps only their hash. */
export interface SavedProposal {
  method: string
  texts: Record<string, string>
  hash: string
  sendHash: string
  sentAt: number
}

/**
 * A published admin send the console cannot report as applied. Carries the send hash for the /tx link.
 * `refused` is true only when the console saw or knows Settlement refuses the send.
 */
export class AdminSendError extends Error {
  constructor(
    message: string,
    readonly sendHash: string,
    readonly refused = false,
  ) {
    super(message)
    this.name = 'AdminSendError'
  }
}

/** How many times `send` reads the paired receive block before it gives up. */
const RECEIVE_READ_ATTEMPTS = 6

/** How many times `pause` reads Settlement for the change before it gives up. */
const PAUSE_READ_ATTEMPTS = 6

export interface AdminDeps {
  writer: SettlementWriteService
  wallet: Pick<WalletProviderService, 'send'>
  reads: Pick<SettlementService, 'getPauseState'>
  ledger: TrackerLedger
  storage: StorageAdapter
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export interface PauseRequest {
  domainId: number
  isGlobal: boolean
  scope: number
  active: boolean
}

/** Sends the administrator's changes and remembers what was proposed. */
export class AdminService {
  constructor(private readonly deps: AdminDeps) {}

  /** Parses the typed values for `action`. Throws an Error that names the bad field. */
  parse(action: AdminAction, texts: Record<string, string>): { params: unknown; hashed: Hashed } {
    const params = action.parse(texts as never)
    return { params, hashed: hashOf(action, params) }
  }

  private async proposals(): Promise<Record<string, SavedProposal>> {
    return (await this.deps.storage.get<Record<string, SavedProposal>>(STORAGE_KEY_ADMIN_PROPOSALS)) ?? {}
  }

  /** The values last sent under `challengeKey`, to prefill the form. */
  async saved(challengeKey: string): Promise<SavedProposal | null> {
    return (await this.proposals())[challengeKey] ?? null
  }

  async forget(challengeKey: string): Promise<void> {
    const all = await this.proposals()
    delete all[challengeKey]
    await this.deps.storage.set(STORAGE_KEY_ADMIN_PROPOSALS, all)
  }

  /**
   * Publishes `template` through the wallet. Throws AdminSendError when the
   * wallet reports a signer other than `admin`, because Settlement refuses
   * an administrator send from any other address.
   */
  private async publish(template: AccountBlockTemplate, admin: string): Promise<{ hash: string; signerKnown: boolean }> {
    const published = (await this.deps.wallet.send(template)) as { hash?: unknown; address?: unknown } | null
    const hash = typeof published?.hash === 'string' ? published.hash : ''
    const address = published?.address
    if (typeof address === 'string' && address !== admin) {
      throw new AdminSendError(
        `The wallet signed this send with ${address}, not the administrator ${admin}. Settlement refuses it, so nothing changed. Switch the wallet to the administrator account and send again.`,
        hash,
        true,
      )
    }
    return { hash, signerKnown: typeof address === 'string' }
  }

  /**
   * Sends `action` with the typed values. The same send proposes a change
   * and, once it is due, applies it: Settlement compares the parameters
   * with the pending hash. Resolves with the published block's hash once Settlement's receive block shows success.
   */
  async send(action: AdminAction, texts: Record<string, string>, admin: string): Promise<string> {
    const { params, hashed } = this.parse(action, texts)
    const template = action.build(this.deps.writer, params as never)
    const { hash, signerKnown } = await this.publish(template, admin)
    const all = await this.proposals()
    all[hashed.key] = { method: action.method, texts, hash: hashed.hash, sendHash: hash, sentAt: this.deps.now() }
    await this.deps.storage.set(STORAGE_KEY_ADMIN_PROPOSALS, all)
    if (!signerKnown) {
      throw new AdminSendError(
        "The wallet did not report which account signed this send, so the console cannot tell whether Settlement accepted it. Check the signer on the send's page before you rely on it.",
        hash,
      )
    }
    await this.confirmReceived(hash)
    return hash
  }

  /**
   * Waits for Settlement's receive block of the send at `hash`. Throws
   * AdminSendError when its status is a refusal or no receive block shows.
   */
  private async confirmReceived(hash: string): Promise<void> {
    for (let attempt = 0; attempt < RECEIVE_READ_ATTEMPTS; attempt++) {
      await this.deps.sleep(BLOCK_TIME_SECONDS * 1000)
      let block: Awaited<ReturnType<TrackerLedger['getSend']>> = null
      try {
        block = await this.deps.ledger.getSend(hash)
      } catch {
        continue
      }
      if (!block?.received) continue
      if (block.refused) {
        throw new AdminSendError(
          'Settlement refused this send, so nothing changed. Check the administrator address, the delay and the values, then send again.',
          hash,
          true,
        )
      }
      return
    }
    throw new AdminSendError(
      `Settlement has not received this send after ${RECEIVE_READ_ATTEMPTS * BLOCK_TIME_SECONDS} seconds, so the console cannot tell whether it applied. Check the send's page before you rely on it.`,
      hash,
    )
  }

  /** Pause and resume apply at once. They are not time-challenged. Resolves once Settlement shows the change. */
  async pause(request: PauseRequest, admin: string): Promise<string> {
    const scopes: number[] = [settlement.PauseScope.PAUSE_SUBMIT, settlement.PauseScope.PAUSE_RELAY]
    if (!scopes.includes(request.scope)) throw new Error('Choose what to pause.')
    const template = this.deps.writer.pause(request.domainId, request.isGlobal, request.scope, request.active)
    const { hash } = await this.publish(template, admin)
    for (let attempt = 0; attempt < PAUSE_READ_ATTEMPTS; attempt++) {
      await this.deps.sleep(BLOCK_TIME_SECONDS * 1000)
      if (await this.pauseShown(request)) return hash
    }
    throw new AdminSendError(
      `Settlement does not show the change after ${PAUSE_READ_ATTEMPTS * BLOCK_TIME_SECONDS} seconds. Check the pause state on the Network page before you rely on it.`,
      hash,
    )
  }

  /** True when Settlement's stored pause state matches `request`. A read error counts as not shown. */
  private async pauseShown(request: PauseRequest): Promise<boolean> {
    try {
      const pause = await this.deps.reads.getPauseState()
      const entry = request.isGlobal ? pause.global : pause.domains.find((d) => d.domainId === request.domainId)
      const field = request.scope === settlement.PauseScope.PAUSE_SUBMIT ? 'submitPaused' : 'relayPaused'
      return (entry?.[field] ?? false) === request.active
    } catch {
      return false
    }
  }
}

export function createAdminService(): AdminService {
  return new AdminService({
    writer: SettlementWriteService.getInstance(),
    wallet: lazyWallet,
    reads: SettlementService.getInstance(),
    ledger: liveLedger(),
    storage: storageService,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
}
