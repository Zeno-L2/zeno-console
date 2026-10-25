<script setup lang="ts">
import { computed } from 'vue'
import type { SettlementPauseInfo } from 'znn-typescript-sdk'
import { Alert, AlertDescription, AlertTitle, Badge } from 'nom-ui'
import { PauseIcon } from '@lucide/vue'

const props = defineProps<{
  pause: SettlementPauseInfo | null
  /** When set, only the global pause and this domain's pause count. */
  domainId?: number
}>()

interface Active {
  scope: string
  submit: boolean
  relay: boolean
}

const active = computed<Active[]>(() => {
  const out: Active[] = []
  const global = props.pause?.global
  if (global && (global.submitPaused || global.relayPaused)) {
    out.push({ scope: 'All domains', submit: global.submitPaused, relay: global.relayPaused })
  }
  for (const d of props.pause?.domains ?? []) {
    if (props.domainId !== undefined && d.domainId !== props.domainId) continue
    if (d.submitPaused || d.relayPaused) {
      out.push({ scope: `Domain ${d.domainId}`, submit: d.submitPaused, relay: d.relayPaused })
    }
  }
  return out
})
</script>

<template>
  <Alert v-if="active.length > 0" data-slot="pause-banner">
    <PauseIcon />
    <div>
      <AlertTitle>Settlement is paused</AlertTitle>
      <AlertDescription>
        <ul class="mt-2 space-y-1">
          <li v-for="entry in active" :key="entry.scope" class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{{ entry.scope }}</span>
            <Badge v-if="entry.submit" variant="warning">Batch submission paused</Badge>
            <Badge v-if="entry.relay" variant="warning">Relay paused</Badge>
          </li>
        </ul>
      </AlertDescription>
    </div>
  </Alert>
</template>
