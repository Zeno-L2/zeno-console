import { vi } from 'vitest'
import { Zenon } from 'znn-typescript-sdk'
import { GatewayClient, selectorOf, sha3 } from 'zeno-client'
import type { ContractInterface, SimulateResult } from 'zeno-client'
import { GatewayService } from '../gateway-service'
import { StubProvider } from '../stub-provider'
import { useWalletProvider } from './useWalletProvider'

export const CONTRACT_ID = '11'.repeat(32)
export const ADDRESS = 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

export const selectorHex = (name: string) => hex(selectorOf(name))

/** A hand-written interface in the interface_version 1 shape. */
export const iface: ContractInterface = {
  interface_version: 1,
  encoding: 'zeno-selector-v1',
  code_hash: '00'.repeat(32),
  methods: [
    {
      name: 'add',
      selector: selectorHex('add'),
      payable: true,
      readonly: false,
      inputs: [{ name: 'amount', type: 'u64' }],
      outputs: [{ name: 'total', type: 'u64' }],
    },
    {
      name: 'get',
      selector: selectorHex('get'),
      payable: false,
      readonly: true,
      inputs: [],
      outputs: [{ name: 'total', type: 'u64' }],
    },
  ],
  on_deposit: null,
  events: [
    {
      name: 'Added',
      topic: hex(sha3(new TextEncoder().encode('Added'))),
      fields: [{ name: 'amount', type: 'u64', indexed: false }],
    },
  ],
  errors: [{ code: 1, name: 'Overflow', fields: [{ name: 'limit', type: 'u64' }], description: 'The limit is reached.' }],
  storage: [],
}

export const simulation = (over: Partial<SimulateResult> = {}): SimulateResult => ({
  domainId: 1,
  batchId: 3,
  postStateRoot: '',
  verified: false,
  simulated: true,
  inputIndex: 14,
  momentumHeight: 100,
  momentumTime: 1,
  momentumHash: '',
  status: 'SUCCESS',
  gasUsed: 4000,
  abortCode: 0,
  contractId: CONTRACT_ID,
  codeHash: '22'.repeat(32),
  returnData: '0000000000000009',
  events: [],
  outbox: [],
  stateDiff: [],
  ...over,
})

export interface SimulateRig {
  requests: { method: string; params: unknown[] }[]
  /** What zeno_simulate answers, per tag. A missing tag answers -32002. */
  answers: Record<string, SimulateResult | { code: number; message: string }>
}

/** A gateway whose zeno_simulate answers from `rig.answers`, behind the real GatewayClient. */
export function useSimulateGateway(): SimulateRig {
  const rig: SimulateRig = { requests: [], answers: { latest: simulation() } }
  const client = {
    async sendRequest(method: string, params: unknown[] = []) {
      rig.requests.push({ method, params })
      if (method === 'zeno_simulate') {
        const tag = (params[2] as string | undefined) ?? 'latest'
        const answer = rig.answers[tag] ?? { code: -32002, message: 'tag is not served' }
        if ('code' in answer) throw answer
        return answer
      }
      throw { code: -32601, message: `unexpected ${method}` }
    },
  }
  const service = new GatewayService({ getBatch: async () => null } as never)
  vi.spyOn(service, 'client').mockResolvedValue(new GatewayClient(client as never))
  vi.spyOn(GatewayService, 'getInstance').mockReturnValue(service)
  return rig
}

/** Connects a stub wallet and returns it. */
export async function connectWallet(address = ADDRESS): Promise<StubProvider> {
  Zenon.setChainID(1)
  const stub = new StubProvider()
  stub.results.getAccounts = [address]
  window.zenon = stub
  await useWalletProvider().connect()
  return stub
}

export async function disconnectWallet(): Promise<void> {
  const stub = window.zenon as StubProvider | undefined
  if (stub) stub.results.getAccounts = []
  await useWalletProvider().disconnect()
  delete window.zenon
}

export interface StateRig {
  requests: { method: string; params: unknown[] }[]
  /** What zeno_getStateAt answers, per tag. A missing tag answers -32002. */
  answers: Record<string, { present: boolean; value: string | null; batchId?: number; verified?: boolean } | { code: number; message: string }>
}

/** A gateway whose zeno_getStateAt answers from `rig.answers`, behind the real GatewayClient. */
export function useStateGateway(): StateRig {
  const rig: StateRig = { requests: [], answers: { latest: { present: false, value: null } } }
  const client = {
    async sendRequest(method: string, params: unknown[] = []) {
      rig.requests.push({ method, params })
      if (method === 'zeno_getStateAt') {
        const tag = (params[2] as string | undefined) ?? 'latest'
        const answer = rig.answers[tag] ?? { code: -32002, message: 'tag is not served' }
        if ('code' in answer) throw answer
        return {
          domainId: params[0],
          batchId: answer.batchId ?? 7,
          verified: answer.verified ?? true,
          postStateRoot: '',
          path: params[1],
          present: answer.present,
          value: answer.value,
        }
      }
      throw { code: -32601, message: `unexpected ${method}` }
    },
  }
  const service = new GatewayService({ getBatch: async () => null } as never)
  vi.spyOn(service, 'client').mockResolvedValue(new GatewayClient(client as never))
  vi.spyOn(GatewayService, 'getInstance').mockReturnValue(service)
  return rig
}

/** An interface with a counter item and a vault-style map keyed by account and asset. */
export const stateIface: ContractInterface = {
  ...iface,
  storage: [
    { name: 'count', kind: 'item', namespace: '0x01', key: [], hashed: false, value: 'u64', description: 'An absent leaf is 0.' },
    {
      name: 'balances',
      kind: 'map',
      namespace: '0x02',
      key: [
        { name: 'account', type: 'hash' },
        { name: 'asset', type: 'bytes32' },
      ],
      hashed: true,
      value: 'u256',
      description: 'An absent leaf is a zero balance.',
    },
  ],
}
