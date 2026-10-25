import { Hash, settlement } from 'znn-typescript-sdk'
import type { SettlementDeployRecord } from 'znn-typescript-sdk'
import { storageService } from './storage/storage-service'
import type { StorageAdapter } from '../types/index'
import { SettlementWriteService } from './settlement-write-service'
import { WalletError } from './wallet-provider'
import type { WalletProviderService } from './wallet-provider-service'
import { lazyWallet } from './wallet-loader'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'

export const STORAGE_KEY_DEPLOY_JOURNALS = 'zeno-deploy-journals'

export type StepKind = 'start' | 'chunk' | 'finalize' | 'upgrade'
/** `approving` is the wallet prompt, `published` means the wallet returned a block hash. */
export type StepStatus = 'waiting' | 'approving' | 'published' | 'failed'

export interface DeployStep {
  id: string
  kind: StepKind
  /** The chunk index, for a chunk step. */
  index?: number
  status: StepStatus
  /** The published account block hash. */
  hash?: string
  error?: string
}

/**
 * The record of one deploy or upgrade, kept in storage so a reload can
 * resume it. It holds hashes and sizes, never the module itself.
 */
export interface DeployJournal {
  id: string
  kind: 'deploy' | 'upgrade'
  domainId: number
  deployer: string
  /** `SHA3-256` of the module, hex. */
  codeHash: string
  metadataHash: string
  /** The metadata bytes, hex, resent verbatim on a restart. */
  metadata: string
  totalSize: number
  chunkCount: number
  /** ZNN attached to the last send, as a decimal string of base units. */
  fee: string
  /** The contract being upgraded. */
  contractId?: string
  createdAt: number
  steps: DeployStep[]
}

export type PreflightProblemKind = 'peripheryUnset' | 'domainPaused' | 'insufficientZnn' | 'unknownDomain'

export interface PreflightProblem {
  kind: PreflightProblemKind
  message: string
}

export type DeployPhase = 'idle' | 'sending' | 'waitingForChunks' | 'submitted' | 'failed'

export interface DeployReads {
  getDomain(domainId: number): Promise<{ status: number } | null>
  getPeripheryConfig(): Promise<{ znnPerByteOfBytecode: bigint } | null>
  getDeployRecords(domainId: number, deployer: string): Promise<{ list: SettlementDeployRecord[] }>
}

export interface DeployAccounts {
  getBalance(address: string): Promise<bigint>
}

export interface DeployDeps {
  reads: DeployReads
  accounts: DeployAccounts
  writer: Pick<SettlementWriteService, 'start' | 'chunk' | 'finalize' | 'upgrade'>
  wallet: Pick<WalletProviderService, 'send'>
  storage: StorageAdapter
  sleep: (ms: number) => Promise<void>
  /** Milliseconds between deploy record polls while waiting for chunks. */
  pollIntervalMs: number
  /** Polls before giving up on the chunks. */
  maxPolls: number
}

export interface RunOptions {
  /** Called with the journal after every step change. */
  onUpdate?: (journal: DeployJournal) => void
}

export const journalId = (domainId: number, deployer: string, codeHash: string) =>
  `${domainId}:${deployer}:${codeHash}`

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

/** The send steps of a plan, in order. */
function stepsFor(kind: 'deploy' | 'upgrade', chunkCount: number): DeployStep[] {
  const steps: DeployStep[] = [{ id: 'start', kind: 'start', status: 'waiting' }]
  for (let i = 0; i < chunkCount; i++) {
    steps.push({ id: `chunk-${i}`, kind: 'chunk', index: i, status: 'waiting' })
  }
  steps.push(
    kind === 'deploy'
      ? { id: 'finalize', kind: 'finalize', status: 'waiting' }
      : { id: 'upgrade', kind: 'upgrade', status: 'waiting' }
  )
  return steps
}

export class DeployService {
  constructor(private readonly deps: DeployDeps) {}

  // --- Preflight ---

  /** What blocks a deploy before any send. An empty list means go. */
  async preflight(input: { domainId: number; deployer: string; fee: bigint }): Promise<PreflightProblem[]> {
    const problems: PreflightProblem[] = []
    const [domain, periphery, balance] = await Promise.all([
      this.deps.reads.getDomain(input.domainId),
      this.deps.reads.getPeripheryConfig(),
      this.deps.accounts.getBalance(input.deployer),
    ])
    if (!domain) {
      problems.push({ kind: 'unknownDomain', message: `Domain ${input.domainId} is not registered.` })
    } else if (domain.status === settlement.DomainStatus.PAUSED) {
      problems.push({ kind: 'domainPaused', message: `Domain ${input.domainId} is paused.` })
    }
    if (!periphery) {
      problems.push({
        kind: 'peripheryUnset',
        message: 'The bytecode price is not set yet, so Settlement rejects every deploy until the administrator sets it.',
      })
    }
    if (balance < input.fee) {
      problems.push({
        kind: 'insufficientZnn',
        message: 'The account does not hold enough ZNN for the bytecode fee.',
      })
    }
    return problems
  }

  // --- Journals ---

  async journals(): Promise<DeployJournal[]> {
    const stored = await this.deps.storage.get<Record<string, DeployJournal>>(STORAGE_KEY_DEPLOY_JOURNALS)
    return Object.values(stored ?? {}).sort((a, b) => b.createdAt - a.createdAt)
  }

  async journal(id: string): Promise<DeployJournal | null> {
    const stored = await this.deps.storage.get<Record<string, DeployJournal>>(STORAGE_KEY_DEPLOY_JOURNALS)
    return stored?.[id] ?? null
  }

  async save(journal: DeployJournal): Promise<void> {
    const stored = (await this.deps.storage.get<Record<string, DeployJournal>>(STORAGE_KEY_DEPLOY_JOURNALS)) ?? {}
    stored[journal.id] = journal
    await this.deps.storage.set(STORAGE_KEY_DEPLOY_JOURNALS, stored)
  }

  async remove(id: string): Promise<void> {
    const stored = (await this.deps.storage.get<Record<string, DeployJournal>>(STORAGE_KEY_DEPLOY_JOURNALS)) ?? {}
    delete stored[id]
    await this.deps.storage.set(STORAGE_KEY_DEPLOY_JOURNALS, stored)
  }

  /** A fresh journal for `plan`, saved and ready to run. */
  async begin(input: {
    kind: 'deploy' | 'upgrade'
    domainId: number
    deployer: string
    plan: settlement.DeployPlan
    metadata: Uint8Array
    contractId?: string
  }): Promise<DeployJournal> {
    const codeHash = input.plan.codeHash.toString()
    const journal: DeployJournal = {
      id: journalId(input.domainId, input.deployer, codeHash),
      kind: input.kind,
      domainId: input.domainId,
      deployer: input.deployer,
      codeHash,
      metadataHash: input.plan.metadataHash.toString(),
      metadata: hex(input.metadata),
      totalSize: Number(input.plan.totalSize),
      chunkCount: input.plan.chunkCount,
      fee: input.plan.fee.toString(),
      contractId: input.contractId,
      createdAt: Date.now(),
      steps: stepsFor(input.kind, input.plan.chunkCount),
    }
    await this.save(journal)
    return journal
  }

  // --- Running ---

  /**
   * Sends every step that is not yet published, in order, one wallet prompt
   * at a time. Before the last step it waits until Settlement has received
   * every chunk. Stops at the first failure and leaves that step `failed`.
   */
  async run(journal: DeployJournal, plan: settlement.DeployPlan, options: RunOptions = {}): Promise<DeployPhase> {
    this.checkPlan(journal, plan)
    const update = async () => {
      await this.save(journal)
      options.onUpdate?.(journal)
    }

    for (const step of journal.steps) {
      if (step.status === 'published') continue

      if (step.kind === 'finalize' || step.kind === 'upgrade') {
        const ready = await this.waitForChunks(journal)
        if (!ready) {
          step.status = 'failed'
          step.error = 'Settlement did not report every chunk as received in time.'
          await update()
          return 'failed'
        }
      }

      step.status = 'approving'
      step.error = undefined
      await update()
      try {
        const published = await this.deps.wallet.send(this.template(journal, plan, step))
        step.hash = hashOf(published)
        step.status = 'published'
        await update()
      } catch (error) {
        step.status = 'failed'
        step.error = error instanceof WalletError || error instanceof Error ? error.message : 'The send failed.'
        await update()
        return 'failed'
      }
    }
    return 'submitted'
  }

  /**
   * Continues a journal after a reload. It reads the deploy record from
   * Settlement and the journal's own record of what was published:
   *
   * - A record that is missing (the deploy never started, or expired) or
   *   expired restarts every step.
   * - A live record keeps the published steps and resends the rest. The
   *   start is never resent while its record lives.
   * - With no record and a published last step, the deploy is submitted.
   */
  async resume(journal: DeployJournal, plan: settlement.DeployPlan, options: RunOptions = {}): Promise<DeployPhase> {
    this.checkPlan(journal, plan)
    const last = journal.steps[journal.steps.length - 1]
    const record = await this.record(journal)

    if (!record) {
      if (last.status === 'published') return 'submitted'
      this.restart(journal)
    } else if (record.isExpired) {
      this.restart(journal)
    } else {
      for (const step of journal.steps) {
        if (step.status !== 'published') step.status = 'waiting'
      }
    }
    return this.run(journal, plan, options)
  }

  private restart(journal: DeployJournal): void {
    for (const step of journal.steps) {
      step.status = 'waiting'
      step.hash = undefined
      step.error = undefined
    }
  }

  private checkPlan(journal: DeployJournal, plan: settlement.DeployPlan): void {
    if (plan.codeHash.toString() !== journal.codeHash) {
      throw new Error('The module does not match the journal: its code hash differs.')
    }
    if (plan.chunkCount !== journal.chunkCount || plan.fee.toString() !== journal.fee) {
      throw new Error('The plan does not match the journal. Rebuild it from the same module and prices.')
    }
  }

  private template(journal: DeployJournal, plan: settlement.DeployPlan, step: DeployStep): AccountBlockTemplate {
    const w = this.deps.writer
    switch (step.kind) {
      case 'start':
        return w.start(journal.domainId, plan, Uint8Array.from(Buffer.from(journal.metadata, 'hex')))
      case 'chunk':
        return w.chunk(journal.domainId, plan, step.index ?? 0)
      case 'finalize':
        return w.finalize(journal.domainId, plan)
      case 'upgrade':
        return w.upgrade(journal.domainId, Hash.parse(journal.contractId ?? ''), plan)
    }
  }

  private async record(journal: DeployJournal): Promise<SettlementDeployRecord | null> {
    const list = await this.deps.reads.getDeployRecords(journal.domainId, journal.deployer)
    return list.list.find((r) => r.codeHash.toString() === journal.codeHash) ?? null
  }

  /** Polls the deploy record until Settlement has received every chunk. */
  private async waitForChunks(journal: DeployJournal): Promise<boolean> {
    for (let i = 0; i < this.deps.maxPolls; i++) {
      const record = await this.record(journal)
      if (record && !record.isExpired && record.receivedCount >= journal.chunkCount) return true
      await this.deps.sleep(this.deps.pollIntervalMs)
    }
    return false
  }
}

/** The block hash in a wallet's published-block JSON. */
function hashOf(published: unknown): string {
  const hash = (published as { hash?: unknown } | null)?.hash
  return typeof hash === 'string' ? hash : ''
}

/** The service wired to the live singletons. */
export function createDeployService(deps: {
  reads: DeployReads
  accounts: DeployAccounts
}): DeployService {
  return new DeployService({
    reads: deps.reads,
    accounts: deps.accounts,
    writer: SettlementWriteService.getInstance(),
    wallet: lazyWallet,
    storage: storageService,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollIntervalMs: 5000,
    maxPolls: 36,
  })
}
