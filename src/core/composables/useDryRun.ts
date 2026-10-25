import { ref, shallowRef, watch } from 'vue'
import type { Ref, ShallowRef } from 'vue'
import { TokenStandard, ZNN_ZTS, settlement } from 'znn-typescript-sdk'
import { prepareCall } from 'zeno-client'
import type { ContractInterface } from 'zeno-client'
import { describeSimulation } from '../receipt'
import { parseArgs } from '../arg-parser'
import { useSettings } from './useSettings'
import type { ReceiptDetails } from '../receipt'
import {
  RunnerUnreachableError,
  runCommands,
  runnerVersion,
  toSimulateResult,
} from '../local-runner'
import type { RunnerCommand, RunnerResult, RunnerVersion } from '../local-runner'

export const DRY_RUN_STORAGE_BYTES = 65536
/** 0x00 then 19 bytes of 0x01: a user address that is not zero. */
export const DRY_RUN_SENDER = '00' + '01'.repeat(19)
/** 64 commands per request, minus the deploy and the storage purchase. */
export const MAX_DRY_RUN_STEPS = 62

export interface DryRunStep {
  id: number
  kind: 'deposit' | 'call'
  /** Call only. */
  method: string
  /** Call only. One text per input of the method. */
  argTexts: string[]
  /** Call only, when the module has no interface file: the payload as hex. */
  payloadHex: string
  token: string
  /** In base units. Optional for a call. */
  amount: string
}

export interface DryRunRow {
  label: string
  details: ReceiptDetails | null
  error: string | null
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const WHOLE = /^\d+$/
const HEX_PAYLOAD = /^(0x)?([0-9a-fA-F]{2})*$/

/** Runs a module and a list of steps in `zeno-exec serve` without sending anything. */
export function useDryRun(
  moduleBytes: Ref<Uint8Array | null>,
  iface: Ref<ContractInterface | null>
) {
  const { settings } = useSettings()
  const steps = ref<DryRunStep[]>([])
  // shallow: ReceiptDetails holds recursive Value types that deep ref unwrapping cannot type
  const rows: ShallowRef<DryRunRow[]> = shallowRef([])
  const isRunning = ref(false)
  const error = ref<string | null>(null)
  const unreachable = ref(false)
  const version = ref<RunnerVersion | null>(null)
  let nextId = 1

  // Results never describe another module or interface.
  watch([moduleBytes, iface], () => {
    rows.value = []
  })

  function addStep(kind: 'deposit' | 'call') {
    if (steps.value.length >= MAX_DRY_RUN_STEPS) return
    const method = kind === 'call' ? (iface.value?.methods[0]?.name ?? '') : ''
    steps.value = [
      ...steps.value,
      {
        id: nextId++,
        kind,
        method,
        argTexts: inputsOf(method).map(() => ''),
        payloadHex: '',
        token: ZNN_ZTS.toString(),
        amount: '',
      },
    ]
  }

  function inputsOf(method: string) {
    return iface.value?.methods.find((m) => m.name === method)?.inputs ?? []
  }

  function removeStep(id: number) {
    steps.value = steps.value.filter((s) => s.id !== id)
  }

  function selectMethod(id: number, name: string) {
    steps.value = steps.value.map((s) =>
      s.id === id ? { ...s, method: name, argTexts: inputsOf(name).map(() => '') } : s
    )
  }

  function assetIdOf(token: string): string | null {
    try {
      return settlement.assetIdFromZts(TokenStandard.parse(token)).toString()
    } catch {
      return null
    }
  }

  /** The call payload as lowercase hex, or the reason there is none. */
  function payloadOf(
    step: DryRunStep
  ): { hex: string; problem: null } | { hex: null; problem: string } {
    const ifc = iface.value
    if (ifc) {
      const method = ifc.methods.find((m) => m.name === step.method)
      if (!method) return { hex: null, problem: 'Choose a method.' }
      const args = parseArgs(method.inputs, step.argTexts)
      if (!args.values) return { hex: null, problem: 'Fix the arguments.' }
      try {
        return { hex: hex(prepareCall(ifc, method.name, args.values)), problem: null }
      } catch (err) {
        return {
          hex: null,
          problem: err instanceof Error ? err.message : 'The payload could not be encoded.',
        }
      }
    }
    const text = step.payloadHex.trim()
    if (!HEX_PAYLOAD.test(text)) return { hex: null, problem: 'Enter the payload as hex.' }
    return { hex: text.replace(/^0x/i, '').toLowerCase(), problem: null }
  }

  function stepProblem(step: DryRunStep): string | null {
    if (assetIdOf(step.token) === null)
      return 'Enter a token standard, for example zts1znnxxxxxxxxxxxxx9z4ulx.'
    const amount = step.amount.trim()
    if (step.kind === 'deposit') {
      if (!WHOLE.test(amount) || BigInt(amount) === 0n) {
        return 'Enter the deposit in base units, a whole number above zero.'
      }
      return null
    }
    if (amount !== '' && !WHOLE.test(amount))
      return 'Enter the deposit in base units, or leave it empty.'
    return payloadOf(step).problem
  }

  async function run() {
    rows.value = []
    error.value = null
    unreachable.value = false
    const bytes = moduleBytes.value
    const ifc = iface.value
    if (!bytes) {
      error.value = 'Load a module first.'
      return
    }
    // Edits made while the run is in flight do not reach the commands.
    const planned = steps.value.map((s) => ({ ...s, argTexts: [...s.argTexts] }))
    for (const [i, step] of planned.entries()) {
      const problem = stepProblem(step)
      if (problem) {
        error.value = `Step ${i + 1}: ${problem}`
        return
      }
    }
    const stale = () => moduleBytes.value !== bytes || iface.value !== ifc
    isRunning.value = true
    try {
      const url = settings.value.localRunnerUrl
      const runnerInfo = await runnerVersion(url)
      if (stale()) return
      version.value = runnerInfo

      const deploy: RunnerCommand = {
        op: 'deploy',
        sender: DRY_RUN_SENDER,
        module: hex(bytes),
        metadata: 'immutable',
      }
      const [first] = await runCommands(url, [deploy])
      if (stale()) return
      if (!first.ok || first.receipt.status !== 'SUCCESS' || !first.contractId) {
        rows.value = [rowOf('Deploy', first, ifc)]
        return
      }
      const contractId = first.contractId

      const commands: RunnerCommand[] = [
        deploy,
        { op: 'buyStorage', sender: DRY_RUN_SENDER, contractId, bytes: DRY_RUN_STORAGE_BYTES },
      ]
      const labels = ['Deploy', `Buy ${DRY_RUN_STORAGE_BYTES} bytes of storage`]
      const payloads: (string | undefined)[] = [undefined, undefined]
      for (const step of planned) {
        const amount = step.amount.trim() === '' ? 0n : BigInt(step.amount.trim())
        const asset = assetIdOf(step.token) as string
        if (step.kind === 'deposit') {
          commands.push({
            op: 'deposit',
            sender: DRY_RUN_SENDER,
            contractId,
            asset,
            amount: amount.toString(),
          })
          labels.push('Deposit')
          payloads.push(undefined)
          continue
        }
        const payload = payloadOf(step).hex as string
        commands.push({
          op: 'call',
          sender: DRY_RUN_SENDER,
          contractId,
          payload,
          ...(amount > 0n ? { deposit: { asset, amount: amount.toString() } } : {}),
        })
        labels.push(ifc ? `Call ${step.method}` : 'Call (raw payload)')
        payloads.push(payload)
      }

      const results = await runCommands(url, commands)
      if (stale()) return
      const second = results[0]
      if (!second.ok || second.contractId !== contractId) {
        error.value = 'zeno-exec gave a different contract id on the second run.'
      }
      rows.value = results.map((result, i) => rowOf(labels[i], result, ifc, payloads[i]))
    } catch (err) {
      if (stale()) return
      if (err instanceof RunnerUnreachableError) unreachable.value = true
      else error.value = err instanceof Error ? err.message : 'The dry run failed.'
    } finally {
      isRunning.value = false
    }
  }

  return {
    steps,
    rows,
    isRunning,
    error,
    unreachable,
    version,
    addStep,
    removeStep,
    selectMethod,
    stepProblem,
    assetIdOf,
    run,
  }
}

function rowOf(
  label: string,
  result: RunnerResult,
  ifc: ContractInterface | null,
  payload?: string
): DryRunRow {
  if (!result.ok)
    return { label, details: null, error: `${result.error.kind}: ${result.error.message}` }
  return {
    label,
    details: describeSimulation(toSimulateResult(result.receipt), ifc, payload),
    error: null,
  }
}
