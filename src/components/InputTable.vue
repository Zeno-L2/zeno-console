<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { Address, Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'nom-ui'
import type { DomainStatus, InputItem } from 'zeno-client'
import { VerificationBadge } from '@/components'

defineProps<{ items: InputItem[]; domainId: number; domainStatus: DomainStatus | null }>()
</script>

<template>
  <EmptyState v-if="items.length === 0" data-slot="input-table">No inputs.</EmptyState>
  <Table v-else density="compact" data-slot="input-table">
    <TableHeader>
      <TableRow>
        <TableHead>Index</TableHead>
        <TableHead>Send hash</TableHead>
        <TableHead>Sender</TableHead>
        <TableHead>Kind</TableHead>
        <TableHead>Contract</TableHead>
        <TableHead>Batch</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Verification</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="item in items" :key="item.globalInputIndex">
        <TableCell class="font-mono tabular-nums">{{ item.globalInputIndex }}</TableCell>
        <TableCell>
          <Address :address="item.sendHash" :link-as="RouterLink" :to="`/tx/${item.sendHash}`" :start="10" :end="8" />
        </TableCell>
        <TableCell>
          <Address :address="item.sender" :link-as="RouterLink" :to="`/address/${item.sender}?domain=${domainId}`" />
        </TableCell>
        <TableCell>{{ item.input?.kind ?? `Kind ${item.inputKind}` }}</TableCell>
        <TableCell>
          <Address
            :address="item.receipt.contractId"
            :link-as="RouterLink"
            :to="`/contracts/${domainId}/${item.receipt.contractId}`"
            :start="10"
            :end="8"
          />
        </TableCell>
        <TableCell>
          <RouterLink
            :to="`/batches/${domainId}/${item.batchId}`"
            class="font-mono tabular-nums text-info underline-offset-4 hover:underline"
          >
            {{ item.batchId }}
          </RouterLink>
        </TableCell>
        <TableCell>
          <Badge :variant="item.receipt.status === 'SUCCESS' ? 'success' : 'destructive'">{{ item.receipt.status }}</Badge>
        </TableCell>
        <TableCell><VerificationBadge :verified="item.verified" :domain-status="domainStatus" /></TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
