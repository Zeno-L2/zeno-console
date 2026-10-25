import { Hash, settlement } from 'znn-typescript-sdk'
import type { SettlementPauseInfo } from 'znn-typescript-sdk'
import type { GatewayClient, OutboxItem, OutboxProofResult } from 'zeno-client'
import { GatewayService } from './gateway-service'
import { SettlementService } from './settlement-service'

const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'))

/**
 * Where one withdrawal stands:
 *
 * - `pending`: its batch is not accepted on L1 yet.
 * - `relayable`: the batch is accepted and Settlement has not registered the message.
 * - `queued`: Settlement registered it and holds it in the release queue.
 * - `released`: registered and no longer queued.
 */
export type WithdrawalState = 'pending' | 'relayable' | 'queued' | 'released'

export interface Withdrawal {
  item: OutboxItem
  state: WithdrawalState
}

/** At most this many withdrawals are listed. */
export const WITHDRAWAL_LIST_LIMIT = 100
/** At most this many gateway outbox pages are read for one list. */
export const OUTBOX_PAGE_LIMIT = 5

/** The newest withdrawals read, and whether the read stopped before the end of the outbox. */
export interface WithdrawalList {
  withdrawals: Withdrawal[]
  more: boolean
}

export interface WithdrawalReads {
  isOutboxProcessed(outboxId: Hash): Promise<boolean>
  getReleaseQueue(domainId: number, pageIndex: number, pageSize: number): Promise<{ list: { outboxId: Hash }[] }>
  getPauseState(): Promise<SettlementPauseInfo>
  /** The batch entry Settlement holds, for the outbox root. */
  getBatch(domainId: number, batchId: number): Promise<{ outboxRoot: Hash } | null>
}

/** Raised when an outbox inclusion proof fails a check. */
export class OutboxProofError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutboxProofError'
  }
}

/**
 * Rebuilds the batch's outbox root from the message and its inclusion
 * proof, and compares it with the root the gateway named. Returns the
 * rebuilt root. Throws OutboxProofError.
 */
export function rebuildOutboxRoot(
  proof: Pick<OutboxProofResult, 'message' | 'inclusionProof' | 'outboxRoot'>
): string {
  let rebuilt: string
  try {
    rebuilt = settlement.outboxProofRoot(fromHex(proof.message), fromHex(proof.inclusionProof)).toString()
  } catch (error) {
    throw new OutboxProofError(`The inclusion proof is malformed: ${(error as Error).message}`)
  }
  if (rebuilt !== proof.outboxRoot.toLowerCase()) {
    throw new OutboxProofError('The inclusion proof does not rebuild the outbox root the gateway named.')
  }
  return rebuilt
}

/**
 * Compares a rebuilt root with Settlement's entry for the batch. Throws
 * OutboxProofError when the entry is null or its root differs.
 */
export function matchSettlementRoot(batchId: number, rebuilt: string, entry: { outboxRoot: Hash } | null): void {
  if (!entry) throw new OutboxProofError(`Settlement has no batch ${batchId}.`)
  if (entry.outboxRoot.toString() !== rebuilt) {
    throw new OutboxProofError('The outbox root does not match the one Settlement recorded for the batch.')
  }
}

export interface WithdrawalReadDeps {
  gateway: { client(): Promise<Pick<GatewayClient, 'getOutbox' | 'getOutboxProof'>> }
  reads: WithdrawalReads
}

const QUEUE_PAGE_SIZE = 100

/** The read-only half of the withdrawal flow: states, pause and proof checks. */
export class WithdrawalReadService {
  private static instance: WithdrawalReadService | null = null

  constructor(private readonly deps: WithdrawalReadDeps) {}

  static getInstance(): WithdrawalReadService {
    if (!WithdrawalReadService.instance) {
      const settlementService = SettlementService.getInstance()
      WithdrawalReadService.instance = new WithdrawalReadService({
        gateway: GatewayService.getInstance(),
        reads: {
          isOutboxProcessed: (id) => settlementService.isOutboxProcessed(id),
          getReleaseQueue: (domainId, page, size) => settlementService.getReleaseQueue(domainId, page, size),
          getPauseState: () => settlementService.getPauseState(),
          getBatch: (domainId, batchId) => settlementService.getBatch(domainId, batchId),
        },
      })
    }
    return WithdrawalReadService.instance
  }

  /** The domain's L1 withdrawals, or only those addressed to `recipient`, newest first, each with its state, within the bounds. */
  async list(domainId: number, recipient?: string): Promise<WithdrawalList> {
    const client = await this.deps.gateway.client()
    const items: OutboxItem[] = []
    let cursor: string | null | undefined
    let pages = 0
    do {
      const page = await client.getOutbox({ domainId, ...(recipient ? { recipient } : {}), toBatch: 'latest', cursor })
      items.push(...page.items.filter((i) => i.kind === 'L1_WITHDRAWAL'))
      cursor = page.nextCursor
      pages++
    } while (cursor && items.length <= WITHDRAWAL_LIST_LIMIT && pages < OUTBOX_PAGE_LIMIT)

    const more = items.length > WITHDRAWAL_LIST_LIMIT || !!cursor
    const kept = items.slice(0, WITHDRAWAL_LIST_LIMIT)
    if (kept.length === 0) return { withdrawals: [], more }
    const states = await this.statesOf(domainId, kept)
    return { withdrawals: kept.map((item) => ({ item, state: states.get(item.outboxId) as WithdrawalState })), more }
  }

  /** State of each L1_WITHDRAWAL item, keyed by outboxId. Other kinds have no entry. */
  async statesOf(domainId: number, items: OutboxItem[]): Promise<Map<string, WithdrawalState>> {
    const withdrawals = items.filter((i) => i.kind === 'L1_WITHDRAWAL')
    const states = new Map<string, WithdrawalState>()
    const verified = withdrawals.filter((i) => i.verified)
    for (const item of withdrawals) {
      if (!item.verified) states.set(item.outboxId, 'pending')
    }
    if (verified.length === 0) return states

    const queued = await this.queuedIds(domainId)
    await Promise.all(
      verified.map(async (item) => {
        const processed = await this.deps.reads.isOutboxProcessed(Hash.parse(item.outboxId))
        states.set(item.outboxId, !processed ? 'relayable' : queued.has(item.outboxId) ? 'queued' : 'released')
      })
    )
    return states
  }

  private async queuedIds(domainId: number): Promise<Set<string>> {
    const ids = new Set<string>()
    for (let page = 0; ; page++) {
      const queue = await this.deps.reads.getReleaseQueue(domainId, page, QUEUE_PAGE_SIZE)
      for (const entry of queue.list) ids.add(entry.outboxId.toString())
      if (queue.list.length < QUEUE_PAGE_SIZE) return ids
    }
  }

  /** True when relay sends are paused for the domain, globally or for it alone. */
  async relayPaused(domainId: number): Promise<boolean> {
    const pause = await this.deps.reads.getPauseState()
    return (
      pause.global?.relayPaused === true || pause.domains.some((d) => d.domainId === domainId && d.relayPaused)
    )
  }

  /**
   * Fetches the proof and runs rebuildOutboxRoot. When proof.verified is
   * true it then reads Settlement's batch entry and runs
   * matchSettlementRoot. When it is false, Settlement has no entry yet, so
   * the Settlement comparison is skipped and the caller shows Pending.
   * Throws OutboxProofError.
   */
  async checkProof(outboxId: string): Promise<OutboxProofResult> {
    const client = await this.deps.gateway.client()
    const proof = await client.getOutboxProof(outboxId)
    const rebuilt = rebuildOutboxRoot(proof)
    if (proof.verified) {
      matchSettlementRoot(proof.batchId, rebuilt, await this.deps.reads.getBatch(proof.domainId, proof.batchId))
    }
    return proof
  }
}
