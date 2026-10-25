<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Card, CardContent, CursorPagination, EmptyState, Skeleton } from 'nom-ui'
import type { TagName } from 'zeno-client'
import { GatewayService } from '@/core'
import { TagSelector } from '@/components'
import { CURSOR_PAGE_SIZES, useCursorList, useLiveHead, useWithdrawalStates } from '@/core'
import ListNotices from '@/components/ListNotices.vue'
import OutboxTable from '@/components/OutboxTable.vue'

const route = useRoute()
const domainId = computed(() => Number(route.params.domainId))
const tag = ref<TagName>('latest')
const answeredTag = ref<TagName>('latest')
/** `?batch=<n>` narrows the list to one batch. */
const batch = computed(() => {
  const value = route.query.batch
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : undefined
})

const list = useCursorList(async (cursor, limit) => {
  const gateway = GatewayService.getInstance()
  const client = await gateway.client()
  const filter = { domainId: domainId.value, limit, cursor: cursor ?? undefined }
  if (batch.value !== undefined) {
    return client.getOutbox({ ...filter, fromBatch: batch.value, toBatch: batch.value })
  }
  const { value, tag: used } = await gateway.withTagFallback(tag.value, (t) => client.getOutbox({ ...filter, toBatch: t }))
  answeredTag.value = used as TagName
  return value
}, 'Failed to load the outbox')

const withdrawals = useWithdrawalStates(domainId, list.items)

// Only the newest page follows the head, so rows do not shift under the reader.
const head = useLiveHead(domainId, list.refresh)

onMounted(list.reset)
watch(domainId, list.restart)
watch([tag, batch], () => {
  answeredTag.value = tag.value
  list.reset()
})

const isUnreached = computed(
  () => batch.value === undefined && list.page.value?.batchId === null && list.items.value.length === 0
)
</script>

<template>
  <Card>
    <CardContent class="space-y-4 pt-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p v-if="batch !== undefined" class="text-sm" data-slot="batch-filter">
          Batch <span class="font-mono tabular-nums">{{ batch }}</span>
          <RouterLink :to="{ path: route.path }" class="ml-2 text-info underline-offset-4 hover:underline">Show all</RouterLink>
        </p>
        <span v-else />
        <TagSelector v-if="batch === undefined" v-model="tag" />
      </div>

      <ListNotices
        :domain-id="domainId"
        :tag="tag"
        :answered-tag="answeredTag"
        :head="head"
        :cause="list.cause.value"
        :error="list.error.value"
      />
      <p v-if="withdrawals.error.value" role="alert" class="text-sm text-destructive">{{ withdrawals.error.value }}</p>

      <Skeleton v-if="list.isLoading.value && !list.page.value" class="h-48 w-full" />
      <EmptyState v-else-if="isUnreached" data-slot="unreached">No batch has reached {{ answeredTag }} yet</EmptyState>
      <OutboxTable
        v-else-if="list.page.value"
        :items="list.items.value"
        :domain-id="domainId"
        :states="withdrawals.states.value"
        :domain-status="head?.status ?? null"
      />

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
