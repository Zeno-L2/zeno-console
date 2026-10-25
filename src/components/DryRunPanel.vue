<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
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
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from 'nom-ui'
import type { ContractInterface } from 'zeno-client'
import { EventList } from '@/components'
import { formatValue, useSettings } from '@/core'
import { TriangleAlertIcon, Trash2Icon } from '@lucide/vue'
import PayloadForm from '@/components/PayloadForm.vue'
import { MAX_DRY_RUN_STEPS, useDryRun } from '@/core/composables/useDryRun'
import { ZENO_EXEC_RELEASES_URL, serveCommand } from '@/core/local-runner'

const props = defineProps<{
  moduleBytes: Uint8Array
  iface: ContractInterface | null
}>()

const { settings } = useSettings()
const dry = useDryRun(toRef(props, 'moduleBytes'), toRef(props, 'iface'))
const attempted = ref(false)
const atLimit = computed(() => dry.steps.value.length >= MAX_DRY_RUN_STEPS)
const startCommand = computed(() => serveCommand(window.location.origin, settings.value.localRunnerUrl))

function onRun() {
  attempted.value = true
  dry.run()
}
</script>

<template>
  <Card data-slot="dry-run">
    <CardHeader>
      <CardTitle>Test before deploy</CardTitle>
      <CardDescription>
        Runs this module in zeno-exec on your computer. Nothing is sent and no wallet is needed.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      <p v-if="dry.version.value" class="text-ledger text-muted-foreground">
        zeno-exec {{ dry.version.value.version }} ({{ dry.version.value.revision.slice(0, 12) }})
      </p>

      <div
        v-for="step in dry.steps.value"
        :key="step.id"
        class="space-y-4 rounded-md border p-4"
        data-slot="dry-run-step"
      >
        <div class="flex items-center justify-between">
          <Badge variant="secondary">{{ step.kind === 'deposit' ? 'Deposit' : 'Call' }}</Badge>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove step"
            @click="dry.removeStep(step.id)"
          >
            <Trash2Icon />
          </Button>
        </div>

        <template v-if="step.kind === 'call'">
          <template v-if="iface">
            <Field>
              <FieldLabel>Method</FieldLabel>
              <Select
                :model-value="step.method"
                @update:model-value="dry.selectMethod(step.id, String($event))"
              >
                <SelectTrigger class="font-mono"
                  ><SelectValue placeholder="Choose a method"
                /></SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="m in iface.methods"
                    :key="m.name"
                    :value="m.name"
                    class="font-mono"
                  >
                    {{ m.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <PayloadForm
              v-model="step.argTexts"
              :params="iface.methods.find((m) => m.name === step.method)?.inputs ?? []"
              :show-errors="attempted"
              :id-prefix="`step-${step.id}-arg`"
            />
          </template>
          <Field v-else>
            <FieldLabel :for="`step-${step.id}-payload`">Payload (hex)</FieldLabel>
            <Textarea
              :id="`step-${step.id}-payload`"
              v-model="step.payloadHex"
              class="font-mono"
              rows="3"
            />
          </Field>
        </template>

        <div class="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel :for="`step-${step.id}-token`">Token standard</FieldLabel>
            <Input :id="`step-${step.id}-token`" v-model="step.token" class="font-mono" />
            <p v-if="dry.assetIdOf(step.token)" class="text-sm">
              <span class="text-ledger text-muted-foreground">Asset id</span>
              <span class="block font-mono text-xs break-all">{{ dry.assetIdOf(step.token) }}</span>
            </p>
          </Field>
          <Field>
            <FieldLabel :for="`step-${step.id}-amount`">Amount (base units)</FieldLabel>
            <Input :id="`step-${step.id}-amount`" v-model="step.amount" numeric />
          </Field>
        </div>

        <p v-if="attempted && dry.stepProblem(step)" class="text-sm text-destructive">
          {{ dry.stepProblem(step) }}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <Button variant="outline" :disabled="atLimit" @click="dry.addStep('deposit')"
          >Add deposit</Button
        >
        <Button variant="outline" :disabled="atLimit" @click="dry.addStep('call')">Add call</Button>
        <Button :disabled="dry.isRunning.value" @click="onRun">Run</Button>
      </div>

      <p v-if="dry.error.value" role="alert" class="text-sm text-destructive">
        {{ dry.error.value }}
      </p>

      <Alert v-if="dry.unreachable.value">
        <TriangleAlertIcon />
        <div class="space-y-2">
          <AlertTitle>zeno-exec is not answering</AlertTitle>
          <AlertDescription>
            <p>Start it on this computer, then run again:</p>
            <pre class="my-2 rounded-md bg-muted p-2 font-mono text-xs">{{ startCommand }}</pre>
            <p>
              Configured URL: <span class="font-mono text-xs">{{ settings.localRunnerUrl }}</span>
            </p>
            <a :href="ZENO_EXEC_RELEASES_URL" target="_blank" rel="noopener" class="underline">
              Download zeno-exec
            </a>
          </AlertDescription>
        </div>
      </Alert>

      <div
        v-for="(row, i) in dry.rows.value"
        :key="i"
        class="space-y-4 rounded-md border p-4"
        data-slot="dry-run-row"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="font-medium">{{ row.label }}</p>
          <Badge v-if="row.details" :variant="row.details.tone">{{ row.details.status }}</Badge>
        </div>
        <p v-if="row.error" class="text-sm text-destructive">{{ row.error }}</p>
        <p v-if="row.details" class="text-sm text-muted-foreground">{{ row.details.explanation }}</p>
        <template v-if="row.details">
          <div class="grid gap-6 sm:grid-cols-2">
            <DescriptionItem label="Gas used">
              <span class="font-mono tabular-nums">{{ row.details.gasUsed }}</span>
            </DescriptionItem>
            <DescriptionItem label="Abort code">
              <span class="font-mono tabular-nums">{{ row.details.abortCode }}</span>
            </DescriptionItem>
          </div>
          <div
            v-if="row.details.error"
            class="space-y-2 rounded-md border border-destructive/50 p-3"
          >
            <p class="font-medium text-destructive">{{ row.details.error.name }}</p>
            <DescriptionItem
              v-for="(value, name) in row.details.error.fields"
              :key="name"
              :label="String(name)"
            >
              <span class="font-mono break-all tabular-nums">{{ formatValue(value) }}</span>
            </DescriptionItem>
          </div>
          <div v-if="row.details.returnValue !== undefined" class="space-y-2">
            <p class="text-ledger text-muted-foreground">Return value</p>
            <div class="grid gap-3 sm:grid-cols-2">
              <DescriptionItem
                v-for="(value, name) in row.details.returnValue"
                :key="name"
                :label="String(name)"
              >
                <span class="font-mono break-all tabular-nums">{{ formatValue(value) }}</span>
              </DescriptionItem>
            </div>
          </div>
          <p v-if="row.details.decodeError" role="alert" class="text-sm text-destructive">
            {{ row.details.decodeError }}
          </p>
          <EventList :events="row.details.events" />
        </template>
      </div>
    </CardContent>
  </Card>
</template>
