<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from 'nom-ui'
import { TriangleAlertIcon } from '@lucide/vue'
import { canExecute, delayText } from '@/core/admin-actions'
import { useAdmin } from '@/core/composables/useAdmin'
import type { AdminAction } from '@/core/admin-actions'

const props = defineProps<{ action: AdminAction }>()
const emit = defineEmits<{ sent: [hash: string] }>()

const admin = useAdmin()
const texts = reactive<Record<string, string>>({})

function reset() {
  for (const key of Object.keys(texts)) delete texts[key]
  for (const f of props.action.fields) texts[f.key] = f.default ?? ''
}
watch(() => props.action, reset, { immediate: true })

const evaluation = computed(() => admin.evaluate(props.action, { ...texts }))
const state = computed(() => evaluation.value.state)
const executable = computed(() => state.value !== null && canExecute(state.value))
const waiting = computed(() => state.value?.kind === 'pending')
const different = computed(() => state.value?.kind === 'different')

/** Loads the values last sent for the same key, since the chain keeps only their hash. */
async function loadSaved() {
  const key = evaluation.value.key
  if (!key) return
  const saved = await admin.saved(key)
  if (saved) Object.assign(texts, saved.texts)
}

/** True while this form's own send runs. `admin.isSending` is shared with the pause panel. */
const submitting = ref(false)

async function submit() {
  submitting.value = true
  try {
    await admin.send(props.action, { ...texts })
  } finally {
    submitting.value = false
  }
  if (admin.lastHash.value && !admin.error.value) emit('sent', admin.lastHash.value)
}

const label = computed(() => (executable.value ? 'Execute' : different.value ? 'Replace the pending proposal' : 'Propose'))
</script>

<template>
  <Card data-slot="admin-action">
    <CardHeader>
      <CardTitle>{{ action.title }}</CardTitle>
      <CardDescription>{{ action.description }}</CardDescription>
      <p class="text-sm text-muted-foreground">{{ delayText(action) }}</p>
    </CardHeader>
    <CardContent class="space-y-6">
      <div class="grid gap-4 sm:grid-cols-2">
        <Field v-for="f in action.fields" :key="f.key">
          <FieldLabel :for="`a-${f.key}`">{{ f.label }}</FieldLabel>
          <Input
            :id="`a-${f.key}`"
            v-model="texts[f.key]"
            :placeholder="f.placeholder"
            :class="f.type === 'hash' || f.type === 'address' || f.type === 'hex' ? 'font-mono' : undefined"
          />
          <FieldDescription v-if="f.help">{{ f.help }}</FieldDescription>
        </Field>
      </div>

      <p v-if="evaluation.problem" class="text-sm text-muted-foreground" data-slot="admin-problem">{{ evaluation.problem }}</p>

      <div v-if="state" class="space-y-3" data-slot="admin-state">
        <Badge v-if="state.kind === 'none'" variant="secondary">Nothing pending</Badge>
        <Badge v-else-if="state.kind === 'pending'" variant="pending">
          Pending, {{ state.remaining }} momentums to go
        </Badge>
        <Badge v-else-if="state.kind === 'ready'" variant="success">Ready to execute</Badge>
        <Badge v-else variant="warning">A different proposal is pending</Badge>

        <Alert v-if="state.kind === 'none'">
          <AlertTitle>The send succeeds with no visible change</AlertTitle>
          <AlertDescription>
            A first send only records the proposal's hash. The change applies when you send the same
            values again after the delay.
          </AlertDescription>
        </Alert>
        <Alert v-if="state.kind === 'different'" variant="destructive">
          <TriangleAlertIcon />
          <div>
            <AlertTitle>These values differ from the pending proposal</AlertTitle>
            <AlertDescription>
              Sending them restarts the challenge. To execute the pending proposal, enter its exact
              values. Its hash is
              <span class="font-mono text-xs break-all">{{ state.pendingHash }}</span>.
            </AlertDescription>
          </div>
        </Alert>
      </div>

      <p v-if="admin.error.value" role="alert" class="text-sm text-destructive">{{ admin.error.value }}</p>
    </CardContent>
    <CardFooter class="justify-between">
      <Button variant="outline" :disabled="!evaluation.key" @click="loadSaved">Load saved values</Button>
      <Button :disabled="evaluation.problem !== null || waiting || admin.isSending.value" @click="submit">
        {{ submitting ? 'Waiting for wallet and Settlement' : label }}
      </Button>
    </CardFooter>
  </Card>
</template>
