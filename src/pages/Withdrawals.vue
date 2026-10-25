<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  Address,
  Alert,
  AlertDescription,
  AlertTitle,
  Amount,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Label,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'nom-ui'
import { TriangleAlertIcon } from '@lucide/vue'
import { WITHDRAWAL_STATE_LABEL, describeAsset, useDomains } from '@/core'
import DomainSelect from '@/components/DomainSelect.vue'
import { useWalletProvider } from '@/core/composables/useWalletProvider'
import { useWithdrawals } from '@/core/composables/useWithdrawals'

const wallet = useWalletProvider()
const w = useWithdrawals()
const route = useRoute()
const router = useRouter()
const { defaultDomainId } = useDomains()

const domainId = computed(() => {
  const value = route.query.domain
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : defaultDomainId.value
})

function selectDomain(id: number) {
  router.replace({ path: route.path, query: { ...route.query, domain: String(id) } })
}

// "Mine only" lists the withdrawals addressed to the connected address. It starts on with a wallet.
const mine = ref(wallet.isConnected.value)
const recipient = computed(() => (mine.value && wallet.address.value) || null)

onMounted(() => w.load(domainId.value, recipient.value))
watch([domainId, recipient], () => w.load(domainId.value, recipient.value))
watch(
  () => wallet.address.value,
  (address, previous) => {
    if (!address) mine.value = false
    else if (!previous) mine.value = true
  }
)

// The send carries the domain of the click. The reload uses the page's current domain.
async function relay(outboxId: string) {
  await w.relay(domainId.value, outboxId)
  if (!w.error.value) await w.load(domainId.value, recipient.value)
}

const relayable = computed(() => w.withdrawals.value.filter((x) => x.state === 'relayable').length)
const emptyText = computed(() => {
  if (w.isLoading.value) return 'Reading the outbox.'
  if (w.more.value) return 'No withdrawals among the newest outbox messages.'
  return recipient.value ? 'No withdrawals are addressed to this address.' : 'No withdrawals in this domain.'
})
const queued = computed(() => w.withdrawals.value.filter((x) => x.state === 'queued').length)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-2xl font-semibold tracking-tight">Withdrawals</h2>
        <DomainSelect :model-value="domainId" @update:model-value="selectDomain" />
        <div v-if="wallet.isConnected.value" class="flex items-center gap-2">
          <Switch id="withdrawals-mine" v-model="mine" />
          <Label for="withdrawals-mine">Mine only</Label>
        </div>
      </div>
      <Button variant="outline" :disabled="w.isReleasing.value || !wallet.isConnected.value" @click="w.release(domainId)">
        {{ w.isReleasing.value ? 'Waiting for wallet' : 'Release withdrawals' }}
      </Button>
    </div>

    <Alert v-if="!wallet.isConnected.value">
      <TriangleAlertIcon />
      <div>
        <AlertTitle>Connect a wallet to relay or release</AlertTitle>
        <AlertDescription>The list shows every withdrawal of the domain. Relay and Release are open to anyone, and each needs a wallet to sign the send.</AlertDescription>
      </div>
    </Alert>

    <Alert v-if="w.relayPaused.value" variant="destructive" data-slot="relay-paused">
      <TriangleAlertIcon />
      <div>
        <AlertTitle>Relaying is paused</AlertTitle>
        <AlertDescription>Settlement rejects relays for this domain until the administrator lifts the pause.</AlertDescription>
      </div>
    </Alert>

    <p v-if="w.error.value" role="alert" class="text-sm text-destructive" data-slot="withdrawal-error">{{ w.error.value }}</p>
    <p v-if="w.lastHash.value" class="text-sm" data-slot="withdrawal-sent">
      Sent.
      <RouterLink :to="`/tx/${w.lastHash.value}`" class="font-mono text-xs break-all underline">{{ w.lastHash.value }}</RouterLink>
    </p>

    <Card>
      <CardHeader>
        <CardTitle>Withdrawals</CardTitle>
        <CardDescription>
          A relay registers a withdrawal with Settlement. After the domain's delay, anyone can release
          the queue. <span class="font-mono tabular-nums">{{ relayable }}</span> ready to relay,
          <span class="font-mono tabular-nums">{{ queued }}</span> queued.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EmptyState v-if="w.withdrawals.value.length === 0">
          {{ emptyText }}
        </EmptyState>
        <Table v-else density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>Amount</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>State</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="x in w.withdrawals.value" :key="x.item.outboxId" :data-state="x.state">
              <TableCell>
                <Amount
                  :value="describeAsset(x.item.assetId ?? '', x.item.amount).value"
                  :symbol="describeAsset(x.item.assetId ?? '', x.item.amount).symbol"
                />
              </TableCell>
              <TableCell><Address v-if="x.item.recipient" :address="x.item.recipient" :copy="false" /></TableCell>
              <TableCell class="font-mono tabular-nums">{{ x.item.batchId }}</TableCell>
              <TableCell>
                <Badge :variant="WITHDRAWAL_STATE_LABEL[x.state].variant">{{ WITHDRAWAL_STATE_LABEL[x.state].label }}</Badge>
              </TableCell>
              <TableCell class="text-right">
                <Button
                  v-if="x.state === 'relayable'"
                  size="sm"
                  :disabled="w.relayPaused.value || w.busyId.value !== null || !wallet.isConnected.value"
                  @click="relay(x.item.outboxId)"
                >
                  {{ w.busyId.value === x.item.outboxId ? 'Waiting for wallet' : 'Relay' }}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-if="w.more.value" data-slot="withdrawals-more" class="mt-3 text-sm text-muted-foreground">
          The list stops at the newest part of the outbox. Older withdrawals are not listed.
        </p>
      </CardContent>
    </Card>
  </div>
</template>
