<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { UnknownDomainError } from 'zeno-client'
import type { ChainInfo } from 'zeno-client'
import type { SettlementBatch } from 'znn-typescript-sdk'
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionItem,
  EmptyState,
  Skeleton,
} from 'nom-ui'
import { DomainCard } from '@/components'
import { GatewayService, SettlementService, useNetwork } from '@/core'
import { useCursorList, useCustody, useDomainHeads, useDomains, useMomentumTick } from '@/core'
import BatchTable from '@/components/BatchTable.vue'
import CustodyTable from '@/components/CustodyTable.vue'
import HeadsPanel from '@/components/HeadsPanel.vue'
import InputTable from '@/components/InputTable.vue'
import ListNotices from '@/components/ListNotices.vue'

const LATEST_COUNT = 10

const route = useRoute()
const { domains } = useDomains()
const { heads } = useDomainHeads()
const custody = useCustody()
const network = useNetwork()

const domainId = computed(() => Number(route.params.domainId))
const domain = computed(() => domains.value.find((d) => d.domainId === domainId.value) ?? null)
// DomainLayout follows the domain, so its head stays current here.
const head = computed(() => heads.value[domainId.value] ?? null)
const domainStatus = computed(() => head.value?.status ?? null)

const info = ref<ChainInfo | null>(null)
const infoError = ref<string | null>(null)

async function loadInfo() {
  const id = domainId.value
  info.value = null
  infoError.value = null
  try {
    const result = await (await GatewayService.getInstance().client()).info(id)
    if (id === domainId.value) info.value = result
  } catch (err) {
    if (id !== domainId.value) return
    infoError.value =
      err instanceof UnknownDomainError
        ? `This gateway does not serve domain ${id}`
        : err instanceof Error
          ? err.message
          : 'The gateway could not be reached'
  }
}

function loadCustody() {
  custody.load([domainId.value])
}

const batches = ref<SettlementBatch[]>([])
const batchesError = ref<string | null>(null)
let batchesRequest = 0

async function loadBatches() {
  const id = domainId.value
  const request = ++batchesRequest
  batchesError.value = null
  try {
    const result = await SettlementService.getInstance().getBatches(id, 0, LATEST_COUNT)
    if (request === batchesRequest) batches.value = result.list
  } catch (err) {
    if (request !== batchesRequest) return
    batchesError.value = err instanceof Error ? err.message : 'Failed to load the batches'
    console.error('Failed to load the batches:', err)
  }
}

const inputs = useCursorList(async (cursor) => {
  const gateway = GatewayService.getInstance()
  const client = await gateway.client()
  const { value } = await gateway.withTagFallback('latest', (tag) =>
    client.getInputs({ domainId: domainId.value, toBatch: tag, limit: LATEST_COUNT, cursor: cursor ?? undefined })
  )
  return value
}, 'Failed to load the inputs')

function loadAll() {
  loadInfo()
  loadCustody()
  loadBatches()
  inputs.restart()
}

onMounted(loadAll)
watch(domainId, loadAll)
// A status-only change leaves the batch id alone, so it reloads nothing.
watch(
  [domainId, () => (head.value ? `${head.value.latest?.batchId ?? ''}` : null)],
  ([id, next], [previousId, previous]) => {
    if (id === previousId && previous !== null && next !== null && next !== previous) {
      loadBatches()
      inputs.reset()
    }
  }
)
watch(() => network.currentNode.value, loadCustody)
useMomentumTick(() => {
  loadCustody()
  loadBatches()
})
</script>

<template>
  <div class="space-y-6">
    <DomainCard v-if="domain" :domain="domain" />

    <Card>
      <CardHeader>
        <CardTitle>Heads</CardTitle>
      </CardHeader>
      <CardContent>
        <HeadsPanel :head="head" />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Latest batches</CardTitle>
      </CardHeader>
      <CardContent>
        <p v-if="batchesError" role="alert" class="text-sm text-destructive">{{ batchesError }}</p>
        <BatchTable :batches="batches" />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Latest inputs</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <ListNotices
          :domain-id="domainId"
          tag="latest"
          answered-tag="latest"
          :head="head"
          :cause="inputs.cause.value"
          :error="inputs.error.value"
        />
        <Skeleton v-if="inputs.isLoading.value && !inputs.page.value" class="h-48 w-full" />
        <EmptyState v-else-if="inputs.page.value?.batchId === null && inputs.items.value.length === 0">
          No batch has reached latest yet
        </EmptyState>
        <InputTable
          v-else-if="inputs.page.value"
          :items="inputs.items.value"
          :domain-id="domainId"
          :domain-status="domainStatus"
        />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Gateway description</CardTitle>
      </CardHeader>
      <CardContent>
        <Alert v-if="infoError" data-slot="chain-info-error">
          <AlertDescription>{{ infoError }}</AlertDescription>
        </Alert>
        <Skeleton v-else-if="!info" class="h-20 w-full" />
        <div v-else class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4" data-slot="chain-info">
          <DescriptionItem label="Network">{{ info.networkName }}</DescriptionItem>
          <DescriptionItem label="Chain id">
            <span class="font-mono text-xs break-all">{{ info.chain_id ?? 'None' }}</span>
          </DescriptionItem>
          <DescriptionItem label="Runtime">{{ info.runtimeKind ?? 'None' }}</DescriptionItem>
          <DescriptionItem label="Profiles">
            <div class="flex flex-wrap gap-1">
              <Badge v-for="p in info.profiles" :key="p.name" variant="secondary">{{ p.name }}</Badge>
              <span v-if="info.profiles.length === 0" class="text-muted-foreground">None</span>
            </div>
          </DescriptionItem>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Custody and release queue</CardTitle>
      </CardHeader>
      <CardContent>
        <p v-if="custody.error.value" role="alert" class="text-sm text-destructive">{{ custody.error.value }}</p>
        <CustodyTable v-else :rows="custody.rows.value" />
      </CardContent>
    </Card>
  </div>
</template>
