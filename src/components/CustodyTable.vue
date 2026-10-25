<script setup lang="ts">
import { QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import { Address, Amount, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'nom-ui'
import { RouterLink } from 'vue-router'
import { formatZnn } from '@/core'
import type { CustodyRow } from '@/core'

defineProps<{ rows: CustodyRow[] }>()

const SYMBOLS: Record<string, string> = { [ZNN_ZTS.toString()]: 'ZNN', [QSR_ZTS.toString()]: 'QSR' }
</script>

<template>
  <EmptyState v-if="rows.length === 0" data-slot="custody-table">Settlement holds no custody for these domains.</EmptyState>
  <Table v-else density="compact" data-slot="custody-table">
    <TableHeader>
      <TableRow>
        <TableHead>Domain</TableHead>
        <TableHead>Asset</TableHead>
        <TableHead>Deposited</TableHead>
        <TableHead>Pending withdrawals</TableHead>
        <TableHead>Released</TableHead>
        <TableHead>Queue depth</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="row in rows" :key="`${row.domainId}-${row.assetId}`">
        <TableCell>
          <RouterLink :to="`/domains/${row.domainId}`" class="font-mono tabular-nums text-info underline-offset-4 hover:underline">
            {{ row.domainId }}
          </RouterLink>
        </TableCell>
        <TableCell>
          <span v-if="SYMBOLS[row.zts]" class="font-medium">{{ SYMBOLS[row.zts] }}</span>
          <Address v-else :address="row.zts" :start="8" :end="6" />
        </TableCell>
        <template v-if="SYMBOLS[row.zts]">
          <TableCell><Amount :value="formatZnn(row.info.totalDeposited)" :symbol="SYMBOLS[row.zts]" /></TableCell>
          <TableCell><Amount :value="formatZnn(row.info.pendingWithdrawalReserve)" :symbol="SYMBOLS[row.zts]" /></TableCell>
          <TableCell><Amount :value="formatZnn(row.info.totalReleased)" :symbol="SYMBOLS[row.zts]" /></TableCell>
        </template>
        <template v-else>
          <TableCell class="font-mono tabular-nums">{{ row.info.totalDeposited }}</TableCell>
          <TableCell class="font-mono tabular-nums">{{ row.info.pendingWithdrawalReserve }}</TableCell>
          <TableCell class="font-mono tabular-nums">{{ row.info.totalReleased }}</TableCell>
        </template>
        <TableCell class="font-mono tabular-nums">{{ row.queueDepth }}</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
