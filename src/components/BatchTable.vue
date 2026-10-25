<script setup lang="ts">
import type { SettlementBatch } from 'znn-typescript-sdk'
import { Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'nom-ui'
import { RouterLink } from 'vue-router'
import { daModeLabel } from '@/core'

defineProps<{ batches: SettlementBatch[] }>()
</script>

<template>
  <EmptyState v-if="batches.length === 0" data-slot="batch-table">No batch has been submitted yet.</EmptyState>
  <Table v-else density="compact" data-slot="batch-table">
    <TableHeader>
      <TableRow>
        <TableHead>Batch</TableHead>
        <TableHead>Inputs</TableHead>
        <TableHead>Executor</TableHead>
        <TableHead>Submitted</TableHead>
        <TableHead>DA mode</TableHead>
        <TableHead>State</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="b in batches" :key="`${b.domainId}-${b.batchId}`">
        <TableCell>
          <RouterLink
            :to="`/batches/${b.domainId}/${b.batchId}`"
            class="font-mono tabular-nums text-info underline-offset-4 hover:underline"
          >
            {{ b.batchId }}
          </RouterLink>
        </TableCell>
        <TableCell class="font-mono tabular-nums">{{ b.firstInputSeq }} to {{ b.lastInputSeq }}</TableCell>
        <TableCell>{{ b.executorPillar }}</TableCell>
        <TableCell class="font-mono tabular-nums">{{ b.submittedAtHeight }}</TableCell>
        <TableCell>{{ daModeLabel(b.daMode) }}</TableCell>
        <TableCell>
          <Badge :variant="b.isFinalized ? 'success' : 'pending'">{{ b.isFinalized ? 'Finalized' : 'Submitted' }}</Badge>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
