<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Address, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'nom-ui'
import type { ContractInterface, DomainStatus, EventItem } from 'zeno-client'
import { EventList, VerificationBadge } from '@/components'
import { describeEvents } from '@/core'

const props = defineProps<{
  items: EventItem[]
  domainId: number
  domainStatus: DomainStatus | null
  /** Interfaces keyed by lower-case contract id. */
  interfaces: Record<string, ContractInterface>
}>()

// A row decodes with the interface of its own contract and stays raw when it has none or it does not fit.
const rows = computed(() =>
  props.items.map((item) => {
    const iface = props.interfaces[item.contractId.toLowerCase()]
    let events
    try {
      events = describeEvents([item], iface)
    } catch {
      events = describeEvents([item])
    }
    return { item, events }
  })
)
</script>

<template>
  <EmptyState v-if="items.length === 0" data-slot="event-table">No events.</EmptyState>
  <Table v-else density="compact" data-slot="event-table">
    <TableHeader>
      <TableRow>
        <TableHead>Batch</TableHead>
        <TableHead>Contract</TableHead>
        <TableHead>Event</TableHead>
        <TableHead>Verification</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="{ item, events } in rows" :key="`${item.inputIndex}-${item.eventIndex}`">
        <TableCell>
          <RouterLink
            :to="`/batches/${domainId}/${item.batchId}`"
            class="font-mono tabular-nums text-info underline-offset-4 hover:underline"
          >
            {{ item.batchId }}
          </RouterLink>
        </TableCell>
        <TableCell>
          <Address
            :address="item.contractId"
            :link-as="RouterLink"
            :to="`/contracts/${domainId}/${item.contractId}`"
            :start="10"
            :end="8"
          />
        </TableCell>
        <TableCell class="whitespace-normal"><EventList :events="events" /></TableCell>
        <TableCell><VerificationBadge :verified="item.verified" :domain-status="domainStatus" /></TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
