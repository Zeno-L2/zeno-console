<script setup lang="ts">
import { computed } from 'vue'
import type { SettlementPauseInfo } from 'znn-typescript-sdk'
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'nom-ui'
import { RouterLink } from 'vue-router'

const props = defineProps<{ pause: SettlementPauseInfo; domainIds: number[] }>()

interface Row {
  label: string
  domainId?: number
  submit: boolean
  relay: boolean
}

// A domain is paused when its own flag or the global flag is set.
const rows = computed<Row[]>(() => {
  const global = props.pause.global
  const globalSubmit = global?.submitPaused ?? false
  const globalRelay = global?.relayPaused ?? false
  return [
    { label: 'All domains', submit: globalSubmit, relay: globalRelay },
    ...props.domainIds.map((domainId) => {
      const own = props.pause.domains.find((d) => d.domainId === domainId)
      return {
        label: `Domain ${domainId}`,
        domainId,
        submit: globalSubmit || (own?.submitPaused ?? false),
        relay: globalRelay || (own?.relayPaused ?? false),
      }
    }),
  ]
})
</script>

<template>
  <Table density="compact" data-slot="pause-table">
    <TableHeader>
      <TableRow>
        <TableHead>Scope</TableHead>
        <TableHead>Batch submission</TableHead>
        <TableHead>Relay</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="row in rows" :key="row.label" :data-slot="row.domainId === undefined ? 'pause-global' : `pause-${row.domainId}`">
        <TableCell>
          <RouterLink
            v-if="row.domainId !== undefined"
            :to="`/domains/${row.domainId}`"
            class="text-info underline-offset-4 hover:underline"
          >
            {{ row.label }}
          </RouterLink>
          <span v-else>{{ row.label }}</span>
        </TableCell>
        <TableCell>
          <Badge :variant="row.submit ? 'warning' : 'success'">{{ row.submit ? 'Paused' : 'Active' }}</Badge>
        </TableCell>
        <TableCell>
          <Badge :variant="row.relay ? 'warning' : 'success'">{{ row.relay ? 'Paused' : 'Active' }}</Badge>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
