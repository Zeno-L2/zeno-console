<script setup lang="ts">
import { reactive, watch } from 'vue'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  useToast,
} from 'nom-ui'
import { useSettings } from '@/core'
import { useDomains } from '@/core'
import DomainSelect from '@/components/DomainSelect.vue'

const { settings, update, reset } = useSettings()
const { domains } = useDomains()
const toast = useToast()

const form = reactive({
  gatewayUrl: settings.value.gatewayUrl,
  domainId: settings.value.domainId,
  localRunnerUrl: settings.value.localRunnerUrl,
  adminAddress: settings.value.adminAddress,
})

// The saved settings load after the page mounts, so mirror them into the form.
watch(
  settings,
  (next) => {
    form.gatewayUrl = next.gatewayUrl
    form.domainId = next.domainId
    form.localRunnerUrl = next.localRunnerUrl
    form.adminAddress = next.adminAddress
  },
  { deep: true }
)

function isUrl(value: string, schemes: string[]): boolean {
  try {
    return schemes.includes(new URL(value).protocol)
  } catch {
    return false
  }
}

async function save() {
  if (!isUrl(form.gatewayUrl, ['http:', 'https:', 'ws:', 'wss:'])) {
    toast.show('The gateway URL must start with http, https, ws or wss', 'error')
    return
  }
  if (!isUrl(form.localRunnerUrl, ['http:', 'https:'])) {
    toast.show('The local runner URL must start with http or https', 'error')
    return
  }
  if (!Number.isInteger(form.domainId) || form.domainId < 0) {
    toast.show('The domain id must be a whole number', 'error')
    return
  }
  await update({
    gatewayUrl: form.gatewayUrl.trim(),
    domainId: form.domainId,
    localRunnerUrl: form.localRunnerUrl.trim(),
    adminAddress: form.adminAddress.trim(),
  })
  toast.show('Settings saved', 'success')
}

async function restoreDefaults() {
  await reset()
  toast.show('Settings restored to the defaults', 'success')
}
</script>

<template>
  <Card class="mx-auto max-w-2xl">
    <CardHeader>
      <CardTitle>Settings</CardTitle>
      <CardDescription>
        The node URL is set from the network indicator in the header. These settings are stored in this
        browser only.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <FieldGroup>
        <Field>
          <FieldLabel for="gateway-url">Gateway URL</FieldLabel>
          <Input id="gateway-url" v-model="form.gatewayUrl" placeholder="http://127.0.0.1:35999" />
          <FieldDescription>
            Serves L2 state and receipts. The gateway must list this origin in its allowedOrigins. A
            WebSocket URL lets the send tracker follow receipts by subscription.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel for="domain-id">Default domain</FieldLabel>
          <DomainSelect v-if="domains.length > 0" v-model="form.domainId" />
          <Input v-else id="domain-id" v-model.number="form.domainId" type="number" min="0" step="1" numeric />
          <FieldDescription>The domain that navigation and search use, and where Deploy and Withdrawals start.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel for="local-runner-url">Local runner URL</FieldLabel>
          <Input id="local-runner-url" v-model="form.localRunnerUrl" placeholder="http://127.0.0.1:8547" />
          <FieldDescription>Where zeno-exec serve listens, for testing a module before deploy.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel for="admin-address">Administrator address</FieldLabel>
          <Input id="admin-address" v-model="form.adminAddress" placeholder="z1q..." class="font-mono" />
          <FieldDescription>The address allowed into the admin area.</FieldDescription>
        </Field>
      </FieldGroup>
    </CardContent>
    <CardFooter class="justify-between">
      <Button variant="outline" @click="restoreDefaults">Restore defaults</Button>
      <Button @click="save">Save</Button>
    </CardFooter>
  </Card>
</template>
