<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Address, Alert, AlertDescription, AlertTitle, Amount, Badge, Card, CardContent, CardHeader, CardTitle, DescriptionItem, Skeleton } from 'nom-ui'
import { TriangleAlertIcon } from '@lucide/vue'
import { DomainInconsistentError, NotFoundError, UnknownDomainError } from 'zeno-client'
import type { OutboxItem, OutboxProofResult } from 'zeno-client'
import { OutboxProofError, WITHDRAWAL_STATE_LABEL, WithdrawalReadService, describeAsset } from '@/core'
import { VerificationBadge } from '@/components'
import type { WithdrawalState } from '@/core'
import { useLiveHead } from '@/core'
import InconsistentBanner from '@/components/InconsistentBanner.vue'
import RpcJson from '@/components/RpcJson.vue'

const route = useRoute()
const outboxId = computed(() => String(route.params.outboxId ?? '').toLowerCase())
const valid = computed(() => /^[0-9a-f]{64}$/.test(outboxId.value))

const proof = ref<OutboxProofResult | null>(null)
const state = ref<WithdrawalState | null>(null)
const isLoading = ref(false)
/** The text of an OutboxProofError: a check on the proof failed. */
const proofError = ref<string | null>(null)
const inconsistent = ref<string | null>(null)
const error = ref<string | null>(null)
// Only the latest load may write state.
let requestId = 0
let loaded: string | null = null

async function load() {
  if (!valid.value) return
  const id = ++requestId
  const target = outboxId.value
  if (target !== loaded) {
    proof.value = null
    state.value = null
    loaded = target
  }
  isLoading.value = true
  proofError.value = null
  inconsistent.value = null
  error.value = null
  try {
    const service = WithdrawalReadService.getInstance()
    const result = await service.checkProof(target)
    if (id !== requestId) return
    proof.value = result
    const item: OutboxItem = { ...result.decoded, batchId: result.batchId, verified: result.verified }
    state.value = (await service.statesOf(result.domainId, [item])).get(item.outboxId) ?? null
  } catch (err) {
    if (id !== requestId) return
    if (err instanceof OutboxProofError) {
      proofError.value = err.message
      proof.value = null
      state.value = null
    } else if (err instanceof DomainInconsistentError) inconsistent.value = err.message
    else if (err instanceof NotFoundError) error.value = 'No outbox message has this id'
    else if (err instanceof UnknownDomainError) error.value = err.message
    else error.value = err instanceof Error ? err.message : 'The outbox message could not be read.'
  } finally {
    if (id === requestId) isLoading.value = false
  }
}

onMounted(load)
watch(outboxId, load)

// A pending message turns verified when its batch reaches Settlement.
const head = useLiveHead(
  computed(() => proof.value?.domainId ?? null),
  load
)

const isPending = computed(() => proof.value !== null && !proof.value.verified)
const check = computed(() => (proof.value?.verified ? { proofs: 1, rootChecked: true, pathsChecked: true } : null))
</script>

<template>
  <Alert v-if="!valid" variant="destructive">
    <TriangleAlertIcon />
    <div>
      <AlertTitle>Not an outbox id</AlertTitle>
      <AlertDescription>An outbox id is 64 hex characters.</AlertDescription>
    </div>
  </Alert>

  <div v-else class="mx-auto max-w-3xl space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-2xl font-semibold tracking-tight">Outbox message</h2>
        <Address :address="outboxId" :start="12" :end="8" />
      </div>
      <VerificationBadge
        v-if="proof || proofError"
        :verified="proof?.verified ?? false"
        :check="check"
        :domain-status="head?.status"
        :failed="proofError !== null"
      />
    </div>

    <InconsistentBanner
      v-if="proof && (head?.status === 'INCONSISTENT' || inconsistent)"
      :domain-id="proof.domainId"
      :inconsistent-at="head?.inconsistentAt ?? null"
      :detail="inconsistent ?? undefined"
    />
    <p v-else-if="inconsistent" role="alert" class="text-sm text-destructive">{{ inconsistent }}</p>

    <Alert v-if="proofError" variant="destructive" data-slot="proof-error">
      <TriangleAlertIcon />
      <div>
        <AlertTitle>The inclusion proof failed a check</AlertTitle>
        <AlertDescription>{{ proofError }}</AlertDescription>
      </div>
    </Alert>
    <p v-else-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>

    <Skeleton v-if="isLoading && !proof && !proofError" class="h-48 w-full" />

    <template v-else-if="proof">
      <Alert v-if="isPending" data-slot="proof-pending">
        <AlertDescription>Settlement has not accepted batch {{ proof.batchId }} yet</AlertDescription>
      </Alert>
      <Alert v-else data-slot="proof-match">
        <AlertDescription>The inclusion proof matches the outbox root Settlement recorded for batch {{ proof.batchId }}.</AlertDescription>
      </Alert>

      <Card>
        <CardHeader class="flex-row items-center justify-between gap-2">
          <CardTitle>Message</CardTitle>
          <Badge v-if="state" :variant="WITHDRAWAL_STATE_LABEL[state].variant" data-slot="withdrawal-state">{{ WITHDRAWAL_STATE_LABEL[state].label }}</Badge>
        </CardHeader>
        <CardContent class="grid gap-6 sm:grid-cols-2">
          <DescriptionItem label="Domain">
            <RouterLink :to="`/domains/${proof.domainId}`" class="font-mono tabular-nums text-info underline-offset-4 hover:underline">
              {{ proof.domainId }}
            </RouterLink>
          </DescriptionItem>
          <DescriptionItem label="Batch">
            <RouterLink
              :to="`/batches/${proof.domainId}/${proof.batchId}`"
              class="font-mono tabular-nums text-info underline-offset-4 hover:underline"
            >
              {{ proof.batchId }}
            </RouterLink>
          </DescriptionItem>
          <DescriptionItem label="Kind">{{ proof.decoded.kind }}</DescriptionItem>
          <DescriptionItem label="Source contract">
            <Address :address="proof.decoded.sourceContract" :link-as="RouterLink" :to="`/contracts/${proof.domainId}/${proof.decoded.sourceContract}`" :start="10" :end="8" />
          </DescriptionItem>
          <DescriptionItem v-if="proof.decoded.recipient" label="Recipient">
            <Address :address="proof.decoded.recipient" :link-as="RouterLink" :to="`/address/${proof.decoded.recipient}?domain=${proof.domainId}`" />
          </DescriptionItem>
          <DescriptionItem v-if="proof.decoded.amount" label="Amount">
            <Amount
              :value="describeAsset(proof.decoded.assetId ?? '', proof.decoded.amount).value"
              :symbol="describeAsset(proof.decoded.assetId ?? '', proof.decoded.amount).symbol"
            />
          </DescriptionItem>
          <DescriptionItem label="Outbox root">
            <Address :address="proof.outboxRoot" :start="10" :end="8" />
          </DescriptionItem>
          <DescriptionItem label="Input index">
            <span class="font-mono tabular-nums">{{ proof.decoded.inputIndex }}</span>
          </DescriptionItem>
        </CardContent>
      </Card>

      <RpcJson :data="proof" :rpc="{ method: 'zeno_getOutboxProof', params: [outboxId] }" />
    </template>
  </div>
</template>
