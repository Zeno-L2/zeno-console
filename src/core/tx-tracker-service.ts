import { GatewayVerificationError, NotFoundError, ResponseSizeError } from 'zeno-client'
import type { GatewayClient, ReceiptResult } from 'zeno-client'
import { SETTLEMENT_ADDRESS, SettlementContract } from 'znn-typescript-sdk'

/**
 * The stages one send moves through (`ZENO-CONSOLE.md` 5.4):
 *
 * 1. published: the account block is in the sender's chain.
 * 2. received: Settlement received it.
 * 3. executed: the gateway serves a `pending` receipt for this send, and
 *    the node's send block confirms its domain and sender. The rest of the
 *    receipt is unchecked.
 * 4. submitted: the receipt reaches `latest` and passes the console's
 *    check against its batch and the node's send block.
 * 5. finalized: the receipt reaches `finalized` and passes that check
 *    again.
 */
export type TrackStage = 'unknown' | 'published' | 'received' | 'executed' | 'submitted' | 'finalized'

export const TRACK_STAGES: TrackStage[] = ['published', 'received', 'executed', 'submitted', 'finalized']

/**
 * The node has no account block for the send. The console's send source
 * throws it, so the receipt check can tell a lagging node from a failed read.
 */
export class MissingSendError extends Error {
  constructor() {
    super('the node has no account block for this send yet')
    this.name = 'MissingSendError'
  }
}

/**
 * A read of the trusted node failed: the node is unreachable, which is
 * not a gateway fault. The check waits with no limit.
 */
export class NodeReadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'the node could not be read')
    this.name = 'NodeReadError'
  }
}

/**
 * The console's check of a receipt, run by zeno-client's verifyReceipt.
 *
 * - verified: the receipt passed at latest or finalized.
 * - bound: a pending receipt whose send, domain and sender match the
 *   node's send block. Settlement has no batch for it yet.
 * - waiting: the check could not finish. The next read checks again.
 * - failed: the receipt contradicts the node or Settlement, or the node
 *   has not shown its send, batch or finality, or the gateway has not
 *   served the receipt data, within NODE_BEHIND_LIMIT_MS.
 *
 * `bindingsChecked` is true when the receipt's domain and sender match the
 * node's send block. `latestChecked` is true when the finalized receipt
 * is held at Submitted and its `latest` copy passed the whole check.
 */
export type ReceiptCheck =
  | { state: 'verified' | 'bound' }
  | { state: 'waiting'; reason: string; bindingsChecked: boolean; latestChecked?: true }
  | { state: 'failed'; reason: string; latestChecked?: true }

/** How long the node may lag the gateway's receipt: 2 minutes, 12 momentums. */
export const NODE_BEHIND_LIMIT_MS = 120_000

/**
 * True when the receipt's domain and sender were checked against the
 * node's send block and matched.
 */
export function bindingsChecked(proof: ReceiptCheck | null | undefined): boolean {
  if (!proof) return false
  if (proof.state === 'verified' || proof.state === 'bound') return true
  return proof.state === 'waiting' && proof.bindingsChecked
}

/**
 * True when every receipt field passed a check: `verified`, or a held
 * `latest` copy that passed.
 */
export function fieldsChecked(proof: ReceiptCheck | null | undefined): boolean {
  if (!proof) return false
  if (proof.state === 'verified') return true
  return (proof.state === 'waiting' || proof.state === 'failed') && proof.latestChecked === true
}

export interface TrackState {
  sendHash: string
  stage: TrackStage
  /** The momentum height the send block is confirmed at, when known. */
  confirmedAt?: number
  receipt?: ReceiptResult
  /** Set whenever `receipt` is set. */
  proof?: ReceiptCheck
  /** Why the last read failed. The stage keeps its last known value. */
  error?: string
  /** The send queues no domain input, so it ends at Received with no receipt. */
  l1Only?: boolean
  /** Settlement refused the send: its receive block carries a failure status. No receipt follows. */
  refused?: boolean
}

export interface TrackerLedger {
  /**
   * The send block with its receive block, or null when the node does not
   * know it. `refused` is true when the send went to Settlement and its
   * receive block's status is not success.
   */
  getSend(hash: string): Promise<{ received: boolean; refused?: boolean; confirmedAt?: number; createsInput: boolean } | null>
}

export interface TrackerGateway {
  client(): Promise<Pick<GatewayClient, 'getReceipt' | 'subscribe' | 'verifyReceipt'>>
}

export interface TrackerDeps {
  ledger: TrackerLedger
  gateway: TrackerGateway
  sleep: (ms: number) => Promise<void>
  pollIntervalMs: number
  /** The clock for the node-behind limit. Defaults to `Date.now`. */
  now?: () => number
}

const INPUT_METHODS = [
  'Deposit',
  'CallL2',
  'DeployContractStart',
  'DeployContractChunk',
  'DeployContractFinalize',
  'UpgradeContract',
  'TransferContractOwnership',
  'BuyStorage',
]

const INPUT_SIGHASHES = new Set(INPUT_METHODS.map((name) => SettlementContract.abi.getSighash(name).replace(/^0x/, '')))

/** True for a send to Settlement whose method queues a domain input. */
export function createsDomainInput(toAddress: string, data: Uint8Array): boolean {
  return toAddress === SETTLEMENT_ADDRESS.toString() && INPUT_SIGHASHES.has(Buffer.from(data.slice(0, 4)).toString('hex'))
}

const REFUSED_MESSAGE = 'Settlement refused this send. It had no effect.'

/** The status Settlement's VM writes into a receive block's data: 8 big-endian bytes, 1 for success and 2 for failure. */
const RECEIVE_STATUS_SUCCESS = 1n

/** True when a receive block's data is not the success status. */
export function isRefusedStatus(data: Uint8Array): boolean {
  if (data.length !== 8) return true
  return new DataView(data.buffer, data.byteOffset, 8).getBigUint64(0) !== RECEIVE_STATUS_SUCCESS
}

const STAGE_OF_TAG = { pending: 'executed', latest: 'submitted', finalized: 'finalized' } as const

const rank = (stage: TrackStage) => TRACK_STAGES.indexOf(stage)

const checkKey = (sendHash: string, receipt: ReceiptResult) => `${sendHash}\n${JSON.stringify(receipt)}`

/**
 * What the node does not show yet: the send, the receipt's batch, or the
 * batch's finality. Null for any other outcome.
 */
const behindCause = (e: unknown): 'send' | 'batch root' | 'finality' | null => {
  if (e instanceof MissingSendError) return 'send'
  if (e instanceof GatewayVerificationError && (e.check === 'batch root' || e.check === 'finality')) return e.check
  return null
}

/**
 * A failed check the same receipt fails again: not a node-behind cause,
 * and not a transport limit.
 */
const isContradiction = (e: unknown): e is GatewayVerificationError =>
  e instanceof GatewayVerificationError && !(e instanceof ResponseSizeError) && behindCause(e) === null

/** Follows one send from the wallet's publish to its finalized receipt. */
export class TxTrackerService {
  /**
   * The last definite verifyReceipt outcome, which a check of the identical
   * receipt on the same client repeats.
   */
  private lastCheck: { client: object; key: string; outcome: boolean | { error: unknown } } | null = null

  /**
   * When the tracked send first met a node-behind cause of this group.
   * `send` is a missing send block; `batch` is a `batch root` or `finality`
   * error, or a gateway read failure.
   */
  private behindSince: { sendHash: string; group: 'send' | 'batch'; at: number } | null = null

  /** The send whose first pass already cleared `behindSince`. */
  private verifiedSend: string | null = null

  constructor(private readonly deps: TrackerDeps) {}

  /** verifyReceipt through the lastCheck cache. Never throws. */
  private async verify(
    client: Pick<GatewayClient, 'verifyReceipt'>,
    sendHash: string,
    receipt: ReceiptResult
  ): Promise<boolean | { error: unknown }> {
    const key = checkKey(sendHash, receipt)
    if (this.lastCheck?.client === client && this.lastCheck.key === key) return this.lastCheck.outcome
    let outcome: boolean | { error: unknown }
    try {
      outcome = await client.verifyReceipt(sendHash, receipt)
    } catch (error) {
      outcome = { error }
    }
    if (typeof outcome === 'boolean' || isContradiction(outcome.error)) {
      this.lastCheck = { client, key, outcome }
    }
    return outcome
  }

  /** Never throws. */
  private async check(
    client: Pick<GatewayClient, 'verifyReceipt'>,
    sendHash: string,
    receipt: ReceiptResult
  ): Promise<{ proof: ReceiptCheck; stage?: TrackStage }> {
    const now = (this.deps.now ?? Date.now)()
    const clearFirstPass = () => {
      if (this.verifiedSend !== sendHash) {
        this.behindSince = null
        this.verifiedSend = sendHash
      }
    }

    let outcome = await this.verify(client, sendHash, receipt)
    let held = false
    if (typeof outcome === 'object' && outcome.error instanceof GatewayVerificationError && outcome.error.check === 'finality') {
      const latest = await this.verify(client, sendHash, { ...receipt, tag: 'latest' })
      if (latest === true) {
        held = true
        clearFirstPass()
      } else {
        outcome = latest
      }
    }

    if (typeof outcome === 'object') {
      const { error } = outcome
      if (isContradiction(error)) return { proof: { state: 'failed', reason: error.message } }
      const cause = behindCause(error)
      // Any other failure of a gateway read (the sidecar) while the node is up.
      const gatewayRead = cause === null && !(error instanceof NodeReadError)
      if (cause || gatewayRead) {
        const group = cause === 'send' ? 'send' : 'batch'
        if (!this.behindSince || this.behindSince.sendHash !== sendHash || this.behindSince.group !== group) {
          this.behindSince = { sendHash, group, at: now }
        }
        const expired = now - this.behindSince.at >= NODE_BEHIND_LIMIT_MS
        const where = `batch ${receipt.batchId} for domain ${receipt.domainId}`
        let reason: string
        if (cause === 'send') {
          reason = expired
            ? "Your node still does not show this send after 2 minutes. Your node is behind, or the gateway's receipt is for a send your node never saw."
            : 'Your node does not show this send yet, so the receipt is not checked. The console checks again on the next read.'
        } else if (cause === 'batch root') {
          reason = expired
            ? `Settlement on your node still has no ${where} after 2 minutes. Your node is behind, or the gateway's receipt names a batch Settlement never accepted.`
            : `Settlement on your node has no ${where} yet. The console checks again on the next read.`
        } else if (cause === 'finality') {
          reason = expired
            ? `Settlement on your node still does not report batch ${receipt.batchId} as finalized after 2 minutes. Your node is behind, or the gateway's claim that the batch is final is false.`
            : `Settlement on your node does not report batch ${receipt.batchId} as finalized yet. The console checks again on the next read.`
        } else {
          const message = error instanceof Error ? error.message : 'the read failed'
          reason = expired
            ? `The gateway still has not served batch ${receipt.batchId}'s receipt data after 2 minutes, so the receipt cannot be checked.`
            : `The gateway did not serve batch ${receipt.batchId}'s receipt data: ${message}. The console checks again on the next read.`
        }
        const latestChecked = held ? ({ latestChecked: true } as const) : {}
        const proof: ReceiptCheck = expired
          ? { state: 'failed', reason, ...latestChecked }
          : { state: 'waiting', reason, bindingsChecked: cause !== 'send', ...latestChecked }
        return held ? { proof, stage: 'submitted' } : { proof }
      }
      // The trusted node could not be read: no clock, the next read checks again.
      return {
        proof: {
          state: 'waiting',
          reason:
            error instanceof Error ? `The receipt could not be checked: ${error.message}` : 'The receipt could not be checked.',
          bindingsChecked: false,
        },
      }
    }

    if (outcome) {
      clearFirstPass()
      return { proof: { state: 'verified' }, stage: STAGE_OF_TAG[receipt.tag] }
    }
    return { proof: { state: 'bound' }, stage: 'executed' }
  }

  /** Reads the send and its receipt once. */
  async snapshot(sendHash: string): Promise<TrackState> {
    const state: TrackState = { sendHash, stage: 'unknown' }
    try {
      const block = await this.deps.ledger.getSend(sendHash)
      if (block) {
        state.stage = block.received ? 'received' : 'published'
        state.confirmedAt = block.confirmedAt
        if (block.received && block.refused) {
          state.refused = true
          state.error = REFUSED_MESSAGE
          return state
        }
        if (!block.createsInput) {
          state.l1Only = true
          return state
        }
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'The node could not be read.'
    }

    try {
      const client = await this.deps.gateway.client()
      const receipt = await client.getReceipt(sendHash)
      state.receipt = receipt
      const { proof, stage } = await this.check(client, sendHash, receipt)
      state.proof = proof
      // A checked receipt means Settlement received the send, even if the node read lagged.
      if (stage && rank(stage) > rank(state.stage)) state.stage = stage
    } catch (error) {
      // No receipt yet is the normal state before execution.
      if (!(error instanceof NotFoundError)) {
        state.error = error instanceof Error ? error.message : 'The gateway could not be read.'
      }
    }
    return state
  }

  /**
   * Calls `onUpdate` with each new state until the receipt is finalized,
   * Settlement refuses the send, or an L1-only send is received, and returns a function that stops it. A WebSocket gateway pushes the
   * changes. Without one, the service polls.
   */
  follow(sendHash: string, onUpdate: (state: TrackState) => void): () => void {
    let stopped = false
    let unsubscribe: (() => Promise<void>) | null = null
    let wake: (() => void) | null = null

    const refresh = async (): Promise<TrackState> => {
      const state = await this.snapshot(sendHash)
      if (!stopped) onUpdate(state)
      return state
    }

    void (async () => {
      try {
        const client = await this.deps.gateway.client()
        unsubscribe = await client.subscribe('receipt', [sendHash], () => wake?.())
      } catch {
        // No subscription over HTTP: the loop below polls.
      }
      if (stopped) {
        void unsubscribe?.()
        return
      }
      while (!stopped) {
        const state = await refresh()
        if (state.stage === 'finalized' || state.refused || (state.l1Only && state.stage === 'received')) break
        await Promise.race([
          this.deps.sleep(this.deps.pollIntervalMs),
          new Promise<void>((resolve) => {
            wake = resolve
          }),
        ])
        wake = null
      }
      void unsubscribe?.()
    })()

    return () => {
      stopped = true
      wake?.()
      void unsubscribe?.()
    }
  }
}
