import type { EventJson, SimulateResult, StateDiffJson } from 'zeno-client'

export const ZENO_EXEC_RELEASES_URL = 'https://github.com/Zeno-L2/zeno-executor/releases'

/** The commands the test panel sends. Hex is lowercase without 0x, amounts are decimal strings. */
export type RunnerCommand =
  | { op: 'deploy'; sender: string; module: string; metadata: 'immutable' }
  | { op: 'buyStorage'; sender: string; contractId: string; bytes: number }
  | { op: 'deposit'; sender: string; contractId: string; asset: string; amount: string }
  | {
      op: 'call'
      sender: string
      contractId: string
      payload: string
      deposit?: { asset: string; amount: string }
    }

export interface RunnerReceipt {
  status: string
  gasUsed: number
  abortCode: number
  contractId: string
  codeHash: string
  returnData: string
  events: EventJson[]
  outbox: SimulateResult['outbox']
  stateDiff: StateDiffJson[]
  claimedDeposit: string
}

export type RunnerResult =
  | { ok: true; receipt: RunnerReceipt; contractId?: string; codeHash?: string }
  | { ok: false; error: { kind: string; message: string } }

export interface RunnerVersion {
  version: string
  revision: string
  modified: boolean
}

/** The runner did not answer: it is stopped, or the browser refused the origin. */
export class RunnerUnreachableError extends Error {}

// The origins `zeno-exec serve` allows without --allow-origin.
const DEFAULT_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

const trimSlashes = (url: string) => url.replace(/\/+$/, '')

/** How long the runner has to answer before the console gives up. */
export const RUNNER_TIMEOUT_MS = 30_000

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

async function request(baseUrl: string, path: string, init?: RequestInit): Promise<unknown> {
  const url = `${trimSlashes(baseUrl)}${path}`
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, RUNNER_TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: controller.signal })
    } catch {
      if (timedOut) throw new Error(`zeno-exec did not answer within 30 s at ${baseUrl}`)
      throw new RunnerUnreachableError(`zeno-exec is not answering at ${baseUrl}`)
    }
    if (!response.ok) {
      throw new Error(`zeno-exec answered ${response.status}: ${(await response.text()).trim()}`)
    }
    try {
      return await response.json()
    } catch {
      if (timedOut) throw new Error(`zeno-exec did not answer within 30 s at ${baseUrl}`)
      throw new Error('zeno-exec answered something that is not JSON')
    }
  } finally {
    clearTimeout(timer)
  }
}

const unreadableResult = () => new Error('zeno-exec answered a result this console cannot read')

function checkResult(result: unknown): RunnerResult {
  if (!isObject(result) || typeof result.ok !== 'boolean') throw unreadableResult()
  if (result.ok) {
    const receipt = result.receipt
    const isString = (v: unknown) => typeof v === 'string'
    if (
      !isObject(receipt) ||
      typeof receipt.status !== 'string' ||
      typeof receipt.gasUsed !== 'number' ||
      typeof receipt.abortCode !== 'number' ||
      !isString(receipt.returnData) ||
      !Array.isArray(receipt.outbox) ||
      !Array.isArray(receipt.events) ||
      !receipt.events.every(
        (e) =>
          isObject(e) && isString(e.data) && Array.isArray(e.topics) && e.topics.every(isString)
      ) ||
      (result.contractId !== undefined && typeof result.contractId !== 'string')
    ) {
      throw unreadableResult()
    }
  } else {
    const error = result.error
    if (!isObject(error) || typeof error.kind !== 'string' || typeof error.message !== 'string') {
      throw unreadableResult()
    }
  }
  return result as unknown as RunnerResult
}

/** Runs `commands` in one fresh session and returns one result per command. */
export async function runCommands(
  baseUrl: string,
  commands: RunnerCommand[]
): Promise<RunnerResult[]> {
  const body = await request(baseUrl, '/v1/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  })
  const results = isObject(body) ? body.results : undefined
  if (!Array.isArray(results) || results.length !== commands.length) {
    throw new Error(
      `zeno-exec answered ${Array.isArray(results) ? results.length : 0} results for ${commands.length} commands`
    )
  }
  return results.map(checkResult)
}

export async function runnerVersion(baseUrl: string): Promise<RunnerVersion> {
  const body = await request(baseUrl, '/v1/version')
  if (
    !isObject(body) ||
    typeof body.version !== 'string' ||
    typeof body.revision !== 'string' ||
    typeof body.modified !== 'boolean'
  ) {
    throw new Error('zeno-exec answered a version this console cannot read')
  }
  return body as unknown as RunnerVersion
}

const DEFAULT_RUNNER_PORT = '8547'

/** Single-quotes `text` for a POSIX shell unless it holds only URL-safe characters. */
const shellWord = (text: string) =>
  /^[\w.:/-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`

/**
 * The command that starts the runner for a page served from `origin`.
 * `runnerUrl` is the configured runner URL: a local one on another port
 * adds `--listen`.
 */
export function serveCommand(origin: string, runnerUrl?: string): string {
  let command = 'zeno-exec serve'
  // CheckOrigin refuses the literal origin 'null' (a file:// page), so no flag can help.
  if (origin !== 'null' && !DEFAULT_ORIGIN.test(origin)) command += ` --allow-origin ${shellWord(origin)}`
  const port = localPort(runnerUrl)
  if (port !== null && port !== DEFAULT_RUNNER_PORT) command += ` --listen ${shellWord(`127.0.0.1:${port}`)}`
  return command
}

/** The port of a runner URL on this computer, or null for any other URL. */
function localPort(url?: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return null
    return u.port || (u.protocol === 'https:' ? '443' : '80')
  } catch {
    return null
  }
}

/** Reads a runner receipt as the gateway's simulate result, so the call UI can describe it. */
export function toSimulateResult(receipt: RunnerReceipt): SimulateResult {
  return {
    domainId: 0,
    batchId: 0,
    postStateRoot: '',
    verified: false,
    simulated: true,
    inputIndex: 0,
    momentumHeight: 0,
    momentumTime: 0,
    momentumHash: '',
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    abortCode: receipt.abortCode,
    contractId: receipt.contractId,
    codeHash: receipt.codeHash,
    returnData: receipt.returnData,
    events: receipt.events,
    outbox: receipt.outbox,
    stateDiff: receipt.stateDiff,
  }
}
