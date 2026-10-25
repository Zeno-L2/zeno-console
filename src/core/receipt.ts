import {
  decodeDeployReturnData,
  decodeUpgradeReturnData,
  interfaceEncoderFor,
} from 'zeno-client'
import type { ContractInterface, DecodedError, DecodedEvent, EventJson, ReceiptResult, SimulateResult, Value } from 'zeno-client'

const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'))
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

export type StatusTone = 'success' | 'destructive'

/** Every status a receipt can carry. */
export type ReceiptStatusName =
  | 'SUCCESS'
  | 'REVERT'
  | 'OUT_OF_GAS'
  | 'RUNTIME_FAULT'
  | 'VALIDATION_FAILED'
  | 'RESULT_TOO_LARGE'
  | 'UNAUTHORIZED'
  | 'UNSUPPORTED_OPERATION'
  | 'STORAGE_QUOTA_EXCEEDED'

export interface StatusInfo {
  /** What the status means and what to do next, in plain language. */
  summary: string
  /** Whether the runtime returns an attached deposit in full when the input ends in this status. */
  refundsDeposit: boolean
}

/** One plain-language explanation per receipt status. A new status is a type error until it is added. */
export const STATUS_INFO: Record<ReceiptStatusName, StatusInfo> = {
  SUCCESS: {
    summary: 'The call ran and its effects were applied. Any part of a deposit the contract did not claim was returned.',
    refundsDeposit: false,
  },
  REVERT: {
    summary: 'The contract rejected the call with an error and nothing changed. Check the error below, fix the arguments and send again.',
    refundsDeposit: true,
  },
  OUT_OF_GAS: {
    summary: 'The call used more than its plasma limit and was rolled back. Send it again with a higher plasma limit.',
    refundsDeposit: true,
  },
  RUNTIME_FAULT: {
    summary: 'The contract crashed or returned malformed output, so the call was rolled back. Contact the contract author if it repeats.',
    refundsDeposit: true,
  },
  VALIDATION_FAILED: {
    summary: 'The input was not valid for its target, for example a contract that does not exist or code that failed checks. Nothing was applied.',
    refundsDeposit: true,
  },
  RESULT_TOO_LARGE: {
    summary: 'The contract produced more output than the network allows, so the call was rolled back. Contact the contract author.',
    refundsDeposit: true,
  },
  UNAUTHORIZED: {
    summary: 'Your account is not allowed to do this. Only the contract owner can upgrade or transfer a contract.',
    refundsDeposit: true,
  },
  UNSUPPORTED_OPERATION: {
    summary: 'The network does not support this kind of input, so nothing ran. No deposit can be attached to it.',
    refundsDeposit: false,
  },
  STORAGE_QUOTA_EXCEEDED: {
    summary: 'The contract had no storage left for this call. Buy storage on its Manage tab and try again.',
    refundsDeposit: true,
  },
}

const FALLBACK_INFO: StatusInfo = {
  summary: 'This status is not known to the console. The raw status above is what the network reported.',
  refundsDeposit: false,
}

/** The explanation of a status, with a generic one for a status the console does not know. */
export function describeStatus(status: string): StatusInfo {
  return Object.prototype.hasOwnProperty.call(STATUS_INFO, status) ? STATUS_INFO[status as ReceiptStatusName] : FALLBACK_INFO
}

export interface DepositRefund {
  recipient: string
  assetId: string
  /** The refunded amount in the asset's smallest unit. */
  amount: string
}

export interface ReceiptDetails {
  status: string
  tone: StatusTone
  gasUsed: number
  abortCode: number
  /** The plain-language meaning of the status and what to do next. */
  explanation: string
  /** Whether the runtime returns an attached deposit in full on this status. */
  refundsDeposit: boolean
  /** The deposit refund the receipt's outbox carries, when it carries one. */
  refund?: DepositRefund
  /** The method a `CallL2` input called, when the interface names it. */
  method?: string
  /** The decoded outputs of that method by name. Absent when the method has no outputs. */
  returnValue?: Record<string, Value>
  /** A `REVERT`'s error, named from its abort code. */
  error?: DecodedError
  /** A deploy's `code_hash` and `CodeHash`, from a successful finalize. */
  deployed?: { sourceCodeHash: string; codeHash: string }
  /** An upgrade's old and new `CodeHash`. */
  upgraded?: { oldCodeHash: string; newCodeHash: string }
  events: { decoded: DecodedEvent | null; raw: EventJson }[]
  /** Why decoding stopped, when the interface did not fit the data. */
  decodeError?: string
}

/**
 * Decodes events with the contract's interface. Without an interface each
 * event stays raw. Throws when the interface does not fit an event.
 */
export function describeEvents(events: EventJson[], iface?: ContractInterface | null): ReceiptDetails['events'] {
  if (!iface) return events.map((raw) => ({ decoded: null, raw }))
  const encoder = interfaceEncoderFor(iface.encoding)
  return events.map((raw) => ({ decoded: encoder.decodeEvent(iface, raw.topics, fromHex(raw.data)), raw }))
}

/**
 * Reads a receipt the way a person wants it: the status, the gas, the
 * return value or the error by name, the deploy result and the events.
 * `iface` is optional. Without it return data and events stay raw.
 */
export function describeReceipt(receipt: ReceiptResult, iface?: ContractInterface | null): ReceiptDetails {
  const status = receipt.receipt.status
  const info = describeStatus(status)
  const details: ReceiptDetails = {
    status,
    explanation: info.summary,
    refundsDeposit: info.refundsDeposit,
    tone: status === 'SUCCESS' ? 'success' : 'destructive',
    gasUsed: receipt.receipt.gasUsed,
    abortCode: receipt.receipt.abortCode,
    events: receipt.events.map((raw) => ({ decoded: null, raw })),
  }
  // A failed input discards the contract's own outbox, so a withdrawal left on it is the refund.
  const withdrawal = info.refundsDeposit ? receipt.outbox.find((m) => m.kind === 'L1_WITHDRAWAL') : undefined
  if (withdrawal?.recipient && withdrawal.assetId && withdrawal.amount) {
    details.refund = { recipient: withdrawal.recipient, assetId: withdrawal.assetId, amount: withdrawal.amount }
  }
  const data = fromHex(receipt.returnData)
  const kind = receipt.input?.kind

  try {
    if (status === 'SUCCESS' && kind === 'DeployContractFinalize' && data.length > 0) {
      const d = decodeDeployReturnData(data)
      details.deployed = { sourceCodeHash: d.codeHash.toString(), codeHash: d.executableCodeHash.toString() }
    }
    if (status === 'SUCCESS' && kind === 'UpgradeContract' && data.length > 0) {
      const u = decodeUpgradeReturnData(data)
      details.upgraded = { oldCodeHash: u.oldCodeHash.toString(), newCodeHash: u.newCodeHash.toString() }
    }

    if (iface) {
      const encoder = interfaceEncoderFor(iface.encoding)
      if (kind === 'CallL2' && typeof receipt.input?.payload === 'string') {
        const selector = receipt.input.payload.slice(0, 8)
        const method = iface.methods.find((m) => m.selector.toLowerCase() === selector)
        if (method) {
          details.method = method.name
          if (status === 'SUCCESS') {
            const outputs = encoder.decodeReturn(iface, method.name, data)
            if (method.outputs.length > 0) details.returnValue = outputs
          }
        }
      }
      if (status === 'REVERT') details.error = encoder.decodeError(iface, receipt.receipt.abortCode, data)
      details.events = describeEvents(receipt.events, iface)
    }
  } catch (error) {
    details.decodeError = error instanceof Error ? error.message : 'The receipt could not be decoded.'
  }
  return details
}

/** A decoded value as display text. Integers print in full, bytes as hex, lists as JSON. */
export function formatValue(value: Value): string {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return toHex(value)
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
  return String(value)
}

/**
 * Reads a simulated result as `describeReceipt` reads a receipt. `payload`
 * is the call's hex payload, which names the method whose return value to
 * decode.
 */
export function describeSimulation(
  sim: SimulateResult,
  iface?: ContractInterface | null,
  payload?: string
): ReceiptDetails {
  const asReceipt = {
    domainId: sim.domainId,
    batchId: sim.batchId,
    verified: false,
    tag: 'pending',
    globalInputIndex: sim.inputIndex,
    sendHash: '',
    sender: '',
    receipt: {
      inputIndex: sim.inputIndex,
      inputHash: '',
      batchId: sim.batchId,
      contractId: sim.contractId,
      codeHash: sim.codeHash,
      status: sim.status,
      gasUsed: sim.gasUsed,
      abortCode: sim.abortCode,
      stateDiffHash: '',
      returnHash: '',
      eventRoot: '',
      eventCount: sim.events.length,
      outboxRoot: '',
      outboxCount: sim.outbox.length,
    },
    returnData: sim.returnData,
    events: sim.events,
    outbox: [],
    input: payload === undefined ? null : { kind: 'CallL2', inputKind: 0, sourceAccountBlockHash: '', payload },
  } as ReceiptResult
  return describeReceipt(asReceipt, iface)
}
