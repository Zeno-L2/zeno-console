<script setup lang="ts">
import type {
  SettlementExecutor,
  SettlementFeeInfo,
  SettlementPeripheryConfig,
} from 'znn-typescript-sdk'
import {
  Address,
  Amount,
  Badge,
  DescriptionItem,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'nom-ui'
import { RouterLink } from 'vue-router'
import { formatZnn } from '@/core'

defineProps<{
  executors: SettlementExecutor[]
  periphery: SettlementPeripheryConfig | null
  fees: SettlementFeeInfo | null
}>()
</script>

<template>
  <div class="space-y-6" data-slot="executor-fees">
    <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      <DescriptionItem label="Price per byte of bytecode">
        <Amount v-if="periphery" :value="formatZnn(periphery.znnPerByteOfBytecode)" symbol="ZNN" />
        <Badge v-else variant="warning">Not set</Badge>
      </DescriptionItem>
      <DescriptionItem label="Price per byte of state">
        <Amount v-if="periphery" :value="formatZnn(periphery.znnPerByteOfState)" symbol="ZNN" />
        <Badge v-else variant="warning">Not set</Badge>
      </DescriptionItem>
      <DescriptionItem label="Fees collected">
        <Amount v-if="fees" :value="formatZnn(fees.totalFeesCollected)" symbol="ZNN" />
      </DescriptionItem>
      <DescriptionItem label="Fees burned">
        <Amount v-if="fees" :value="formatZnn(fees.totalFeesBurned)" symbol="ZNN" />
      </DescriptionItem>
      <DescriptionItem label="Fees credited">
        <Amount v-if="fees" :value="formatZnn(fees.totalFeesCredited)" symbol="ZNN" />
      </DescriptionItem>
      <DescriptionItem label="Rewards collected">
        <Amount v-if="fees" :value="formatZnn(fees.totalRewardsCollected)" symbol="ZNN" />
      </DescriptionItem>
      <DescriptionItem label="Pending epoch">
        <template v-if="fees?.pendingEpochHead">
          epoch <span class="font-mono tabular-nums">{{ fees.pendingEpochHead.epoch }}</span>, final at height
          <span class="font-mono tabular-nums">{{ fees.pendingEpochHead.finalityHeight }}</span>
        </template>
        <span v-else class="text-muted-foreground">None</span>
      </DescriptionItem>
    </div>

    <EmptyState v-if="executors.length === 0">No executor is registered.</EmptyState>
    <Table v-else density="compact">
      <TableHeader>
        <TableRow>
          <TableHead>Pillar</TableHead>
          <TableHead>Executor</TableHead>
          <TableHead>Registered at</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="e in executors" :key="e.executorAddress.toString()">
          <TableCell>{{ e.pillarName }}</TableCell>
          <TableCell>
            <Address :address="e.executorAddress.toString()" :link-as="RouterLink" :to="`/address/${e.executorAddress.toString()}`" />
          </TableCell>
          <TableCell class="font-mono tabular-nums">{{ e.registrationHeight }}</TableCell>
          <TableCell>
            <Badge :variant="e.status === 0 ? 'success' : 'secondary'">{{ e.status === 0 ? 'Active' : `Status ${e.status}` }}</Badge>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
