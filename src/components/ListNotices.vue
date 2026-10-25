<script setup lang="ts">
import { computed } from 'vue'
import { Alert, AlertDescription, AlertTitle } from 'nom-ui'
import { TriangleAlertIcon } from '@lucide/vue'
import { DomainInconsistentError, GatewayVerificationError, UnknownDomainError } from 'zeno-client'
import type { Head, TagName } from 'zeno-client'
import InconsistentBanner from './InconsistentBanner.vue'

const props = defineProps<{
  domainId: number
  /** The tag the reader selected. */
  tag: TagName
  /** The tag that answered. It differs from `tag` when `pending` fell back to `latest`. */
  answeredTag: TagName
  head: Head | null
  /** What the last failed read threw. */
  cause: unknown
  error: string | null
}>()

const inconsistent = computed(() => props.cause instanceof DomainInconsistentError)
const unknownDomain = computed(() => props.cause instanceof UnknownDomainError)
const failedCheck = computed(() => props.cause instanceof GatewayVerificationError)
</script>

<template>
  <div class="space-y-4" data-slot="list-notices">
    <Alert v-if="answeredTag !== tag" data-slot="tag-fallback">
      <AlertTitle>Showing the latest accepted state</AlertTitle>
      <AlertDescription>This gateway does not serve pending state.</AlertDescription>
    </Alert>

    <InconsistentBanner
      v-if="inconsistent && head?.status !== 'INCONSISTENT'"
      :domain-id="domainId"
      :inconsistent-at="head?.inconsistentAt ?? null"
      :detail="inconsistent ? (error ?? undefined) : undefined"
    />

    <Alert v-if="unknownDomain" data-slot="unknown-domain">
      <AlertDescription>This gateway does not serve domain {{ domainId }}</AlertDescription>
    </Alert>
    <Alert v-else-if="failedCheck" variant="destructive" data-slot="failed-check">
      <TriangleAlertIcon />
      <div>
        <AlertTitle>A check failed</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </div>
    </Alert>
    <p v-else-if="error && !inconsistent" role="alert" class="text-sm text-destructive">{{ error }}</p>
  </div>
</template>
