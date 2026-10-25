import { isDeepStrictEqual } from 'node:util'
import type { Client } from 'znn-typescript-sdk'
import type { SendBlock, SendSource, SettlementBatchEntry } from 'zeno-client'
import { Address, BlockTypeEnum, Hash, SETTLEMENT_ADDRESS, SettlementContract, ZNN_ZTS } from 'znn-typescript-sdk'
import { MissingSendError } from '../src/core/tx-tracker-service'
import recorded from './fixtures/gateway-go.json'

/**
 * A gateway transport that answers from the responses zeno-executor's
 * gateway recorded. It stands where HttpClient stands, so GatewayClient's
 * proof checks, root checks and error mapping all run for real.
 */
export interface RecordedCall {
  name: string
  method: string
  params: unknown[]
  response: { result?: unknown; error?: { code: number; message: string } }
}

export const calls = recorded.calls as unknown as RecordedCall[]

export const call = (name: string): RecordedCall => {
  const found = calls.find((c) => c.name === name)
  if (!found) throw new Error(`no recorded call named ${name}`)
  return found
}

export const result = <T = Record<string, any>>(name: string): T => // eslint-disable-line @typescript-eslint/no-explicit-any
  (call(name).response as { result: T }).result

/** A copy of a recorded call with its result edited, for a tampered or altered response. */
export function altered(name: string, edit: (result: Record<string, any>) => void): RecordedCall { // eslint-disable-line @typescript-eslint/no-explicit-any
  const source = call(name)
  const response = structuredClone(source.response) as { result: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
  edit(response.result)
  return { ...source, response }
}

/** A recorded call that answers a list method with an empty page. */
export function emptyPage(method: string, filter: Record<string, unknown>): RecordedCall {
  return {
    name: `${method} empty page`,
    method,
    params: [filter],
    response: { result: { batchId: 3, verified: true, items: [], nextCursor: null } },
  }
}

const withoutLatest = (params: unknown[]) => (params[params.length - 1] === 'latest' ? params.slice(0, -1) : params)

/** The request log and the transport. `extra` calls take precedence over the recording. */
export function replayClient(extra: RecordedCall[] = []) {
  const requests: { method: string; params: unknown[] }[] = []
  const client = {
    async sendRequest(method: string, params: unknown[] = []) {
      requests.push({ method, params })
      // The gateway reads at latest when the tag is left out, so the two requests are one.
      const match = [...extra, ...calls].find(
        (c) => c.method === method && isDeepStrictEqual(withoutLatest(c.params), withoutLatest(params))
      )
      if (!match) throw { code: -32601, message: `no recorded call for ${method} ${JSON.stringify(params)}` }
      if (match.response.error) throw match.response.error
      return match.response.result
    },
  } as Client
  return { client, requests }
}

/** Settlement entries built from the commitments the gateway returned for batches 0 and 3. */
const entryOf = (batch: Record<string, any>, isFinalized = false): SettlementBatchEntry => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  preStateRoot: Hash.parse(batch.preStateRoot),
  postStateRoot: Hash.parse(batch.postStateRoot),
  inputRoot: Hash.parse(batch.inputRoot),
  receiptRoot: Hash.parse(batch.receiptRoot),
  eventRoot: Hash.parse(batch.eventRoot),
  outboxRoot: Hash.parse(batch.outboxRoot),
  daHash: Hash.parse(batch.daHash),
  isFinalized,
})

export const settlementBatches = async (_domainId: number, batchId: number) => {
  const batches: Record<number, Record<string, any>> = { // eslint-disable-line @typescript-eslint/no-explicit-any
    0: result('getBatch by id'),
    3: result('getBatch latest'),
  }
  return batches[batchId] ? entryOf(batches[batchId]) : null
}

/**
 * The node's copy of a DeployContractFinalize send of the recorded
 * receipt's code to `domainId`, from the recorded sender with 1 ZNN.
 */
export const finalizeSend = (domainId: number): SendBlock => {
  const recordedReceipt = result('getReceipt success')
  const callData = SettlementContract.encodeCall('DeployContractFinalize', [domainId, '0x' + recordedReceipt.input.codeHash])
  return {
    blockType: BlockTypeEnum.UserSend,
    address: Address.parse(recordedReceipt.sender),
    toAddress: SETTLEMENT_ADDRESS,
    tokenStandard: ZNN_ZTS,
    amount: 1n,
    data: Uint8Array.from(Buffer.from(callData.replace(/^0x/, ''), 'hex')),
  }
}

/** The node's send blocks: the recorded send 04ee… on domain 1, and no other. */
export const recordedSends: SendSource = async (hash) => {
  if (hash.toString() !== result('getReceipt success').sendHash) throw new MissingSendError()
  return finalizeSend(1)
}
