<script setup lang="ts">
import { computed } from 'vue'
import type { ContractInterface, DomainStatus, ReceiptResult } from 'zeno-client'
import { CircleDashedIcon, TriangleAlertIcon } from '@lucide/vue'
import { ZNN_ZTS, settlement } from 'znn-typescript-sdk'
import { Address, Alert, AlertDescription, AlertTitle, Amount, Badge, DescriptionItem, HexView } from 'nom-ui'
import { formatZnn } from '../core/labels'
import { describeReceipt, formatValue } from '../core/receipt'
import { bindingsChecked, fieldsChecked } from '../core/tx-tracker-service'
import type { ReceiptCheck } from '../core/tx-tracker-service'
import EventList from './EventList.vue'
import VerificationBadge from './VerificationBadge.vue'

const props = defineProps<{
  receipt: ReceiptResult
  /** The contract's interface, for decoding the return value, error and events. */
  iface?: ContractInterface | null
  domainStatus?: DomainStatus | null
  /** The console's check of the receipt. Every field it has not checked is marked. */
  proof?: ReceiptCheck | null
}>()

const details = computed(() => describeReceipt(props.receipt, props.iface))
const znnAssetId = settlement.assetIdFromZts(ZNN_ZTS).toString()
const verified = computed(() => props.proof?.state === 'verified')
const checked = computed(() => fieldsChecked(props.proof))
const bound = computed(() => bindingsChecked(props.proof))
/** A field label, marked while the console has not checked the field. */
const mark = (label: string, checked: boolean) => (checked ? label : `${label} (unchecked)`)
</script>

<template>
  <div class="space-y-6" data-slot="receipt-view">
    <div class="flex flex-wrap items-center gap-3">
      <Badge :variant="details.tone">{{ mark(details.status, checked) }}</Badge>
      <VerificationBadge :verified="verified" :failed="proof?.state === 'failed'" :domain-status="domainStatus" />
      <span class="text-ledger text-muted-foreground">read at {{ receipt.tag }}<span v-if="!verified"> (unchecked)</span></span>
    </div>

    <Alert v-if="proof?.state === 'failed'" variant="destructive" data-slot="receipt-check-failed">
      <TriangleAlertIcon />
      <div>
        <AlertTitle>The receipt failed a check</AlertTitle>
        <AlertDescription>{{ proof.reason }}</AlertDescription>
      </div>
    </Alert>
    <Alert v-else-if="proof?.state === 'waiting'" data-slot="receipt-check-waiting">
      <CircleDashedIcon />
      <div>
        <AlertTitle>The receipt is not checked yet</AlertTitle>
        <AlertDescription>{{ proof.reason }}</AlertDescription>
      </div>
    </Alert>

    <Alert :variant="details.tone === 'destructive' ? 'destructive' : 'default'" data-slot="status-explanation">
      <AlertDescription>
        <p>{{ details.explanation }}</p>
        <p v-if="details.refund">
          Your deposit was refunded to <Address :address="details.refund.recipient" />:
          <Amount
            v-if="details.refund.assetId === znnAssetId"
            :value="formatZnn(BigInt(details.refund.amount))"
            symbol="ZNN"
          />
          <template v-else>
            <span class="font-mono tabular-nums">{{ details.refund.amount }}</span> units of
            <Address :address="details.refund.assetId" />
          </template>
          <span v-if="!checked"> (unchecked)</span>
        </p>
        <p v-else-if="details.refundsDeposit">Any deposit is refunded when a call fails.</p>
      </AlertDescription>
    </Alert>

    <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <DescriptionItem :label="mark('Domain', bound)">
        <span class="font-mono tabular-nums">{{ receipt.domainId }}</span>
      </DescriptionItem>
      <DescriptionItem :label="mark('Batch', checked)">
        <span class="font-mono tabular-nums">{{ receipt.batchId }}</span>
      </DescriptionItem>
      <DescriptionItem :label="mark('Input index', checked)">
        <span class="font-mono tabular-nums">{{ receipt.globalInputIndex }}</span>
      </DescriptionItem>
      <DescriptionItem :label="mark('Sender', bound)"><Address :address="receipt.sender" /></DescriptionItem>
      <DescriptionItem :label="mark('Gas used', checked)">
        <span class="font-mono tabular-nums">{{ details.gasUsed }}</span>
      </DescriptionItem>
      <DescriptionItem :label="mark('Abort code', checked)">
        <span class="font-mono tabular-nums">{{ details.abortCode }}</span>
      </DescriptionItem>
      <DescriptionItem :label="mark('Contract', checked)">
        <Address :address="receipt.receipt.contractId" />
      </DescriptionItem>
      <DescriptionItem v-if="receipt.input" :label="mark('Input', checked)">{{ receipt.input.kind }}</DescriptionItem>
      <DescriptionItem v-if="details.method" :label="mark('Method', checked)">
        <span class="font-mono">{{ details.method }}</span>
      </DescriptionItem>
    </div>

    <div v-if="details.error" class="space-y-2 rounded-md border border-destructive/50 p-3">
      <p class="font-medium text-destructive">{{ mark(details.error.name, checked) }}</p>
      <div class="grid gap-3 sm:grid-cols-2">
        <DescriptionItem v-for="(value, name) in details.error.fields" :key="name" :label="String(name)">
          <span class="font-mono tabular-nums break-all">{{ formatValue(value) }}</span>
        </DescriptionItem>
      </div>
    </div>

    <DescriptionItem v-if="details.deployed" :label="mark('Deployed', checked)">
      <div class="space-y-1 font-mono text-xs break-all">
        <p>code_hash {{ details.deployed.sourceCodeHash }}</p>
        <p>CodeHash {{ details.deployed.codeHash }}</p>
      </div>
    </DescriptionItem>
    <DescriptionItem v-if="details.upgraded" :label="mark('Upgraded', checked)">
      <div class="space-y-1 font-mono text-xs break-all">
        <p>from {{ details.upgraded.oldCodeHash }}</p>
        <p>to {{ details.upgraded.newCodeHash }}</p>
      </div>
    </DescriptionItem>

    <div v-if="details.returnValue !== undefined" class="space-y-2">
      <p class="text-ledger text-muted-foreground">{{ mark('Return value', checked) }}</p>
      <div class="grid gap-3 sm:grid-cols-2">
        <DescriptionItem v-for="(value, name) in details.returnValue" :key="name" :label="String(name)">
          <span class="font-mono tabular-nums break-all">{{ formatValue(value) }}</span>
        </DescriptionItem>
      </div>
    </div>
    <HexView v-else-if="receipt.returnData" :value="receipt.returnData" :label="mark('Return data', checked)" />

    <p v-if="details.decodeError" role="alert" class="text-sm text-destructive">{{ details.decodeError }}</p>

    <div class="space-y-2">
      <p class="text-ledger text-muted-foreground">{{ mark('Events', checked) }}</p>
      <EventList :events="details.events" />
    </div>

    <p v-if="receipt.outbox.length > 0" class="text-sm text-muted-foreground">
      This input emitted <span class="font-mono tabular-nums">{{ receipt.outbox.length }}</span> outbox
      message{{ receipt.outbox.length === 1 ? '' : 's' }}.<span v-if="!checked"> (unchecked)</span>
    </p>
  </div>
</template>
