<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  Address,
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CursorPagination,
  EmptyState,
  Label,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'nom-ui'
import { UnsupportedProfileError } from 'zeno-client'
import type { TagName } from 'zeno-client'
import { ContractRegistryService, GatewayService } from '@/core'
import type { RegisteredContract } from '@/core/contract-registry-service'
import { TagSelector } from '@/components'
import { CURSOR_PAGE_SIZES, useCursorList, useLiveHead } from '@/core'
import InputTable from '@/components/InputTable.vue'
import ListNotices from '@/components/ListNotices.vue'
import { useWalletProvider } from '@/core/composables/useWalletProvider'

const route = useRoute()
const domainId = computed(() => Number(route.params.domainId))
const wallet = useWalletProvider()
const tag = ref<TagName>('latest')
const mine = ref(false)
const saved = ref<RegisteredContract[]>([])
const answeredTag = ref<TagName>('latest')

/** The input kind of a deploy. */
const DEPLOY_INPUT_KIND = 4

const list = useCursorList(async (cursor, limit) => {
  const gateway = GatewayService.getInstance()
  const client = await gateway.client()
  // Throws UnsupportedProfileError for a domain without the contracts profile.
  await client.contracts(domainId.value)
  const { value, tag: used } = await gateway.withTagFallback(tag.value, (t) =>
    client.getInputs({ domainId: domainId.value, inputKind: DEPLOY_INPUT_KIND, ...(mine.value && wallet.address.value ? { sender: wallet.address.value } : {}), toBatch: t, limit, cursor: cursor ?? undefined })
  )
  answeredTag.value = used as TagName
  return value
}, 'Failed to load the contracts')

// Only the newest page follows the head, so rows do not shift under the reader.
const head = useLiveHead(domainId, list.refresh)

onMounted(list.reset)
watch(domainId, list.restart)
watch(tag, list.reset)
watch(mine, list.reset)
watch(
  () => wallet.address.value,
  (address) => {
    if (!address) mine.value = false
    else if (mine.value) list.reset()
  }
)

async function loadSaved() {
  const id = domainId.value
  const found = await ContractRegistryService.getInstance().list(id)
  if (id === domainId.value) saved.value = found
}
onMounted(loadSaved)
watch(domainId, loadSaved)

// A failed deploy created no contract.
const deploys = computed(() => list.items.value.filter((item) => item.receipt.status === 'SUCCESS'))

const noProfile = computed(() => list.cause.value instanceof UnsupportedProfileError)

const isUnreached = computed(() => list.page.value?.batchId === null && list.items.value.length === 0)
</script>

<template>
  <Card>
    <CardContent class="space-y-4 pt-6">
      <Card v-if="saved.length > 0" data-slot="saved-contracts">
        <CardHeader>
          <CardTitle>Saved in this browser</CardTitle>
          <CardDescription>Contracts you deployed or added in this domain, with their interface files.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead>Interface</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="c in saved" :key="c.contractId">
                <TableCell>{{ c.name ?? 'Unnamed' }}</TableCell>
                <TableCell>
                  <RouterLink :to="`/contracts/${domainId}/${c.contractId}`" class="underline">
                    <Address :address="c.contractId" :copy="false" />
                  </RouterLink>
                </TableCell>
                <TableCell>
                  <Badge :variant="c.iface ? 'success' : c.interfaceCleared ? 'warning' : 'secondary'">
                    {{ c.iface ? 'Loaded' : c.interfaceCleared ? 'Re-import' : 'None' }}
                  </Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted-foreground">Contracts deployed in this domain, newest first.</p>
        <div class="flex flex-wrap items-center gap-4">
          <div v-if="wallet.isConnected.value" class="flex items-center gap-2">
            <Switch id="deployed-by-me" v-model="mine" />
            <Label for="deployed-by-me">Deployed by me</Label>
          </div>
          <TagSelector v-model="tag" />
        </div>
      </div>

      <ListNotices
        :domain-id="domainId"
        :tag="tag"
        :answered-tag="answeredTag"
        :head="head"
        :cause="list.cause.value"
        :error="noProfile ? null : list.error.value"
      />
      <Alert v-if="noProfile" data-slot="no-contracts-profile">Domain {{ domainId }} has no contracts profile</Alert>

      <Skeleton v-if="list.isLoading.value && !list.page.value" class="h-48 w-full" />
      <EmptyState v-else-if="isUnreached" data-slot="unreached">No batch has reached {{ answeredTag }} yet</EmptyState>
      <EmptyState v-else-if="list.page.value && deploys.length === 0" data-slot="no-contracts">No contracts.</EmptyState>
      <InputTable v-else-if="list.page.value" :items="deploys" :domain-id="domainId" :domain-status="head?.status ?? null" />

      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm text-muted-foreground" data-slot="page-number">Page {{ list.pageNumber.value }}</span>
        <CursorPagination
          :has-previous="list.hasNewer.value"
          :has-next="list.hasOlder.value"
          :page-size="list.pageSize.value"
          :page-sizes="CURSOR_PAGE_SIZES"
          :loading="list.isLoading.value"
          previous-label="Newer"
          next-label="Older"
          @previous="list.newer"
          @next="list.older"
          @update:page-size="(size) => (list.pageSize.value = size)"
        />
      </div>
    </CardContent>
  </Card>
</template>
