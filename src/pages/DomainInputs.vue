<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Card, CardContent, CursorPagination, EmptyState, Input, Skeleton } from 'nom-ui'
import type { TagName } from 'zeno-client'
import { GatewayService } from '@/core'
import { TagSelector } from '@/components'
import { CURSOR_PAGE_SIZES, useCursorList, useLiveHead } from '@/core'
import InputTable from '@/components/InputTable.vue'
import ListNotices from '@/components/ListNotices.vue'

const route = useRoute()
const domainId = computed(() => Number(route.params.domainId))
const tag = ref<TagName>('latest')
const answeredTag = ref<TagName>('latest')
const kind = ref('')
const inputKind = computed(() => (/^\d+$/.test(kind.value) ? Number(kind.value) : undefined))

const list = useCursorList(async (cursor, limit) => {
  const gateway = GatewayService.getInstance()
  const client = await gateway.client()
  const { value, tag: used } = await gateway.withTagFallback(tag.value, (t) =>
    client.getInputs({ domainId: domainId.value, inputKind: inputKind.value, toBatch: t, limit, cursor: cursor ?? undefined })
  )
  answeredTag.value = used as TagName
  return value
}, 'Failed to load the inputs')

// Only the newest page follows the head, so rows do not shift under the reader.
const head = useLiveHead(domainId, list.refresh)

onMounted(list.reset)
watch(domainId, list.restart)
watch([tag, inputKind], list.reset)

const isUnreached = computed(() => list.page.value?.batchId === null && list.items.value.length === 0)
</script>

<template>
  <Card>
    <CardContent class="space-y-4 pt-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Input v-model="kind" type="number" min="0" placeholder="Input kind" aria-label="Input kind" class="w-40" data-slot="kind-filter" />
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
      <InputTable v-else-if="list.page.value" :items="list.items.value" :domain-id="domainId" :domain-status="head?.status ?? null" />

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
