<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { DescriptionItem } from 'nom-ui'
import type { Head } from 'zeno-client'
import { VerificationBadge } from '@/components'

defineProps<{ head: Head | null }>()

const TAGS = ['pending', 'latest', 'finalized'] as const
</script>

<template>
  <div data-slot="heads-panel" class="grid gap-6 sm:grid-cols-3">
    <DescriptionItem v-for="name in TAGS" :key="name" :label="name">
      <template v-if="head?.[name]">
        <div class="flex items-center gap-2" :data-slot="`head-${name}`">
          <RouterLink
            :to="`/batches/${head.domainId}/${head[name]?.batchId}`"
            class="font-mono tabular-nums text-info underline-offset-4 hover:underline"
          >
            batch {{ head[name]?.batchId }}
          </RouterLink>
          <VerificationBadge :verified="head[name]?.verified ?? false" :domain-status="head.status" />
        </div>
      </template>
      <span v-else class="text-muted-foreground">None yet</span>
    </DescriptionItem>
  </div>
</template>
