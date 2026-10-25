import { computed, ref, shallowRef, unref } from 'vue'
import type { MaybeRef, Ref } from 'vue'
import { GatewayVerificationError, parseInterface } from 'zeno-client'
import type { ContractFeatures, ContractInterface, ContractView, DomainStatus, TagName, Verified, ReadResult } from 'zeno-client'
import { GatewayService } from '../gateway-service'
import { ContractRegistryService } from '../contract-registry-service'
import type { RegisteredContract } from '../contract-registry-service'
import { InterfaceResolver } from '../interface-resolver'

export interface UseContractOptions {
  /** The domain to read. */
  domainId: MaybeRef<number>
  /** The domain status for the badge. */
  domainStatus: Ref<DomainStatus | null>
}

/** One contract: its verified view, its interface and its module. */
export function useContract(contractId: MaybeRef<string>, options: UseContractOptions) {
  const gateway = GatewayService.getInstance()
  const registry = ContractRegistryService.getInstance()

  const tag = ref<TagName>('latest')
  /** The tag that answered. It differs from `tag` when `pending` fell back to `latest`. */
  const answeredTag = ref<TagName>('latest')
  const view = ref<Verified<ReadResult<ContractView>> | null>(null)
  const registered = ref<RegisteredContract | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  /** The error thrown by the last failed load, for callers that map its class. */
  const cause = shallowRef<unknown>(null)
  const failedCheck = ref(false)
  const features = ref<ContractFeatures | null>(null)
  const interfaceEncodings = ref<string[]>([])
  /** An interface known for the contract's code, used when none is saved for the contract itself. */
  const codeIface = shallowRef<ContractInterface | null>(null)

  const domainId = computed(() => unref(options.domainId))
  const id = computed(() => unref(contractId).toLowerCase())
  const exists = computed(() => view.value?.result.codeHash != null)

  // Only the latest load may write state, so a slow read of an earlier id or tag cannot overwrite a newer one.
  let loadId = 0

  async function load() {
    const run = ++loadId
    isLoading.value = true
    error.value = null
    cause.value = null
    failedCheck.value = false
    try {
      const domain = domainId.value
      const saved = await registry.get(domain, id.value)
      if (run !== loadId) return
      registered.value = saved
      const contracts = await (await gateway.client()).contracts(domain)
      if (run !== loadId) return
      features.value = contracts.features
      interfaceEncodings.value = contracts.interfaceEncodings
      const { value, tag: used } = await gateway.withTagFallback(tag.value, (t) => contracts.contract(id.value, t))
      if (run !== loadId) return
      view.value = value
      answeredTag.value = used as TagName
      const sourceCodeHash = value.result.sourceCodeHash?.toLowerCase()
      const known = sourceCodeHash ? (await InterfaceResolver.getInstance().byCodeHash()).get(sourceCodeHash) : undefined
      if (run !== loadId) return
      codeIface.value = known ?? null
    } catch (err) {
      if (run !== loadId) return
      failedCheck.value = err instanceof GatewayVerificationError
      cause.value = err
      error.value = err instanceof Error ? err.message : 'The contract could not be read.'
    } finally {
      if (run === loadId) isLoading.value = false
    }
  }

  /** Fetches the module, which the client checks against its `code_hash`, and offers it as a download. */
  async function downloadModule(): Promise<void> {
    const sourceCodeHash = view.value?.result.sourceCodeHash
    if (!sourceCodeHash) throw new Error('The contract has no module to download.')
    const contracts = await (await gateway.client()).contracts(domainId.value)
    const { module } = await contracts.module(sourceCodeHash)
    const url = URL.createObjectURL(new Blob([module as BlobPart], { type: 'application/wasm' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${sourceCodeHash}.wasm`
    link.click()
    URL.revokeObjectURL(url)
  }

  /** Stores an interface file for the contract after checking its `code_hash`. */
  async function importInterface(file: File): Promise<void> {
    const sourceCodeHash = view.value?.result.sourceCodeHash
    if (!sourceCodeHash) throw new Error('Load the contract first.')
    const iface = parseInterface(JSON.parse(await file.text()))
    registered.value = await registry.setInterface(domainId.value, id.value, iface, sourceCodeHash)
  }

  /** Adds the contract to the local registry. */
  async function register(name?: string) {
    registered.value = await registry.add({
      contractId: id.value,
      domainId: domainId.value,
      name,
      sourceCodeHash: view.value?.result.sourceCodeHash ?? undefined,
    })
  }

  const domainStatus = options.domainStatus
  const iface = computed(() => registered.value?.iface ?? codeIface.value)
  /** Where `iface` comes from: saved for this contract, or known for the code it runs. */
  const ifaceSource = computed<'saved' | 'code' | null>(() =>
    registered.value?.iface ? 'saved' : codeIface.value ? 'code' : null
  )

  return { id, domainId, features, interfaceEncodings, iface, ifaceSource, tag, answeredTag, view, registered, exists, isLoading, error, cause, failedCheck, domainStatus, load, downloadModule, importInterface, register }
}
