<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Alert, AlertDescription, AlertTitle, Card, CardContent, CardDescription, CardHeader, CardTitle } from 'nom-ui'
import { TriangleAlertIcon } from '@lucide/vue'
import type { ContractInterface } from 'zeno-client'
import { InterfaceResolver, bindingsChecked, fieldsChecked, useTxTracker } from '@/core'
import { ReceiptView, SendStages } from '@/components'
import { useLiveHead } from '@/core'
import InconsistentBanner from '@/components/InconsistentBanner.vue'
import RpcJson from '@/components/RpcJson.vue'

const route = useRoute()
const { state, track } = useTxTracker()
const iface = ref<ContractInterface | null>(null)

const sendHash = computed(() => String(route.params.sendHash ?? '').toLowerCase())
const valid = computed(() => /^[0-9a-f]{64}$/.test(sendHash.value))
const receipt = computed(() => state.value?.receipt ?? null)
const checked = computed(() => fieldsChecked(state.value?.proof))
const bound = computed(() => bindingsChecked(state.value?.proof))

watch(sendHash, (hash) => track(hash), { immediate: true })

// The contract's saved interface, or one known for the code it runs.
watch(
  () => (receipt.value ? ([receipt.value.domainId, receipt.value.receipt.contractId] as const) : null),
  async (key) => {
    if (!key) {
      iface.value = null
      return
    }
    let found: ContractInterface | null = null
    try {
      found = await InterfaceResolver.getInstance().forContract(key[0], key[1])
    } catch {
      // The registry could not be read; the receipt stays raw.
    }
    if (receipt.value?.domainId === key[0] && receipt.value.receipt.contractId === key[1]) iface.value = found
  },
  { immediate: true }
)

const head = useLiveHead(computed(() => receipt.value?.domainId ?? null))
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <Alert v-if="!valid" variant="destructive">
      <TriangleAlertIcon />
      <div>
        <AlertTitle>Not a send hash</AlertTitle>
        <AlertDescription>A send hash is 64 hex characters.</AlertDescription>
      </div>
    </Alert>

    <template v-else>
      <Card>
        <CardHeader>
          <CardTitle>Send</CardTitle>
          <CardDescription class="font-mono text-xs break-all">{{ sendHash }}</CardDescription>
        </CardHeader>
        <CardContent>
          <SendStages :state="state" />
        </CardContent>
      </Card>

      <InconsistentBanner
        v-if="receipt && head?.status === 'INCONSISTENT'"
        :domain-id="receipt.domainId"
        :inconsistent-at="head.inconsistentAt"
      />

      <Card v-if="receipt">
        <CardHeader class="flex-row items-center justify-between gap-2">
          <CardTitle>Receipt</CardTitle>
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <RouterLink :to="`/batches/${receipt.domainId}/${receipt.batchId}`" class="text-info underline-offset-4 hover:underline">
              Batch {{ receipt.batchId }}{{ checked ? '' : ' (unchecked)' }}
            </RouterLink>
            <RouterLink
              :to="`/address/${receipt.sender}?domain=${receipt.domainId}`"
              class="text-info underline-offset-4 hover:underline"
            >
              {{ bound ? 'Sender' : 'Sender (unchecked)' }}
            </RouterLink>
          </div>
        </CardHeader>
        <CardContent>
          <ReceiptView :receipt="receipt" :iface="iface" :domain-status="head?.status" :proof="state?.proof" />
        </CardContent>
      </Card>

      <RpcJson v-if="receipt" :data="receipt" :rpc="{ method: 'zeno_getReceipt', params: [sendHash] }" />
    </template>
  </div>
</template>
