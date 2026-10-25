import { computed, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'
import { Hash, TokenStandard, ZNN_ZTS, extractNumberDecimals, settlement } from 'znn-typescript-sdk'
import { prepareCall } from 'zeno-client'
import type { ContractFeatures, ContractInterface, SimulateResult, TagName } from 'zeno-client'
import { AccountService } from '../account-service'
import { GatewayService } from '../gateway-service'
import { describeSimulation } from '../receipt'
import { parseArgs } from '../arg-parser'
import type { ReceiptDetails } from '../receipt'
import { SettlementWriteService } from '../settlement-write-service'
import { loadWallet } from '../wallet-loader'
import { useWalletProvider } from './useWalletProvider'

/** The address a read is simulated from when no wallet is connected. */
const ANONYMOUS_SENDER = 'z1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsggv2f'

/** Margin added to a simulated gas figure when suggesting a limit. */
const GAS_MARGIN = 1.25

export const DEFAULT_PLASMA_LIMIT = '1000000'

export interface CallContext {
  domainId: Ref<number>
  contractId: Ref<string>
  iface: Ref<ContractInterface | null>
  features: Ref<ContractFeatures | null>
  tag: Ref<TagName>
}

const fromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'))

/** Encodes, simulates and sends calls to one contract. */
export function useContractCall(ctx: CallContext) {
  const wallet = useWalletProvider()
  const writer = SettlementWriteService.getInstance()

  const methodName = ref('')
  const argTexts = ref<string[]>([])
  const rawPayload = ref('')
  const plasmaLimit = ref(DEFAULT_PLASMA_LIMIT)
  const depositEnabled = ref(false)
  const depositToken = ref(ZNN_ZTS.toString())
  const depositAmount = ref('')

  const simulation = ref<SimulateResult | null>(null)
  // shallow: Value is a recursive type that deep ref unwrapping cannot type
  const details = shallowRef<ReceiptDetails | null>(null)
  /** The tag that answered the last simulation. */
  const simulatedAt = ref<TagName>('latest')
  const isSimulating = ref(false)
  const isSending = ref(false)
  const error = ref<string | null>(null)
  const sentHash = ref<string | null>(null)

  const hasInterface = computed(() => ctx.iface.value !== null)
  const method = computed(() => ctx.iface.value?.methods.find((m) => m.name === methodName.value) ?? null)
  const methodParams = computed(() => method.value?.inputs ?? [])
  const isReadMethod = computed(() => method.value?.readonly === true)
  const canDeposit = computed(() => ctx.features.value?.payableCalls === true && (method.value ? method.value.payable !== false : true))

  function selectMethod(name: string) {
    methodName.value = name
    argTexts.value = (ctx.iface.value?.methods.find((m) => m.name === name)?.inputs ?? []).map(() => '')
    simulation.value = null
    details.value = null
    sentHash.value = null
  }

  const args = computed(() => parseArgs(methodParams.value, argTexts.value))

  /** The payload bytes, or the reason there are none yet. */
  const payload = computed<{ bytes: Uint8Array | null; problem: string | null }>(() => {
    if (hasInterface.value) {
      if (!method.value) return { bytes: null, problem: 'Choose a method.' }
      if (!args.value.values) return { bytes: null, problem: 'Fix the arguments first.' }
      try {
        return { bytes: prepareCall(ctx.iface.value as ContractInterface, method.value.name, args.value.values), problem: null }
      } catch (err) {
        return { bytes: null, problem: err instanceof Error ? err.message : 'The payload could not be encoded.' }
      }
    }
    const hex = rawPayload.value.trim().replace(/^0x/i, '')
    if (!/^([0-9a-fA-F]{2})*$/.test(hex)) return { bytes: null, problem: 'Enter the payload as hex.' }
    const bytes = fromHex(hex)
    if (bytes.length > settlement.MaxCallPayload) {
      return { bytes: null, problem: `The payload is ${bytes.length} bytes, above MaxCallPayload ${settlement.MaxCallPayload}.` }
    }
    return { bytes, problem: null }
  })

  const payloadSize = computed(() => payload.value.bytes?.length ?? 0)

  const plasma = computed<{ value: bigint | null; problem: string | null }>(() => {
    const text = plasmaLimit.value.trim()
    if (!/^\d+$/.test(text)) return { value: null, problem: 'Enter the plasma limit as a whole number.' }
    const value = BigInt(text)
    if (value > settlement.MaxInputGas) return { value: null, problem: `The plasma limit is above MaxInputGas ${settlement.MaxInputGas}.` }
    return { value, problem: null }
  })

  /** The deposit as base units, or the reason it cannot be built. */
  async function deposit(): Promise<{ token: TokenStandard; amount: bigint } | null> {
    if (!depositEnabled.value || depositAmount.value.trim() === '') return null
    const decimals = await AccountService.getInstance().getTokenDecimals(depositToken.value)
    if (decimals === null) throw new Error('The deposit token does not exist.')
    const amount = extractNumberDecimals(depositAmount.value.trim(), decimals)
    if (amount <= 0n) throw new Error('Enter a deposit above zero.')
    return { token: TokenStandard.parse(depositToken.value), amount }
  }

  /** The L1 plasma the send needs, from the size of its calldata. */
  const l1Plasma = computed(() => {
    if (!payload.value.bytes || plasma.value.value === null) return null
    try {
      const template = writer.callL2(ctx.domainId.value, Hash.parse(ctx.contractId.value), plasma.value.value, payload.value.bytes)
      return settlement.sendPlasma(template.data.length)
    } catch {
      return null
    }
  })

  const suggestedPlasma = computed(() => {
    const gas = simulation.value?.gasUsed
    if (gas === undefined || gas <= 0) return null
    const suggested = BigInt(Math.ceil(gas * GAS_MARGIN))
    return suggested > settlement.MaxInputGas ? settlement.MaxInputGas : suggested
  })

  function applySuggestedPlasma() {
    if (suggestedPlasma.value !== null) plasmaLimit.value = suggestedPlasma.value.toString()
  }

  const canSimulate = computed(() => payload.value.bytes !== null && plasma.value.value !== null)

  /** Simulates the call at the selected tag. A remote gateway answers `pending` from `latest`. */
  async function simulate() {
    const domainId = ctx.domainId.value
    const contractId = ctx.contractId.value
    error.value = null
    if (!payload.value.bytes || plasma.value.value === null) {
      error.value = payload.value.problem ?? plasma.value.problem
      return
    }
    isSimulating.value = true
    try {
      const dep = await deposit()
      const service = GatewayService.getInstance()
      const client = await service.client()
      const { value, tag } = await service.withTagFallback(ctx.tag.value, (t) =>
        client.simulate(
          domainId,
          {
            kind: 'CallL2',
            sender: wallet.address.value ?? ANONYMOUS_SENDER,
            targetContract: contractId,
            payload: Buffer.from(payload.value.bytes as Uint8Array).toString('hex'),
            deposit: dep ? { asset: dep.token.toString(), amount: dep.amount.toString() } : undefined,
            plasmaLimit: plasma.value.value as bigint,
          },
          t
        )
      )
      simulation.value = value
      simulatedAt.value = tag as TagName
      details.value = describeSimulation(value, ctx.iface.value, Buffer.from(payload.value.bytes).toString('hex'))
    } catch (err) {
      simulation.value = null
      details.value = null
      error.value = err instanceof Error ? err.message : 'The simulation failed.'
    } finally {
      isSimulating.value = false
    }
  }

  /** Previews the call, then asks the wallet to sign it. A simulated revert does not stop the send. */
  async function send() {
    const domainId = ctx.domainId.value
    const contractId = ctx.contractId.value
    error.value = null
    sentHash.value = null
    if (!wallet.isConnected.value) {
      error.value = 'Connect a wallet first.'
      return
    }
    if (!payload.value.bytes || plasma.value.value === null) {
      error.value = payload.value.problem ?? plasma.value.problem
      return
    }
    isSending.value = true
    try {
      const dep = await deposit()
      const template = writer.callL2(
        domainId,
        Hash.parse(contractId),
        plasma.value.value,
        payload.value.bytes,
        dep ?? undefined
      )
      const published = await (await loadWallet()).send(template)
      const hash = (published as { hash?: unknown } | null)?.hash
      sentHash.value = typeof hash === 'string' ? hash : null
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'The send failed.'
    } finally {
      isSending.value = false
    }
  }

  return {
    methodName,
    argTexts,
    rawPayload,
    plasmaLimit,
    depositEnabled,
    depositToken,
    depositAmount,
    hasInterface,
    method,
    methodParams,
    isReadMethod,
    canDeposit,
    args,
    payload,
    payloadSize,
    plasma,
    l1Plasma,
    suggestedPlasma,
    simulation,
    details,
    simulatedAt,
    isSimulating,
    isSending,
    error,
    sentHash,
    canSimulate,
    selectMethod,
    applySuggestedPlasma,
    simulate,
    send,
  }
}
