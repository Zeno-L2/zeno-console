import { computed, ref, shallowRef } from 'vue'
import { Address, settlement } from 'znn-typescript-sdk'
import { parseInterface, prepareDeploy, sha3 } from 'zeno-client'
import type { ContractInterface } from 'zeno-client'
import type { SettlementDeployRecord } from 'znn-typescript-sdk'
import { AccountService } from '../account-service'
import { SettlementService } from '../settlement-service'
import type { StepItem } from 'nom-ui'
import { DeployService, createDeployService } from '../deploy-service'
import type { DeployJournal, DeployPhase, PreflightProblem } from '../deploy-service'
import { SettlementWriteService } from '../settlement-write-service'
import { useWalletProvider } from './useWalletProvider'

export type DeployStepNumber = 1 | 2 | 3 | 4 | 5
export type UpgradePolicyName = 'IMMUTABLE' | 'OWNER_UPGRADEABLE'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

// Module-level reactive state, shared across every useDeploy() caller
const step = ref<DeployStepNumber>(1)
const mode = ref<'deploy' | 'upgrade'>('deploy')
const upgradeContractId = ref<string | null>(null)
const moduleFile = ref<File | null>(null)
const moduleBytes = shallowRef<Uint8Array | null>(null)
const interfaceFile = ref<File | null>(null)
const iface = shallowRef<ContractInterface | null>(null)
/** The encodings the domain accepts, when known. Null skips the check. */
const acceptedEncodings = ref<string[] | null>(null)
const loadError = ref<string | null>(null)
const interfaceError = ref<string | null>(null)
const policy = ref<UpgradePolicyName>('IMMUTABLE')
const owner = ref('')
const plan = shallowRef<settlement.DeployPlan | null>(null)
/** The domain the plan was checked against. `send()` and `retry()` use it. */
const plannedDomainId = ref<number | null>(null)
const records = shallowRef<SettlementDeployRecord[]>([])
const metadata = shallowRef<Uint8Array>(new Uint8Array(0))
const availablePlasma = ref(0)
const problems = ref<PreflightProblem[]>([])
const journal = ref<DeployJournal | null>(null)
const pending = ref<DeployJournal[]>([])
const phase = ref<DeployPhase>('idle')
const error = ref<string | null>(null)
const isBuilding = ref(false)

let service: DeployService | null = null
// Only the latest loadRecords() call may write `records`.
let recordsRequest = 0
// clearPlan() moves it, so a build that started before cannot write its plan.
let planRequest = 0

/** Replaces the live service. Tests use it. */
export function setDeployService(next: DeployService | null) {
  service = next
}

function deployService(): DeployService {
  if (!service) {
    service = createDeployService({
      reads: SettlementService.getInstance(),
      accounts: { getBalance: (address) => AccountService.getInstance().getBalance(address) },
    })
  }
  return service
}

export function useDeploy() {
  const wallet = useWalletProvider()

  const moduleHash = computed(() => (moduleBytes.value ? hex(sha3(moduleBytes.value)) : null))

  async function loadModule(file: File | null) {
    loadError.value = null
    moduleFile.value = file
    moduleBytes.value = null
    clearPlan()
    if (!file) return
    if (file.size > settlement.MaxCodeSize) {
      loadError.value = `The module is ${file.size} bytes, above the ${settlement.MaxCodeSize} byte limit.`
      return
    }
    moduleBytes.value = new Uint8Array(await file.arrayBuffer())
    if (iface.value) checkInterface()
  }

  function checkInterface() {
    interfaceError.value = null
    const f = iface.value
    if (!f) return
    if (moduleHash.value && f.code_hash.toLowerCase() !== moduleHash.value) {
      interfaceError.value = 'The interface file belongs to a different module: its code_hash does not match.'
    } else if (acceptedEncodings.value && !acceptedEncodings.value.includes(f.encoding)) {
      interfaceError.value = `The domain does not accept the ${f.encoding} encoding.`
    }
  }

  async function loadInterface(file: File | null) {
    interfaceError.value = null
    interfaceFile.value = file
    iface.value = null
    if (!file) return
    try {
      iface.value = parseInterface(JSON.parse(await file.text()))
      checkInterface()
    } catch (err) {
      interfaceError.value = err instanceof Error ? err.message : 'The interface file could not be read.'
    }
  }

  /** A journal is finished when its last step is published. */
  const isFinished = (j: DeployJournal) => j.steps[j.steps.length - 1].status === 'published'

  /** Lists the journals that did not finish, so the page can offer to resume them. */
  async function loadPending() {
    const all = await deployService().journals()
    pending.value = all.filter((j) => !isFinished(j))
  }

  /** Reads the connected address's unfinished deploy records on L1 in `domainId`. */
  async function loadRecords(domainId: number) {
    const request = ++recordsRequest
    const address = wallet.address.value
    if (!address) {
      records.value = []
      return
    }
    try {
      const list = (await SettlementService.getInstance().getDeployRecords(domainId, address)).list
      if (request === recordsRequest) records.value = list
    } catch {
      if (request === recordsRequest) records.value = []
    }
  }

  /** Drops the plan and the domain it was checked against. */
  function clearPlan() {
    planRequest++
    isBuilding.value = false
    plan.value = null
    plannedDomainId.value = null
  }

  function configureUpgrade(contractId: string | null) {
    mode.value = contractId ? 'upgrade' : 'deploy'
    upgradeContractId.value = contractId
  }

  /**
   * Builds the plan from the module, the configuration and the live
   * prices, then runs the preflight checks against `domainId`. Moves to
   * the review step.
   */
  async function buildPlan(domainId: number) {
    error.value = null
    const address = wallet.address.value
    const bytes = moduleBytes.value
    if (!address) {
      error.value = 'Connect a wallet first.'
      return
    }
    if (!bytes) {
      error.value = 'Load a module first.'
      return
    }
    clearPlan()
    const request = planRequest
    isBuilding.value = true
    try {
      const settlementReads = SettlementService.getInstance()
      const periphery = await settlementReads.getPeripheryConfig()
      if (request !== planRequest) return
      const info = await AccountService.getInstance().getPlasma(address)
      if (request !== planRequest) return
      availablePlasma.value = info.currentPlasma

      let deployBytes = bytes
      if (mode.value === 'deploy') {
        deployBytes = prepareDeploy(bytes, iface.value ?? undefined, {
          interfaceEncodings: acceptedEncodings.value ?? undefined,
        })
        const ownerAddress = policy.value === 'OWNER_UPGRADEABLE' ? Address.parse(owner.value || address) : Address.parse(address)
        metadata.value = SettlementWriteService.getInstance().deployMetadata(
          policy.value === 'OWNER_UPGRADEABLE'
            ? settlement.UpgradePolicy.OWNER_UPGRADEABLE
            : settlement.UpgradePolicy.IMMUTABLE,
          policy.value === 'OWNER_UPGRADEABLE' ? ownerAddress : Address.fromCore(Buffer.alloc(20))
        )
      } else {
        metadata.value = new Uint8Array(0)
      }

      const built = SettlementWriteService.getInstance().planDeploy({
        module: deployBytes,
        metadata: metadata.value,
        znnPerByteOfBytecode: periphery?.znnPerByteOfBytecode ?? 0n,
        availablePlasma: info.currentPlasma,
      })
      const found = await deployService().preflight({
        domainId,
        deployer: address,
        fee: built.fee,
      })
      if (request !== planRequest) return
      plan.value = built
      plannedDomainId.value = domainId
      problems.value = found
      step.value = 3
    } catch (err) {
      if (request !== planRequest) return
      error.value = err instanceof Error ? err.message : 'The deploy could not be planned.'
    } finally {
      if (request === planRequest) isBuilding.value = false
    }
  }

  /** Starts the sends to the planned domain. Needs a plan with no preflight problem. */
  async function send() {
    const address = wallet.address.value
    const domainId = plannedDomainId.value
    if (!plan.value || !address || domainId === null) return
    error.value = null
    step.value = 4
    phase.value = 'sending'
    try {
      const svc = deployService()
      const stored = await svc.journal(
        `${domainId}:${address}:${plan.value.codeHash.toString()}`
      )
      const existing = stored && !isFinished(stored) ? stored : null
      journal.value =
        existing ??
        (await svc.begin({
          kind: mode.value,
          domainId,
          deployer: address,
          plan: plan.value,
          metadata: metadata.value,
          contractId: upgradeContractId.value ?? undefined,
        }))
      phase.value = await svc.resume(journal.value, plan.value, { onUpdate: (j) => (journal.value = { ...j }) })
      if (phase.value === 'submitted') step.value = 5
    } catch (err) {
      phase.value = 'failed'
      error.value = err instanceof Error ? err.message : 'The deploy failed.'
    }
  }

  /** Retries from the first step that is not published. */
  async function retry() {
    await send()
  }

  async function discard() {
    if (journal.value) await deployService().remove(journal.value.id)
    reset()
    await loadPending()
  }

  /** Drops one unfinished journal from this browser and refreshes the list. */
  async function discardPending(id: string) {
    await deployService().remove(id)
    await loadPending()
  }

  function reset() {
    step.value = 1
    moduleFile.value = null
    moduleBytes.value = null
    interfaceFile.value = null
    iface.value = null
    loadError.value = null
    interfaceError.value = null
    clearPlan()
    problems.value = []
    journal.value = null
    phase.value = 'idle'
    error.value = null
  }

  const stepItems = computed<StepItem[]>(() =>
    (journal.value?.steps ?? []).map((s) => ({
      id: s.id,
      title:
        s.kind === 'start'
          ? 'Start deploy'
          : s.kind === 'chunk'
            ? `Chunk ${(s.index ?? 0) + 1} of ${journal.value?.chunkCount}`
            : s.kind === 'finalize'
              ? 'Finalize'
              : 'Upgrade contract',
      description: s.error ?? (s.hash ? `Published as ${s.hash.slice(0, 10)}...` : s.status === 'approving' ? 'Waiting for wallet approval' : undefined),
      state: s.status === 'waiting' ? 'waiting' : s.status === 'approving' ? 'active' : s.status === 'published' ? 'done' : 'failed',
    }))
  )

  const blocked = computed(() => problems.value.length > 0)

  return {
    step,
    mode,
    upgradeContractId,
    moduleFile,
    moduleBytes,
    moduleHash,
    interfaceFile,
    iface,
    acceptedEncodings,
    loadError,
    interfaceError,
    policy,
    owner,
    plan,
    plannedDomainId,
    records,
    availablePlasma,
    problems,
    blocked,
    journal,
    pending,
    phase,
    error,
    isBuilding,
    stepItems,
    loadModule,
    loadInterface,
    loadPending,
    loadRecords,
    clearPlan,
    configureUpgrade,
    buildPlan,
    send,
    retry,
    discard,
    discardPending,
    reset,
  }
}
