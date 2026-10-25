<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Address,
  Alert,
  AlertDescription,
  AlertTitle,
  CursorPagination,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from 'nom-ui'
import { TriangleAlertIcon } from '@lucide/vue'
import type { TagName } from 'zeno-client'
import { GatewayService } from '@/core'
import { TagSelector } from '@/components'
import { CURSOR_PAGE_SIZES, useCursorList, useDomains, useLiveHead, useWithdrawalStates } from '@/core'
import DomainSelect from '@/components/DomainSelect.vue'
import InconsistentBanner from '@/components/InconsistentBanner.vue'
import InputTable from '@/components/InputTable.vue'
import ListNotices from '@/components/ListNotices.vue'
import OutboxTable from '@/components/OutboxTable.vue'

const route = useRoute()
const router = useRouter()
const { defaultDomainId } = useDomains()

const address = computed(() => String(route.params.address ?? ''))
const valid = computed(() => /^z1[0-9a-z]{38}$/.test(address.value))
const domainId = computed(() => {
  const value = route.query.domain
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : defaultDomainId.value
})
const tab = ref('inputs')
const tag = ref<TagName>('latest')
const answeredTag = ref<TagName>('latest')

function selectDomain(id: number) {
  router.replace({ path: route.path, query: { ...route.query, domain: String(id) } })
}

async function read<T>(run: (client: Awaited<ReturnType<GatewayService['client']>>, tag: TagName) => Promise<T>) {
  const gateway = GatewayService.getInstance()
  const client = await gateway.client()
  const { value, tag: used } = await gateway.withTagFallback(tag.value, (t) => run(client, t as TagName))
  answeredTag.value = used as TagName
  return value
}

const inputs = useCursorList(
  (cursor, limit) =>
    read((client, t) =>
      client.getInputs({ domainId: domainId.value, sender: address.value, toBatch: t, limit, cursor: cursor ?? undefined })
    ),
  'Failed to load the inputs'
)
const outbox = useCursorList(
  (cursor, limit) =>
    read((client, t) =>
      client.getOutbox({ domainId: domainId.value, recipient: address.value, toBatch: t, limit, cursor: cursor ?? undefined })
    ),
  'Failed to load the outbox'
)
const withdrawals = useWithdrawalStates(domainId, outbox.items)

const lists = [inputs, outbox]
const head = useLiveHead(domainId, () => {
  for (const list of lists) list.refresh()
})
const active = computed(() => (tab.value === 'outbox' ? outbox : inputs))

function reload() {
  if (valid.value) for (const list of lists) list.reset()
}
onMounted(reload)
watch([domainId, address], () => {
  if (valid.value) for (const list of lists) list.restart()
})
watch(tag, reload)

const isUnreached = (list: { page: { value: { batchId: number | null } | null }; items: { value: unknown[] } }) =>
  list.page.value?.batchId === null && list.items.value.length === 0
</script>

<template>
  <Alert v-if="!valid" variant="destructive">
    <TriangleAlertIcon />
    <div>
      <AlertTitle>Not an address</AlertTitle>
      <AlertDescription>An address starts with z1 and is 40 characters long.</AlertDescription>
    </div>
  </Alert>

  <div v-else class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-2xl font-semibold tracking-tight">Address</h2>
        <Address :address="address" :start="12" :end="8" />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <DomainSelect :model-value="domainId" @update:model-value="selectDomain" />
        <TagSelector v-model="tag" />
      </div>
    </div>

    <InconsistentBanner v-if="head?.status === 'INCONSISTENT'" :domain-id="domainId" :inconsistent-at="head.inconsistentAt" />

    <ListNotices
      :domain-id="domainId"
      :tag="tag"
      :answered-tag="answeredTag"
      :head="head"
      :cause="active.cause.value"
      :error="active.error.value"
    />

    <Tabs v-model="tab">
      <TabsList variant="underline">
        <TabsTrigger value="inputs" variant="underline">Inputs</TabsTrigger>
        <TabsTrigger value="outbox" variant="underline">Outbox</TabsTrigger>
      </TabsList>

      <TabsContent value="inputs" class="space-y-4 pt-4">
        <Skeleton v-if="inputs.isLoading.value && !inputs.page.value" class="h-48 w-full" />
        <EmptyState v-else-if="isUnreached(inputs)" data-slot="unreached">No batch has reached {{ answeredTag }} yet</EmptyState>
        <InputTable v-else-if="inputs.page.value" :items="inputs.items.value" :domain-id="domainId" :domain-status="head?.status ?? null" />
      </TabsContent>

      <TabsContent value="outbox" class="space-y-4 pt-4">
        <p v-if="withdrawals.error.value" role="alert" class="text-sm text-destructive">{{ withdrawals.error.value }}</p>
        <Skeleton v-if="outbox.isLoading.value && !outbox.page.value" class="h-48 w-full" />
        <EmptyState v-else-if="isUnreached(outbox)" data-slot="unreached">No batch has reached {{ answeredTag }} yet</EmptyState>
        <OutboxTable
          v-else-if="outbox.page.value"
          :items="outbox.items.value"
          :domain-id="domainId"
          :states="withdrawals.states.value"
          :domain-status="head?.status ?? null"
        />
      </TabsContent>
    </Tabs>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-sm text-muted-foreground" data-slot="page-number">Page {{ active.pageNumber.value }}</span>
      <CursorPagination
        :has-previous="active.hasNewer.value"
        :has-next="active.hasOlder.value"
        :page-size="active.pageSize.value"
        :page-sizes="CURSOR_PAGE_SIZES"
        :loading="active.isLoading.value"
        previous-label="Newer"
        next-label="Older"
        @previous="active.newer"
        @next="active.older"
        @update:page-size="(size) => (active.pageSize.value = size)"
      />
    </div>
  </div>
</template>
