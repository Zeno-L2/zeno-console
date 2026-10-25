import { settlement } from 'znn-typescript-sdk'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import type { GatewayClient } from 'zeno-client'
import { OutboxProofError, WithdrawalReadService, matchSettlementRoot, rebuildOutboxRoot } from './withdrawal-read-service'
import type { WithdrawalList, WithdrawalReads } from './withdrawal-read-service'
import { SettlementWriteService } from './settlement-write-service'
import type { WalletProviderService } from './wallet-provider-service'
import { lazyWallet } from './wallet-loader'

const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'))

export interface WithdrawalDeps {
  gateway: { client(): Promise<Pick<GatewayClient, 'getOutbox' | 'getOutboxProof'>> }
  reads: WithdrawalReads
  writer: Pick<SettlementWriteService, 'relayMessage' | 'releaseWithdrawals'>
  wallet: Pick<WalletProviderService, 'send'>
}

/** Raised when a relay is refused before any send. */
export class RelayRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelayRefusedError'
  }
}

/** Lists a domain's withdrawals and relays or releases them. */
export class WithdrawalService {
  private readonly reader: WithdrawalReadService

  constructor(private readonly deps: WithdrawalDeps) {
    this.reader = new WithdrawalReadService({ gateway: deps.gateway, reads: deps.reads })
  }

  /** The domain's L1 withdrawals, or only those addressed to `recipient`, newest first, each with its state, within the bounds. */
  list(domainId: number, recipient?: string): Promise<WithdrawalList> {
    return this.reader.list(domainId, recipient)
  }

  /** True when relay sends are paused for the domain, globally or for it alone. */
  relayPaused(domainId: number): Promise<boolean> {
    return this.reader.relayPaused(domainId)
  }

  /**
   * Builds the relay for `outboxId` after checking everything the client can
   * before it spends a send: the message is a withdrawal Settlement accepts,
   * its proof rebuilds the batch's outbox root, and that root is the one
   * Settlement recorded. Throws `RelayRefusedError` on any failure.
   */
  async prepareRelay(domainId: number, outboxId: string): Promise<{ template: AccountBlockTemplate; batchId: number }> {
    const client = await this.deps.gateway.client()
    const proof = await client.getOutboxProof(outboxId)
    const message = fromHex(proof.message)
    const inclusionProof = fromHex(proof.inclusionProof)

    try {
      settlement.decodeOutboxWithdrawal(message)
    } catch (error) {
      throw new RelayRefusedError(`Settlement would reject this message: ${(error as Error).message}`)
    }

    let rebuilt: string
    try {
      rebuilt = rebuildOutboxRoot(proof)
      matchSettlementRoot(proof.batchId, rebuilt, await this.deps.reads.getBatch(domainId, proof.batchId))
    } catch (error) {
      if (error instanceof OutboxProofError) throw new RelayRefusedError(error.message)
      throw error
    }

    return {
      template: this.deps.writer.relayMessage(domainId, proof.batchId, message, inclusionProof),
      batchId: proof.batchId,
    }
  }

  /** Relays one withdrawal. Resolves with the published block's hash. */
  async relay(domainId: number, outboxId: string): Promise<string> {
    const { template } = await this.prepareRelay(domainId, outboxId)
    return hashOf(await this.deps.wallet.send(template))
  }

  /** The permissionless crank that pays out the withdrawals whose delay has passed. */
  async release(domainId: number): Promise<string> {
    return hashOf(await this.deps.wallet.send(this.deps.writer.releaseWithdrawals(domainId)))
  }
}

function hashOf(published: unknown): string {
  const hash = (published as { hash?: unknown } | null)?.hash
  return typeof hash === 'string' ? hash : ''
}

export function createWithdrawalService(deps: Pick<WithdrawalDeps, 'gateway' | 'reads'>): WithdrawalService {
  return new WithdrawalService({
    ...deps,
    writer: SettlementWriteService.getInstance(),
    wallet: lazyWallet,
  })
}
