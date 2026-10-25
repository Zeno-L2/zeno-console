<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { Address, Amount, Badge, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'nom-ui'
import type { DomainStatus, OutboxItem } from 'zeno-client'
import { VerificationBadge } from '@/components'
import { WITHDRAWAL_STATE_LABEL, describeAsset } from '@/core'
import type { WithdrawalState } from '@/core'

defineProps<{
  items: OutboxItem[]
  domainId: number
  states: Map<string, WithdrawalState>
  domainStatus: DomainStatus | null
}>()
</script>

<template>
  <EmptyState v-if="items.length === 0" data-slot="outbox-table">No outbox messages.</EmptyState>
  <Table v-else density="compact" data-slot="outbox-table">
    <TableHeader>
      <TableRow>
        <TableHead>Message</TableHead>
        <TableHead>Kind</TableHead>
        <TableHead>Recipient</TableHead>
        <TableHead>Amount</TableHead>
        <TableHead>Batch</TableHead>
        <TableHead>Withdrawal</TableHead>
        <TableHead>Verification</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="item in items" :key="item.outboxId">
        <TableCell>
          <Address :address="item.outboxId" :link-as="RouterLink" :to="`/outbox/${item.outboxId}`" :start="10" :end="8" />
        </TableCell>
        <TableCell>{{ item.kind }}</TableCell>
        <TableCell>
          <Address
            v-if="item.recipient"
            :address="item.recipient"
            :link-as="RouterLink"
            :to="`/address/${item.recipient}?domain=${domainId}`"
          />
        </TableCell>
        <TableCell>
          <template v-if="item.amount">
            <Amount :value="describeAsset(item.assetId ?? '', item.amount).value" :symbol="describeAsset(item.assetId ?? '', item.amount).symbol" />
          </template>
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
          <Badge v-if="states.get(item.outboxId)" :variant="WITHDRAWAL_STATE_LABEL[states.get(item.outboxId)!].variant">
            {{ WITHDRAWAL_STATE_LABEL[states.get(item.outboxId)!].label }}
          </Badge>
        </TableCell>
        <TableCell><VerificationBadge :verified="item.verified" :domain-status="domainStatus" /></TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
