<script setup lang="ts">
import type { SettlementTimeChallenge } from 'znn-typescript-sdk'
import { EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'nom-ui'
import { BLOCK_TIME_SECONDS } from '../config'

const props = defineProps<{
  challenges: SettlementTimeChallenge[]
  /** The frontier momentum height the countdown counts from. */
  frontierHeight: number
}>()

function countdown(dueHeight: number): string {
  const left = dueHeight - props.frontierHeight
  if (left <= 0) return 'Ready to apply'
  const minutes = Math.ceil((left * BLOCK_TIME_SECONDS) / 60)
  return `${left} momentums, about ${minutes} min`
}
</script>

<template>
  <EmptyState v-if="challenges.length === 0" data-slot="time-challenges">
    No administrator change is waiting to apply.
  </EmptyState>
  <Table v-else density="compact" data-slot="time-challenges">
    <TableHeader>
      <TableRow>
        <TableHead>Method</TableHead>
        <TableHead>Started</TableHead>
        <TableHead>Due</TableHead>
        <TableHead>Remaining</TableHead>
        <TableHead v-if="$slots.actions" />
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="c in challenges" :key="c.methodName + c.paramsHash.toString()">
        <TableCell class="font-mono text-xs break-all whitespace-normal">{{ c.methodName }}</TableCell>
        <TableCell class="font-mono tabular-nums">{{ c.challengeStartHeight }}</TableCell>
        <TableCell class="font-mono tabular-nums">{{ c.dueHeight }}</TableCell>
        <TableCell class="whitespace-normal">{{ countdown(c.dueHeight) }}</TableCell>
        <TableCell v-if="$slots.actions"><slot name="actions" :challenge="c" /></TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
