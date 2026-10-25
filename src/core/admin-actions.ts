import { Address, Hash, settlement } from 'znn-typescript-sdk'
import type { AccountBlockTemplate, SettlementTimeChallenge } from 'znn-typescript-sdk'
import { SettlementWriteService } from './settlement-write-service'

export type FieldType = 'u8' | 'u32' | 'u64' | 'u256' | 'text' | 'hash' | 'address' | 'hex' | 'u8list'

export interface AdminField {
  key: string
  label: string
  type: FieldType
  help?: string
  placeholder?: string
  /** What the field starts with. */
  default?: string
}

/** How long a change waits between its propose and its apply. */
export type DelayKind = 'soft' | 'administrator' | 'domainUpgrade'

export type TimedMethod = settlement.SettlementChallengeMethod

export interface AdminAction<M extends TimedMethod = TimedMethod> {
  method: M
  title: string
  description: string
  delay: DelayKind | 'firstRegistration'
  fields: AdminField[]
  /** Parses the typed texts into the call's parameters. Throws an Error that names the bad field. */
  parse(texts: Record<string, string>): settlement.SettlementChallengeParams[M]
  /** Builds the unsigned send for `params`. */
  build(writer: SettlementWriteService, params: settlement.SettlementChallengeParams[M]): AccountBlockTemplate
}

const DELAY_TEXT: Record<AdminAction['delay'], string> = {
  soft: 'SoftDelay: one epoch, about 24 hours on mainnet.',
  administrator: 'AdministratorDelay: two epochs.',
  domainUpgrade: "The domain's runtime upgrade delay.",
  firstRegistration: 'None at first registration. A change to a registered domain waits.',
}
export const delayText = (action: AdminAction) => DELAY_TEXT[action.delay]

// --- Field parsers ---

function integer(name: string, text: string, max: bigint): bigint {
  const t = (text ?? '').trim()
  if (!/^\d+$/.test(t)) throw new Error(`${name} must be a whole number.`)
  const n = BigInt(t)
  if (n > max) throw new Error(`${name} is above ${max}.`)
  return n
}

const u8 = (name: string, text: string) => Number(integer(name, text, 255n))
const u32 = (name: string, text: string) => Number(integer(name, text, 0xffffffffn))
const u64 = (name: string, text: string) => integer(name, text, 0xffffffffffffffffn)
const u256 = (name: string, text: string) => integer(name, text, (1n << 256n) - 1n)

function hash(name: string, text: string): Hash {
  const t = (text ?? '').trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(t)) throw new Error(`${name} must be 32 bytes (64 hex digits).`)
  return Hash.parse(t.toLowerCase())
}

function address(name: string, text: string): Address {
  try {
    return Address.parse((text ?? '').trim())
  } catch {
    throw new Error(`${name} must be an address that starts with z1.`)
  }
}

function hex(name: string, text: string): Uint8Array {
  const t = (text ?? '').trim().replace(/^0x/i, '')
  if (!/^([0-9a-fA-F]{2})*$/.test(t)) throw new Error(`${name} must be hex.`)
  return Uint8Array.from(Buffer.from(t, 'hex'))
}

function u8list(name: string, text: string): number[] {
  const parts = (text ?? '').split(',').map((p) => p.trim()).filter((p) => p !== '')
  if (parts.length === 0) throw new Error(`${name} needs at least one value.`)
  return parts.map((p) => u8(name, p))
}

const domainId: AdminField = { key: 'domainId', label: 'Domain id', type: 'u32' }

/** The time-challenged administrator methods, each with its form fields and its builder. */
export const TIMED_ACTIONS: AdminAction[] = [
  {
    method: 'SetPeripheryConfig',
    title: 'Set periphery prices',
    description: 'The ZNN price per byte of bytecode and per byte of contract state.',
    delay: 'soft',
    fields: [
      { key: 'znnPerByteOfBytecode', label: 'ZNN per byte of bytecode (base units)', type: 'u256' },
      { key: 'znnPerByteOfState', label: 'ZNN per byte of state (base units)', type: 'u256' },
    ],
    parse: (t) => ({
      znnPerByteOfBytecode: u256('The bytecode price', t.znnPerByteOfBytecode),
      znnPerByteOfState: u256('The state price', t.znnPerByteOfState),
    }),
    build: (w, p) => w.setPeripheryConfig((p as { znnPerByteOfBytecode: bigint }).znnPerByteOfBytecode, (p as { znnPerByteOfState: bigint }).znnPerByteOfState),
  } as AdminAction,
  {
    method: 'SetDomainConfig',
    title: 'Set domain delays',
    description: "A domain's withdrawal delay and runtime upgrade delay, in momentums.",
    delay: 'soft',
    fields: [
      domainId,
      { key: 'withdrawalDelay', label: 'Withdrawal delay (momentums)', type: 'u64' },
      { key: 'runtimeUpgradeDelay', label: 'Runtime upgrade delay (momentums)', type: 'u64' },
    ],
    parse: (t) => ({
      domainId: u32('The domain id', t.domainId),
      withdrawalDelay: u64('The withdrawal delay', t.withdrawalDelay),
      runtimeUpgradeDelay: u64('The runtime upgrade delay', t.runtimeUpgradeDelay),
    }),
    build: (w, p) => {
      const q = p as { domainId: number; withdrawalDelay: bigint; runtimeUpgradeDelay: bigint }
      return w.setDomainConfig(q.domainId, q.withdrawalDelay, q.runtimeUpgradeDelay)
    },
  } as AdminAction,
  {
    method: 'SetAssetConfig',
    title: 'Set an asset limit',
    description: "The most a batch may withdraw of one asset, in the asset's base units.",
    delay: 'soft',
    fields: [
      domainId,
      { key: 'assetId', label: 'Asset id', type: 'hash', help: '22 zero bytes then the ZTS bytes.' },
      { key: 'maxBatchWithdrawal', label: 'Max batch withdrawal', type: 'u256' },
    ],
    parse: (t) => ({
      domainId: u32('The domain id', t.domainId),
      assetId: hash('The asset id', t.assetId),
      maxBatchWithdrawal: u256('The limit', t.maxBatchWithdrawal),
    }),
    build: (w, p) => {
      const q = p as { domainId: number; assetId: Hash; maxBatchWithdrawal: bigint }
      return w.setAssetConfig(q.domainId, q.assetId, q.maxBatchWithdrawal)
    },
  } as AdminAction,
  {
    method: 'SetApprovedDAModes',
    title: 'Set approved DA modes',
    description: 'The data availability modes a domain may submit batches under.',
    delay: 'soft',
    fields: [domainId, { key: 'modes', label: 'Modes', type: 'u8list', help: 'Comma separated. 0 is best effort.', default: '0' }],
    parse: (t) => ({ domainId: u32('The domain id', t.domainId), modes: u8list('The modes', t.modes) }),
    build: (w, p) => {
      const q = p as { domainId: number; modes: number[] }
      return w.setApprovedDAModes(q.domainId, q.modes)
    },
  } as AdminAction,
  {
    method: 'RegisterExecutor',
    title: 'Register an executor',
    description: "Binds a pillar to the address that signs its executor's batches.",
    delay: 'administrator',
    fields: [
      { key: 'pillarName', label: 'Pillar name', type: 'text' },
      { key: 'executorAddress', label: 'Executor address', type: 'address' },
    ],
    parse: (t) => {
      const name = (t.pillarName ?? '').trim()
      if (name === '') throw new Error('The pillar name is required.')
      return { pillarName: name, executorAddress: address('The executor address', t.executorAddress) }
    },
    build: (w, p) => {
      const q = p as { pillarName: string; executorAddress: Address }
      return w.registerExecutor(q.pillarName, q.executorAddress)
    },
  } as AdminAction,
  {
    method: 'InitiateEscapeHatch',
    title: 'Initiate the escape hatch',
    description: "Starts a domain's escape hatch. Use it only when the domain cannot recover.",
    delay: 'administrator',
    fields: [domainId],
    parse: (t) => ({ domainId: u32('The domain id', t.domainId) }),
    build: (w, p) => w.initiateEscapeHatch((p as { domainId: number }).domainId),
  } as AdminAction,
  {
    method: 'RegisterDomain',
    title: 'Register or change a domain',
    description:
      'Registers a domain. For a registered domain only minExecutors, stfSpecHash and status may differ from the stored record; every other field must equal it.',
    delay: 'firstRegistration',
    fields: [
      domainId,
      { key: 'domainClass', label: 'Domain class', type: 'u8', default: String(settlement.DomainClass.EXECUTION) },
      { key: 'runtimeKind', label: 'Runtime kind', type: 'u8', default: String(settlement.RuntimeKind.WASM) },
      { key: 'stfSpecHash', label: 'STF spec hash', type: 'hash' },
      { key: 'inputSource', label: 'Input source', type: 'u8', default: String(settlement.InputSource.L1_NATIVE) },
      { key: 'execProfile', label: 'Exec profile', type: 'u8', default: String(settlement.ExecProfile.ATTESTATION) },
      { key: 'foreignProfile', label: 'Foreign profile', type: 'u8', default: String(settlement.ForeignProfile.NONE) },
      { key: 'profileConfig', label: 'Profile config (hex)', type: 'hex', default: '' },
      { key: 'chainBinding', label: 'Chain binding (hex)', type: 'hex', default: '' },
      { key: 'minExecutors', label: 'Min executors', type: 'u8', default: '1' },
      { key: 'proposerPolicy', label: 'Proposer policy', type: 'u8', default: String(settlement.ProposerPolicy.SINGLE) },
      { key: 'finalityModel', label: 'Finality model', type: 'u8', default: String(settlement.FinalityModel.DELAY) },
      { key: 'status', label: 'Status', type: 'u8', default: String(settlement.DomainStatus.ACTIVE), help: '0 active, 1 paused.' },
      { key: 'withdrawalDelay', label: 'Withdrawal delay (momentums)', type: 'u64' },
      { key: 'runtimeUpgradeDelay', label: 'Runtime upgrade delay (momentums)', type: 'u64' },
    ],
    parse: (t) => ({
      domainId: u32('The domain id', t.domainId),
      domainClass: u8('The domain class', t.domainClass),
      runtimeKind: u8('The runtime kind', t.runtimeKind),
      stfSpecHash: hash('The STF spec hash', t.stfSpecHash),
      inputSource: u8('The input source', t.inputSource),
      execProfile: u8('The exec profile', t.execProfile),
      foreignProfile: u8('The foreign profile', t.foreignProfile),
      profileConfig: hex('The profile config', t.profileConfig),
      chainBinding: hex('The chain binding', t.chainBinding),
      minExecutors: u8('Min executors', t.minExecutors),
      proposerPolicy: u8('The proposer policy', t.proposerPolicy),
      finalityModel: u8('The finality model', t.finalityModel),
      status: u8('The status', t.status),
      withdrawalDelay: u64('The withdrawal delay', t.withdrawalDelay),
      runtimeUpgradeDelay: u64('The runtime upgrade delay', t.runtimeUpgradeDelay),
    }),
    build: (w, p) => w.registerDomain(p as RegisterParams),
  } as AdminAction,
]

type RegisterParams = Parameters<SettlementWriteService['registerDomain']>[0]

export const actionFor = (method: TimedMethod): AdminAction => {
  const found = TIMED_ACTIONS.find((a) => a.method === method)
  if (!found) throw new Error(`no admin action for ${method}`)
  return found
}

/**
 * `RegisterDomain` carries more fields than its `paramsHash` covers. The hash
 * takes the domain id, STF spec hash, min executors and the two delays.
 */
export interface Hashed {
  key: string
  hash: string
}

export function hashOf(action: AdminAction, params: unknown): Hashed {
  const m = action.method
  const p = params as never
  return {
    key: settlement.settlementChallengeKey(m, p),
    hash: settlement.settlementParamsHash(m, p).toString(),
  }
}

// --- Matching a proposal to the pending challenge ---

export type ProposalState =
  /** Nothing is pending under the key. Sending proposes the change. */
  | { kind: 'none' }
  /** This exact proposal is pending and not yet due. */
  | { kind: 'pending'; dueHeight: number; remaining: number }
  /** This exact proposal is due. Sending it applies the change. */
  | { kind: 'ready'; dueHeight: number }
  /** Another proposal holds the key. Sending these parameters restarts the challenge. */
  | { kind: 'different'; dueHeight: number; pendingHash: string }

/** Compares the typed proposal's key and hash with the challenges on chain. */
export function evaluateProposal(
  hashed: Hashed,
  challenges: SettlementTimeChallenge[],
  frontierHeight: number
): ProposalState {
  const pending = challenges.find((c) => c.methodName === hashed.key)
  if (!pending) return { kind: 'none' }
  if (pending.paramsHash.toString() !== hashed.hash) {
    return { kind: 'different', dueHeight: pending.dueHeight, pendingHash: pending.paramsHash.toString() }
  }
  return frontierHeight >= pending.dueHeight
    ? { kind: 'ready', dueHeight: pending.dueHeight }
    : { kind: 'pending', dueHeight: pending.dueHeight, remaining: pending.dueHeight - frontierHeight }
}

/** Execute is allowed only for the exact pending proposal once it is due. */
export const canExecute = (state: ProposalState) => state.kind === 'ready'
