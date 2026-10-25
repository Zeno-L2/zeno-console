<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldLabel,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
} from 'nom-ui'
import { settlement } from 'znn-typescript-sdk'
import { TriangleAlertIcon } from '@lucide/vue'
import { useSettings } from '@/core'
import { useAdmin } from '@/core/composables/useAdmin'

const admin = useAdmin()
const { settings } = useSettings()

const target = ref<'global' | 'domain'>('domain')
const domainText = ref(String(settings.value.domainId))
const scope = ref<'submit' | 'relay'>('submit')
const confirmed = ref(false)
/** True while this panel's own send runs. `admin.isSending` is shared with the time-challenged forms. */
const pausing = ref(false)

const scopeValue = computed(() =>
  scope.value === 'submit' ? settlement.PauseScope.PAUSE_SUBMIT : settlement.PauseScope.PAUSE_RELAY
)
const domainId = computed(() => (/^\d+$/.test(domainText.value) ? Number(domainText.value) : null))
const ready = computed(() => (target.value === 'global' || domainId.value !== null) && (scope.value !== 'relay' || confirmed.value))

async function apply(active: boolean) {
  pausing.value = true
  try {
    await admin.pause({
      domainId: target.value === 'global' ? 0 : (domainId.value as number),
      isGlobal: target.value === 'global',
      scope: scopeValue.value,
      active,
    })
  } finally {
    pausing.value = false
  }
}
</script>

<template>
  <Card data-slot="pause-panel">
    <CardHeader>
      <CardTitle>Pause and resume</CardTitle>
      <CardDescription>Applies at once. It is not time-challenged.</CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      <Field>
        <FieldLabel>Target</FieldLabel>
        <RadioGroup v-model="target">
          <div class="flex items-center gap-2">
            <RadioGroupItem id="t-domain" value="domain" />
            <Label for="t-domain">One domain</Label>
          </div>
          <div class="flex items-center gap-2">
            <RadioGroupItem id="t-global" value="global" />
            <Label for="t-global">Every domain</Label>
          </div>
        </RadioGroup>
      </Field>
      <Field v-if="target === 'domain'">
        <FieldLabel for="pause-domain">Domain id</FieldLabel>
        <Input id="pause-domain" v-model="domainText" numeric />
      </Field>
      <Field>
        <FieldLabel>What</FieldLabel>
        <RadioGroup v-model="scope">
          <div class="flex items-center gap-2">
            <RadioGroupItem id="s-submit" value="submit" />
            <Label for="s-submit">Batch submission</Label>
          </div>
          <div class="flex items-center gap-2">
            <RadioGroupItem id="s-relay" value="relay" />
            <Label for="s-relay">Relay</Label>
          </div>
        </RadioGroup>
      </Field>

      <Alert v-if="scope === 'relay'" variant="destructive" data-slot="relay-warning">
        <TriangleAlertIcon />
        <div>
          <AlertTitle>Pausing relay halts withdrawal release and fee settlement</AlertTitle>
          <AlertDescription>Reserve it for an active asset-safety exploit.</AlertDescription>
          <div class="mt-3 flex items-center gap-2">
            <Checkbox id="relay-confirm" v-model="confirmed" />
            <Label for="relay-confirm">I understand</Label>
          </div>
        </div>
      </Alert>

      <p v-if="admin.error.value" role="alert" class="text-sm text-destructive">{{ admin.error.value }}</p>
      <p v-if="pausing" data-slot="pause-waiting" class="text-sm text-muted-foreground">Waiting for the wallet, then for Settlement to show the change.</p>

      <div class="flex flex-wrap gap-3">
        <Button variant="destructive" :disabled="!ready || admin.isSending.value" @click="apply(true)">Pause</Button>
        <Button variant="outline" :disabled="!ready || admin.isSending.value" @click="apply(false)">Resume</Button>
      </div>
    </CardContent>
  </Card>
</template>
