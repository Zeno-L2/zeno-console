<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  Card,
  CardContent,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  Skeleton,
} from 'nom-ui'
import { SettlementService, usePagedList } from '@/core'
import { useMomentumTick } from '@/core'
import BatchTable from '@/components/BatchTable.vue'

const route = useRoute()
const domainId = computed(() => Number(route.params.domainId))

const list = usePagedList(async (pageIndex, pageSize) => {
  const result = await SettlementService.getInstance().getBatches(domainId.value, pageIndex, pageSize)
  return { list: result.list, count: result.count }
}, 'Failed to load the batches')

onMounted(list.load)
watch(domainId, list.reset)
// A new momentum can add a batch. The first page reloads, and a later page stays put.
useMomentumTick(() => {
  if (list.pageIndex.value === 0) list.load()
})
</script>

<template>
  <Card>
    <CardContent class="space-y-4 pt-6">
      <p v-if="list.error.value" role="alert" class="text-sm text-destructive">{{ list.error.value }}</p>
      <Skeleton v-if="list.isLoading.value && list.items.value.length === 0" class="h-48 w-full" />
      <BatchTable v-else :batches="list.items.value" />
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm text-muted-foreground" data-slot="batch-count">
          {{ list.totalCount.value.toLocaleString() }} batches
        </span>
        <Pagination
          v-slot="{ page }"
          :page="list.pageIndex.value + 1"
          :total="list.totalCount.value"
          :items-per-page="list.pageSize.value"
          :sibling-count="1"
          show-edges
          @update:page="(value) => (list.pageIndex.value = value - 1)"
        >
          <PaginationContent v-slot="{ items }">
            <PaginationPrevious />
            <template v-for="(item, index) in items" :key="index">
              <PaginationItem v-if="item.type === 'page'" :value="item.value" :is-active="item.value === page">
                {{ item.value }}
              </PaginationItem>
              <PaginationEllipsis v-else :index="index" />
            </template>
            <PaginationNext />
          </PaginationContent>
        </Pagination>
      </div>
    </CardContent>
  </Card>
</template>
