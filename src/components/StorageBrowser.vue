<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionItem,
  Field,
  FieldError,
  FieldLabel,
  HexView,
  Input,
  Skeleton,
} from 'nom-ui'
import { RefreshCwIcon } from '@lucide/vue'
import { GatewayVerificationError, UnsupportedEncodingError, interfaceEncoderFor } from 'zeno-client'
import type { ContractInterface, DomainStatus, InterfaceEncoder, Param, TagName, VerificationReport, Value } from 'zeno-client'
import { GatewayService, formatValue, parseArgs } from '@/core'
import { VerificationBadge } from '@/components'

const props = defineProps<{
  domainId: number
  contractId: string
  iface: ContractInterface | null
  tag: TagName
  domainStatus: DomainStatus | null
}>()

interface Entry {
  name: string
  kind: 'item' | 'map' | 'raw'
  description?: string
  valueType?: string
  key: Param[]
}

interface Read {
  present: boolean
  /** The decoded value. Null when the path is absent, undecoded or unreadable. */
  value: Value | null
  /** The stored bytes as hex, for the raw fallback. */
  hex: string | null
  batchId: number | null
  verified: boolean
  check?: VerificationReport
  failed: boolean
  answeredTag: TagName
  error: string | null
  isLoading: boolean
}

const RAW = 'localKey'

/** The encoder for the interface, or null when there is no interface or the SDK has no encoder for it. */
const encoder = computed<InterfaceEncoder | null>(() => {
  if (!props.iface) return null
  try {
    return interfaceEncoderFor(props.iface.encoding)
  } catch (err) {
    if (err instanceof UnsupportedEncodingError) return null
    throw err
  }
})

const cards = computed<Entry[]>(() =>
  encoder.value && props.iface
    ? props.iface.storage.map((def) => ({
        name: def.name,
        kind: def.kind,
        description: def.description,
        valueType: def.value,
        key: def.key,
      }))
    : [{ name: RAW, kind: 'raw', key: [{ name: RAW, type: 'bytes' }] }]
)

const texts = reactive<Record<string, string[]>>({})
const reads = shallowRef<Record<string, Read>>({})
const attempts: Record<string, number> = {}

const textsOf = (card: Entry) => texts[card.name] ?? card.key.map(() => '')
function setText(card: Entry, index: number, text: string) {
  const next = [...textsOf(card)]
  next[index] = text
  texts[card.name] = next
}

/** The parse errors of a card's key fields, one per field, or null where the field is fine. */
const keyErrors = (card: Entry): (string | null)[] =>
  card.kind === 'raw' ? [rawKey(textsOf(card)[0] ?? '') ? null : 'Enter 1 to 32 bytes as hex.'] : parseArgs(card.key, textsOf(card)).errors

const rawKey = (text: string) => {
  const hex = text.trim().replace(/^0x/i, '')
  return /^([0-9a-fA-F]{2}){1,32}$/.test(hex) ? hex.toLowerCase() : null
}

/** The local key of a card as hex, or null while its key fields do not parse. */
function localKeyOf(card: Entry): string | null {
  if (card.kind === 'raw') return rawKey(textsOf(card)[0] ?? '')
  const { values } = parseArgs(card.key, textsOf(card))
  if (!values || !encoder.value || !props.iface) return null
  return Buffer.from(encoder.value.storageKey(props.iface, card.name, values)).toString('hex')
}

const canRead = (card: Entry) => localKeyOf(card) !== null

function set(name: string, patch: Partial<Read>) {
  const current: Read = reads.value[name] ?? {
    present: false,
    value: null,
    hex: null,
    batchId: null,
    verified: false,
    failed: false,
    answeredTag: props.tag,
    error: null,
    isLoading: false,
  }
  reads.value = { ...reads.value, [name]: { ...current, ...patch } }
}

/** Reads one path at the selected tag. A remote gateway answers `pending` from `latest`. */
async function read(card: Entry): Promise<void> {
  const localKey = localKeyOf(card)
  if (localKey === null) return
  const domain = props.domainId
  const contractId = props.contractId
  const attempt = (attempts[card.name] = (attempts[card.name] ?? 0) + 1)
  const stale = () => attempts[card.name] !== attempt || domain !== props.domainId || contractId !== props.contractId
  set(card.name, { isLoading: true, error: null, failed: false })
  try {
    const service = GatewayService.getInstance()
    const contracts = await (await service.client()).contracts(domain)
    const { value: view, tag } = await service.withTagFallback(props.tag, (t) => contracts.storage(contractId, localKey, t))
    if (stale()) return
    const base = {
      batchId: view.batchId,
      verified: view.verified,
      check: view.check,
      answeredTag: tag as TagName,
      isLoading: false,
    }
    const stored = view.result.value
    if (!view.result.present || stored === null) {
      set(card.name, { ...base, present: false, value: null, hex: null })
      return
    }
    if (card.kind === 'raw' || !encoder.value || !props.iface) {
      set(card.name, { ...base, present: true, value: null, hex: stored })
      return
    }
    try {
      const decoded = encoder.value.decodeStorageValue(props.iface, card.name, Uint8Array.from(Buffer.from(stored, 'hex')))
      set(card.name, { ...base, present: true, value: decoded, hex: stored })
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'It could not be decoded.'
      set(card.name, {
        ...base,
        present: true,
        value: null,
        hex: stored,
        error: `The stored value is ${stored.length / 2} bytes and does not decode as ${card.valueType}: ${detail}`,
      })
    }
  } catch (err) {
    if (stale()) return
    set(card.name, {
      isLoading: false,
      failed: err instanceof GatewayVerificationError,
      error: err instanceof Error ? err.message : 'The state could not be read.',
    })
  }
}

/** Reads every item and every other entry that was read before. */
async function refresh(): Promise<void> {
  await Promise.all(cards.value.filter((c) => c.kind === 'item' || reads.value[c.name] !== undefined).map(read))
}

// A new contract, domain or interface starts with no values. A new tag re-reads the entries shown.
watch(
  () => JSON.stringify([props.domainId, props.contractId, props.iface]),
  () => {
    for (const name of Object.keys(attempts)) attempts[name]++
    reads.value = {}
    for (const name of Object.keys(texts)) delete texts[name]
    refresh()
  },
  { immediate: true }
)
watch(
  () => props.tag,
  () => refresh()
)

defineExpose({ refresh })

const isLoading = computed(() => Object.values(reads.value).some((r) => r.isLoading))
const fellBack = computed(() => Object.values(reads.value).some((r) => r.answeredTag !== props.tag))
</script>

<template>
  <div class="space-y-6" data-slot="storage-browser">
    <Alert v-if="!iface" data-slot="no-interface">
      <AlertTitle>No interface file</AlertTitle>
      <AlertDescription>Import the contract's interface file on the Overview tab to read named entries. Without it, read a raw local key.</AlertDescription>
    </Alert>
    <Alert v-else-if="!encoder" data-slot="unsupported-encoding">
      <AlertTitle>Unsupported interface encoding</AlertTitle>
      <AlertDescription>This explorer cannot derive keys for {{ iface.encoding }}. Read a raw local key.</AlertDescription>
    </Alert>
    <Alert v-else-if="cards.length === 0" data-slot="no-storage">
      <AlertTitle>No storage entries</AlertTitle>
      <AlertDescription>The interface file declares no storage.</AlertDescription>
    </Alert>

    <div v-if="cards.length > 0" class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted-foreground">Values are read at the selected tag.</p>
      <Button variant="outline" :disabled="isLoading" @click="refresh()"><RefreshCwIcon /> Refresh</Button>
    </div>

    <Alert v-if="fellBack" data-slot="tag-fallback">
      <AlertTitle>Showing the latest accepted state</AlertTitle>
      <AlertDescription>This gateway does not serve pending state.</AlertDescription>
    </Alert>

    <Card v-for="card in cards" :key="card.name" data-slot="storage-entry" :data-name="card.name">
      <CardHeader>
        <div class="flex flex-wrap items-center gap-2">
          <CardTitle class="font-mono">{{ card.kind === 'raw' ? 'Local key' : card.name }}</CardTitle>
          <Badge variant="secondary">{{ card.kind === 'raw' ? 'raw' : card.kind }}</Badge>
          <span v-if="card.valueType" class="text-ledger text-muted-foreground">{{ card.valueType }}</span>
        </div>
        <CardDescription v-if="card.description">{{ card.description }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <template v-if="card.kind !== 'item'">
          <Field v-for="(param, i) in card.key" :key="param.name">
            <FieldLabel :for="`storage-${card.name}-${param.name}`">
              {{ card.kind === 'raw' ? 'Local key (hex, up to 32 bytes)' : param.name }}
              <span v-if="card.kind !== 'raw'" class="text-ledger text-muted-foreground">{{ param.type }}</span>
            </FieldLabel>
            <Input
              :id="`storage-${card.name}-${param.name}`"
              :model-value="textsOf(card)[i] ?? ''"
              class="font-mono"
              :aria-invalid="(textsOf(card)[i] ?? '') !== '' && keyErrors(card)[i] !== null ? true : undefined"
              @update:model-value="setText(card, i, String($event))"
            />
            <FieldError v-if="(textsOf(card)[i] ?? '') !== '' && keyErrors(card)[i]">{{ keyErrors(card)[i] }}</FieldError>
          </Field>
          <Button :disabled="!canRead(card) || reads[card.name]?.isLoading" @click="read(card)">Read</Button>
        </template>

        <Skeleton v-if="reads[card.name]?.isLoading && reads[card.name]?.batchId === null" class="h-12 w-full" />
        <VerificationBadge
          v-if="reads[card.name]?.batchId == null && reads[card.name]?.failed"
          :verified="false"
          :domain-status="domainStatus"
          :failed="true"
        />
        <div v-if="reads[card.name]?.batchId != null" class="grid gap-6 sm:grid-cols-3" data-slot="storage-result">
          <DescriptionItem label="Value">
            <span v-if="!reads[card.name]!.present" class="text-muted-foreground" data-slot="storage-not-set">Not set</span>
            <HexView v-else-if="reads[card.name]!.value === null && reads[card.name]!.hex" :value="reads[card.name]!.hex!" label="Stored value" />
            <span v-else class="font-mono tabular-nums break-all" data-slot="storage-value">{{ formatValue(reads[card.name]!.value!) }}</span>
          </DescriptionItem>
          <DescriptionItem label="Batch">
            <span class="font-mono tabular-nums">{{ reads[card.name]!.batchId }}</span>, read at {{ reads[card.name]!.answeredTag }}
          </DescriptionItem>
          <DescriptionItem label="Verification">
            <VerificationBadge
              :verified="reads[card.name]!.verified"
              :check="reads[card.name]!.check"
              :domain-status="domainStatus"
              :failed="reads[card.name]!.failed"
            />
          </DescriptionItem>
        </div>
        <p v-if="reads[card.name]?.error" role="alert" class="text-sm text-destructive" data-slot="storage-error">
          {{ reads[card.name]!.error }}
        </p>
      </CardContent>
    </Card>
  </div>
</template>
