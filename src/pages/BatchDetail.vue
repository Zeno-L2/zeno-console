<script setup lang="ts">
import { computed, onMounted, onScopeDispose, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  Address,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionItem,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'nom-ui'
import { TriangleAlertIcon } from '@lucide/vue'
import { VerificationBadge } from '@/components'
import { daModeLabel } from '@/core'
import { useBatch, useDomainHeads } from '@/core'
import InconsistentBanner from '@/components/InconsistentBanner.vue'
import RpcJson from '@/components/RpcJson.vue'

const route = useRoute()
const domainId = computed(() => Number(route.params.domainId))
const batchId = computed(() => Number(route.params.batchId))

const batch = useBatch(domainId, batchId)
const { heads, follow } = useDomainHeads()
const head = computed(() => heads.value[domainId.value] ?? null)

let stop: (() => void) | null = null
watch(
  domainId,
  (id) => {
    stop?.()
    stop = follow(id)
  },
  { immediate: true }
)
onScopeDispose(() => stop?.())

onMounted(batch.load)
watch([domainId, batchId], batch.load)

const l1 = batch.l1
const l2 = batch.l2
/** Settlement has not accepted a batch the gateway serves. */
const isPending = computed(
  () => l1.value === null && l2.value !== null && batch.error.value === null
)
const isMissing = computed(
  () => l1.value === null && batch.l2Missing.value && batch.error.value === null
)
const check = computed(() =>
  l2.value ? { proofs: 0, rootChecked: l2.value.check.rootChecked, pathsChecked: false } : null
)

const roots = computed(() => {
  const b = l2.value
  if (!b) return []
  return [
    { label: 'Pre-state root', value: b.preStateRoot },
    { label: 'Post-state root', value: b.postStateRoot },
    { label: 'Input root', value: b.inputRoot },
    { label: 'Receipt root', value: b.receiptRoot },
    { label: 'Event root', value: b.eventRoot },
    { label: 'Outbox root', value: b.outboxRoot },
    { label: 'DA hash', value: b.daHash },
  ]
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-2xl font-semibold tracking-tight">Batch {{ batchId }}</h2>
      <div class="flex flex-wrap items-center gap-3">
        <RouterLink :to="`/domains/${domainId}`" class="text-sm text-info underline-offset-4 hover:underline">
          Domain {{ domainId }}
        </RouterLink>
        <VerificationBadge
          v-if="l2 || batch.failedCheck.value"
          :verified="l2?.verified ?? false"
          :check="check"
          :domain-status="head?.status"
          :failed="batch.failedCheck.value"
        />
      </div>
    </div>

    <InconsistentBanner
      v-if="head?.status === 'INCONSISTENT' || batch.inconsistent.value"
      :domain-id="domainId"
      :inconsistent-at="head?.inconsistentAt ?? null"
      :detail="batch.inconsistent.value ?? undefined"
    />

    <Alert v-if="batch.failedCheck.value" variant="destructive">
      <TriangleAlertIcon />
      <div>
        <AlertTitle>A check failed</AlertTitle>
        <AlertDescription>{{ batch.error.value }}</AlertDescription>
      </div>
    </Alert>
    <p v-else-if="batch.error.value" role="alert" class="text-sm text-destructive">{{ batch.error.value }}</p>
    <Alert v-if="batch.l2Error.value" data-slot="batch-l2-error">
      <AlertDescription>{{ batch.l2Error.value }}</AlertDescription>
    </Alert>

    <Skeleton v-if="batch.isLoading.value && !l1 && !l2" class="h-64 w-full" />

    <EmptyState v-else-if="isMissing" data-slot="batch-missing">
      No batch {{ batchId }} in domain {{ domainId }}
    </EmptyState>

    <template v-else-if="l1 || l2">
      <Alert v-if="isPending" data-slot="batch-pending">
        <AlertDescription>Settlement has not accepted batch {{ batchId }} yet</AlertDescription>
      </Alert>
      <Alert v-else-if="batch.l2Missing.value" data-slot="batch-unindexed">
        <AlertDescription>The gateway has not indexed this batch yet</AlertDescription>
      </Alert>

      <Card v-if="l1" data-slot="batch-l1">
        <CardHeader class="flex-row items-center justify-between gap-2">
          <CardTitle>Settlement</CardTitle>
          <Badge :variant="l1.isFinalized ? 'success' : 'pending'">{{ l1.isFinalized ? 'Finalized' : 'Submitted' }}</Badge>
        </CardHeader>
        <CardContent class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <DescriptionItem label="Executor pillar">{{ l1.executorPillar }}</DescriptionItem>
          <DescriptionItem label="Inputs">
            <span class="font-mono tabular-nums">{{ l1.firstInputSeq }} to {{ l1.lastInputSeq }}</span>
          </DescriptionItem>
          <DescriptionItem label="DA mode">{{ daModeLabel(l1.daMode) }}</DescriptionItem>
          <DescriptionItem label="Protocol version">
            <span class="font-mono tabular-nums">{{ l1.protocolVersion }}</span>
          </DescriptionItem>
          <DescriptionItem label="Submitted at">
            <span class="font-mono tabular-nums">{{ l1.submittedAtHeight }}</span>
          </DescriptionItem>
          <DescriptionItem :label="l1.isFinalized ? 'Finalized at' : 'Finalizes at'">
            <span class="font-mono tabular-nums">{{ l1.finalizeAtHeight }}</span>
          </DescriptionItem>
        </CardContent>
      </Card>

      <template v-if="l2">
        <Card data-slot="batch-l2">
          <CardHeader>
            <CardTitle>Commitments</CardTitle>
          </CardHeader>
          <CardContent class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <DescriptionItem v-for="root in roots" :key="root.label" :label="root.label">
              <Address :address="root.value" :start="10" :end="8" />
            </DescriptionItem>
            <DescriptionItem label="Inputs">
              <span class="font-mono tabular-nums">{{ l2.firstInputSeq }} to {{ l2.lastInputSeq }}</span>
            </DescriptionItem>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inputs</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState v-if="l2.inputs.length === 0">This batch holds no input.</EmptyState>
            <Table v-else density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>Index</TableHead>
                  <TableHead>Send hash</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="input in l2.inputs" :key="input.globalInputIndex">
                  <TableCell class="font-mono tabular-nums">{{ input.globalInputIndex }}</TableCell>
                  <TableCell>
                    <Address :address="input.sendHash" :link-as="RouterLink" :to="`/tx/${input.sendHash}`" :start="10" :end="8" />
                  </TableCell>
                  <TableCell>{{ input.status }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <RpcJson :data="l2" :rpc="{ method: 'zeno_getBatch', params: [domainId, batchId] }" />
      </template>
    </template>
  </div>
</template>
