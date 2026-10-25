<script setup lang="ts">
import { computed, toRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionItem,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from 'nom-ui'
import { settlement } from 'znn-typescript-sdk'
import type { ContractFeatures, ContractInterface, TagName } from 'zeno-client'
import { EventList, ReceiptView, VerificationBadge } from '@/components'
import { formatValue, useTxTracker } from '@/core'
import { TriangleAlertIcon } from '@lucide/vue'
import PayloadForm from '@/components/PayloadForm.vue'
import { useContractCall } from '@/core/composables/useContractCall'
import { useWalletProvider } from '@/core/composables/useWalletProvider'

const props = defineProps<{
  domainId: number
  contractId: string
  iface: ContractInterface | null
  features: ContractFeatures | null
  tag: TagName
}>()

const wallet = useWalletProvider()
const call = useContractCall({
  domainId: toRef(props, 'domainId'),
  contractId: toRef(props, 'contractId'),
  iface: toRef(props, 'iface'),
  features: toRef(props, 'features'),
  tag: toRef(props, 'tag'),
})
const tracker = useTxTracker()

// The first method is selected for the user, so the form is never empty.
watch(
  () => props.iface,
  (iface) => {
    if (iface && !iface.methods.some((m) => m.name === call.methodName.value) && iface.methods[0]) {
      call.selectMethod(iface.methods[0].name)
    }
  },
  { immediate: true }
)

watch(call.sentHash, (hash) => {
  if (hash) tracker.track(hash)
})

const showArgErrors = computed(() => call.simulation.value !== null || call.error.value !== null)
const sim = computed(() => call.details.value)
const receipt = computed(() => tracker.state.value?.receipt)
</script>

<template>
  <div class="space-y-6" data-slot="call-tab">
    <Card>
      <CardHeader>
        <CardTitle>Call</CardTitle>
        <CardDescription>
          {{
            call.hasInterface.value
              ? 'Pick a method and enter its arguments.'
              : 'No interface file is loaded, so enter the payload as hex.'
          }}
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <template v-if="call.hasInterface.value">
          <Field>
            <FieldLabel>Method</FieldLabel>
            <Select :model-value="call.methodName.value" @update:model-value="call.selectMethod(String($event))">
              <SelectTrigger class="font-mono"><SelectValue placeholder="Choose a method" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="m in iface?.methods" :key="m.name" :value="m.name" class="font-mono">
                  {{ m.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription v-if="call.isReadMethod.value">
              This method only reads. It runs as a simulation: no wallet prompt, no send and no fee.
            </FieldDescription>
          </Field>
          <PayloadForm v-model="call.argTexts.value" :params="call.methodParams.value" :show-errors="showArgErrors" />
        </template>
        <Field v-else>
          <FieldLabel for="raw-payload">Payload (hex)</FieldLabel>
          <Textarea id="raw-payload" v-model="call.rawPayload.value" class="font-mono" rows="3" />
        </Field>

        <div class="grid gap-6 sm:grid-cols-2">
          <Field>
            <FieldLabel for="plasma-limit">Plasma limit (L2 gas)</FieldLabel>
            <Input id="plasma-limit" v-model="call.plasmaLimit.value" numeric />
            <FieldDescription v-if="call.plasma.value.problem" class="text-destructive">
              {{ call.plasma.value.problem }}
            </FieldDescription>
            <FieldDescription v-else-if="call.suggestedPlasma.value !== null">
              The simulation used {{ call.simulation.value?.gasUsed }}.
              <button type="button" class="underline" @click="call.applySuggestedPlasma()">
                Use {{ call.suggestedPlasma.value }}
              </button>
            </FieldDescription>
          </Field>
          <div class="space-y-1 text-sm">
            <p class="text-ledger text-muted-foreground">Payload</p>
            <p class="font-mono tabular-nums">{{ call.payloadSize.value }} / {{ settlement.MaxCallPayload }} bytes</p>
            <p v-if="call.l1Plasma.value !== null" class="text-muted-foreground">
              Needs <span class="font-mono tabular-nums">{{ call.l1Plasma.value }}</span> L1 plasma<span v-if="call.l1Plasma.value > settlement.MAX_POW_PLASMA">, more than proof of work supplies. Fuse QSR first.</span>
            </p>
            <p v-if="call.payload.value.problem" class="text-destructive">{{ call.payload.value.problem }}</p>
          </div>
        </div>

        <div v-if="call.canDeposit.value" class="space-y-3">
          <div class="flex items-center gap-2">
            <Switch id="deposit-on" v-model="call.depositEnabled.value" />
            <Label for="deposit-on">Attach a deposit</Label>
          </div>
          <div v-if="call.depositEnabled.value" class="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel for="deposit-token">Token standard</FieldLabel>
              <Input id="deposit-token" v-model="call.depositToken.value" class="font-mono" />
            </Field>
            <Field>
              <FieldLabel for="deposit-amount">Amount</FieldLabel>
              <Input id="deposit-amount" v-model="call.depositAmount.value" numeric />
            </Field>
          </div>
        </div>

        <p v-if="call.error.value" role="alert" class="text-sm text-destructive">{{ call.error.value }}</p>

        <div class="flex flex-wrap items-center gap-3">
          <Button :variant="call.isReadMethod.value ? 'default' : 'outline'" :disabled="!call.canSimulate.value || call.isSimulating.value" @click="call.simulate()">
            {{ call.isReadMethod.value ? 'Read' : 'Preview' }}
          </Button>
          <Button
            v-if="!call.isReadMethod.value"
            :disabled="!call.canSimulate.value || call.isSending.value || !wallet.isConnected.value"
            @click="call.send()"
          >
            {{ call.isSending.value ? 'Waiting for wallet' : 'Send' }}
          </Button>
          <span v-if="!wallet.isConnected.value && !call.isReadMethod.value" class="text-sm text-muted-foreground">
            Connect a wallet to send.
          </span>
        </div>
      </CardContent>
    </Card>

    <Card v-if="sim && call.simulation.value" data-slot="simulation">
      <CardHeader class="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{{ call.isReadMethod.value ? 'Result' : 'Preview' }}</CardTitle>
        <div class="flex items-center gap-2">
          <Badge :variant="sim.tone">{{ sim.status }}</Badge>
          <VerificationBadge :verified="false" />
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <Alert v-if="sim.tone === 'destructive' && !call.isReadMethod.value">
          <TriangleAlertIcon />
          <div>
            <AlertTitle>The call would fail</AlertTitle>
            <AlertDescription>You can still send it. The wallet opens as usual.</AlertDescription>
          </div>
        </Alert>
        <div class="grid gap-6 sm:grid-cols-3">
          <DescriptionItem label="Gas used">
            <span class="font-mono tabular-nums">{{ sim.gasUsed }}</span>
          </DescriptionItem>
          <DescriptionItem label="Read at">{{ call.simulatedAt.value }}</DescriptionItem>
          <DescriptionItem label="Abort code">
            <span class="font-mono tabular-nums">{{ sim.abortCode }}</span>
          </DescriptionItem>
        </div>
        <div v-if="sim.error" class="space-y-2 rounded-md border border-destructive/50 p-3">
          <p class="font-medium text-destructive">{{ sim.error.name }}</p>
          <DescriptionItem v-for="(value, name) in sim.error.fields" :key="name" :label="String(name)">
            <span class="font-mono tabular-nums break-all">{{ formatValue(value) }}</span>
          </DescriptionItem>
        </div>
        <div v-if="sim.returnValue !== undefined" class="space-y-2">
          <p class="text-ledger text-muted-foreground">Return value</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <DescriptionItem v-for="(value, name) in sim.returnValue" :key="name" :label="String(name)">
              <span class="font-mono tabular-nums break-all">{{ formatValue(value) }}</span>
            </DescriptionItem>
          </div>
        </div>
        <p v-if="sim.decodeError" role="alert" class="text-sm text-destructive">{{ sim.decodeError }}</p>
        <EventList :events="sim.events" />
      </CardContent>
    </Card>

    <Card v-if="call.sentHash.value" data-slot="sent">
      <CardHeader>
        <CardTitle>Sent</CardTitle>
        <CardDescription>
          <RouterLink :to="`/tx/${call.sentHash.value}`" class="font-mono text-xs break-all underline">
            {{ call.sentHash.value }}
          </RouterLink>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ReceiptView v-if="receipt" :receipt="receipt" :iface="iface" :proof="tracker.state.value?.proof" />
        <p v-else class="text-sm text-muted-foreground">Waiting for the receipt.</p>
      </CardContent>
    </Card>
  </div>
</template>
