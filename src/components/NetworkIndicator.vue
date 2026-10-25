<script setup lang="ts">
import { GlobeIcon, GlobeXIcon } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from 'nom-ui'

export interface NetworkIndicatorProps {
  connected: boolean
  node?: string
}

defineProps<NetworkIndicatorProps>()
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span
        class="inline-flex"
        role="img"
        :aria-label="connected ? 'Network connected' : 'Network disconnected'"
      >
        <GlobeIcon v-if="connected" class="h-5 w-5 text-success" />
        <GlobeXIcon v-else class="h-5 w-5 animate-pulse text-destructive" />
      </span>
    </TooltipTrigger>
    <TooltipContent>
      <p class="font-medium">{{ connected ? 'Connected' : 'Disconnected' }}</p>
      <p class="font-mono text-xs">{{ node || 'No node configured' }}</p>
    </TooltipContent>
  </Tooltip>
</template>
