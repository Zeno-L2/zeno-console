<script setup lang="ts">
import { computed } from 'vue'
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from 'nom-ui'
import { CircleCheckIcon, CircleDashedIcon, TriangleAlertIcon } from '@lucide/vue'
import { verificationNote, verificationState } from '../core/verification'
import type { VerificationInput } from '../core/verification'

const props = defineProps<VerificationInput>()

const state = computed(() => verificationState(props))
const note = computed(() => verificationNote(props))

const LABELS = {
  verified: 'Verified',
  pending: 'Pending',
  inconsistent: 'Inconsistent',
} as const

const DESCRIPTIONS = {
  verified: 'Accepted on Settlement, with every proof checked against its batch root.',
  pending: 'Built by the executor and not yet accepted on L1.',
  inconsistent: 'The domain is inconsistent or a check failed. Treat this value as untrusted.',
} as const

const variant = computed(
  () => ({ verified: 'success', pending: 'pending', inconsistent: 'destructive' }) as const
)
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span class="inline-flex" data-slot="verification-badge" :data-state="state">
        <Badge :variant="variant[state]">
          <CircleCheckIcon v-if="state === 'verified'" />
          <CircleDashedIcon v-else-if="state === 'pending'" />
          <TriangleAlertIcon v-else />
          {{ LABELS[state] }}
        </Badge>
      </span>
    </TooltipTrigger>
    <TooltipContent class="max-w-xs">
      <p>{{ DESCRIPTIONS[state] }}</p>
      <p v-if="note" class="mt-1 text-xs">{{ note }}</p>
    </TooltipContent>
  </Tooltip>
</template>
