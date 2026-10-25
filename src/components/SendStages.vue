<script setup lang="ts">
import { computed } from 'vue'
import { Stepper } from 'nom-ui'
import type { StepItem } from 'nom-ui'
import { TRACK_STAGES } from '../core/tx-tracker-service'
import type { TrackStage, TrackState } from '../core/tx-tracker-service'

const props = defineProps<{ state: TrackState | null }>()

const TITLES: Record<TrackStage, { title: string; description: string }> = {
  unknown: { title: 'Unknown', description: '' },
  published: { title: 'Published', description: 'The account block is in the sender\'s chain.' },
  received: { title: 'Received', description: 'The recipient received the send.' },
  executed: { title: 'Executed', description: 'The gateway built a receipt. It is not yet accepted on L1.' },
  submitted: { title: 'Submitted', description: 'The batch is accepted on L1 and the receipt is verified against it.' },
  finalized: { title: 'Finalized', description: 'The batch passed its finality delay.' },
}

const steps = computed<StepItem[]>(() => {
  const reached = props.state ? TRACK_STAGES.indexOf(props.state.stage) : -1
  const stages = props.state?.l1Only || props.state?.refused ? TRACK_STAGES.slice(0, 2) : TRACK_STAGES
  return stages.map((stage, i) => ({
    id: stage,
    title: TITLES[stage].title,
    description: TITLES[stage].description,
    state: i <= reached ? 'done' : i === reached + 1 ? 'active' : 'waiting',
  }))
})
</script>

<template>
  <div class="space-y-4">
    <Stepper :steps="steps" />
    <p v-if="state?.l1Only && !state.refused" data-slot="l1-only" class="text-sm text-muted-foreground">This send queues no domain input, so no receipt follows Received.</p>
    <p v-if="state?.error" role="alert" class="text-sm text-destructive">{{ state.error }}</p>
  </div>
</template>
