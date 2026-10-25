<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Card, CardContent, CursorPagination, EmptyState, Skeleton } from 'nom-ui'
import type { ContractInterface, TagName } from 'zeno-client'
import { GatewayService, InterfaceResolver } from '@/core'
import { TagSelector } from '@/components'
import { CURSOR_PAGE_SIZES, useCursorList, useLiveHead } from '@/core'
import EventTable from '@/components/EventTable.vue'
import ListNotices from '@/components/ListNotices.vue'

const route = useRoute()
const domainId = computed(() => Number(route.params.domainId))
const tag = ref<TagName>('latest')
const answeredTag = ref<TagName>('latest')
const interfaces = ref<Record<string, ContractInterface>>({})

const list = useCursorList(async (cursor, limit) => {
  const gateway = GatewayService.getInstance()
  const client = await gateway.client()
  const { value, tag: used } = await gateway.withTagFallback(tag.value, (t) =>
    client.getEvents({ domainId: domainId.value, toBatch: t, limit, cursor: cursor ?? undefined })
  )
  answeredTag.value = used as TagName
  return value
}, 'Failed to load the events')

// Each contract on the page decodes with its own saved interface, or with any interface known
// for the code it runs. A contract's code hash is read once and cached.
async function loadInterfaces() {
  const domain = domainId.value
  const ids = list.items.value.map((item) => item.contractId.toLowerCase())
  const missing = ids.filter((id) => !(id in interfaces.value))
  if (missing.length === 0) return
  const found = await InterfaceResolver.getInstance().forContracts(domain, missing)
  if (domain !== domainId.value) return
  interfaces.value = { ...interfaces.value, ...found }
}

// Only the newest page follows the head, so rows do not shift under the reader.
const head = useLiveHead(domainId, list.refresh)

onMounted(() => {
  list.reset()
})
watch(() => list.items.value, loadInterfaces)
watch(domainId, () => {
  interfaces.value = {}
  list.restart()
})
watch(tag, list.reset)

const isUnreached = computed(() => list.page.value?.batchId === null && list.items.value.length === 0)
</script>

<template>
  <Card>
    <CardContent class="space-y-4 pt-6">
      <div class="flex justify-end">
        <TagSelector v-model="tag" />
      </div>

      <ListNotices
        :domain-id="domainId"
        :tag="tag"
        :answered-tag="answeredTag"
        :head="head"
        :cause="list.cause.value"
        :error="list.error.value"
      />

      <Skeleton v-if="list.isLoading.value && !list.page.value" class="h-48 w-full" />
      <EmptyState v-else-if="isUnreached" data-slot="unreached">No batch has reached {{ answeredTag }} yet</EmptyState>
      <EventTable
        v-else-if="list.page.value"
        :items="list.items.value"
        :domain-id="domainId"
        :domain-status="head?.status ?? null"
        :interfaces="interfaces"
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
