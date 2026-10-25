<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from 'nom-ui'
import { TriangleAlertIcon } from '@lucide/vue'

defineProps<{
  domainId: number
  /** The batch the domain turned inconsistent at, when the gateway named one. */
  inconsistentAt: number | null
  detail?: string
}>()
</script>

<template>
  <Alert variant="destructive" data-slot="inconsistent-banner">
    <TriangleAlertIcon />
    <div>
      <AlertTitle>Domain {{ domainId }} is inconsistent</AlertTitle>
      <AlertDescription>
        <p v-if="inconsistentAt !== null">
          The gateway's state diverged from Settlement at batch
          <span class="font-mono tabular-nums">{{ inconsistentAt }}</span>. Treat values from that batch on as
          untrusted. Select the finalized tag to read below it.
        </p>
        <p v-else>Treat the values of this domain as untrusted. Select the finalized tag to read below the divergence.</p>
        <p v-if="detail" class="mt-1">{{ detail }}</p>
      </AlertDescription>
    </div>
  </Alert>
</template>
