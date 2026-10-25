<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Amount,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Label,
} from 'nom-ui'
import type { ContractFeatures, ContractView } from 'zeno-client'
import { formatZnn } from '@/core'
import { TriangleAlertIcon } from '@lucide/vue'
import { DEFAULT_PLASMA_LIMIT } from '@/core/composables/useContractCall'
import { useContractManage } from '@/core/composables/useContractManage'
import { useWalletProvider } from '@/core/composables/useWalletProvider'

const props = defineProps<{
  domainId: number
  contractId: string
  view: ContractView | null
  features: ContractFeatures | null
}>()

const wallet = useWalletProvider()
const manage = useContractManage({
  domainId: toRef(props, 'domainId'),
  contractId: toRef(props, 'contractId'),
  view: toRef(props, 'view'),
  features: toRef(props, 'features'),
})

const depositToken = ref(manage.ZNN)
const depositAmount = ref('')
const depositPlasma = ref(DEFAULT_PLASMA_LIMIT)
const storageBytes = ref('')
const storageFee = ref<bigint | null>(null)
const newOwner = ref('')
const renounceConfirmed = ref(false)

const nothing = computed(() => !Object.values(manage.available.value).some(Boolean))

async function previewFee() {
  storageFee.value = /^\d+$/.test(storageBytes.value) ? await manage.storageFee(BigInt(storageBytes.value)) : null
}

function submitDeposit() {
  if (!/^\d+$/.test(depositPlasma.value)) return
  manage.deposit(depositToken.value, depositAmount.value, BigInt(depositPlasma.value))
}

function submitStorage() {
  if (!/^\d+$/.test(storageBytes.value)) return
  manage.buyStorage(BigInt(storageBytes.value))
}
</script>

<template>
  <div class="space-y-6" data-slot="manage-tab">
    <Alert v-if="!wallet.isConnected.value">
      <TriangleAlertIcon />
      <div>
        <AlertTitle>Connect a wallet</AlertTitle>
        <AlertDescription>Every action here is a send that your wallet signs.</AlertDescription>
      </div>
    </Alert>

    <EmptyState v-if="wallet.isConnected.value && nothing" title="Nothing to manage">
      This domain offers no action you can take on this contract with the connected address.
    </EmptyState>

    <Card v-if="manage.available.value.deposit" data-slot="manage-deposit">
      <CardHeader>
        <CardTitle>Deposit</CardTitle>
        <CardDescription>Send a token to the contract with no call.</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel for="m-token">Token standard</FieldLabel>
          <Input id="m-token" v-model="depositToken" class="font-mono" />
        </Field>
        <Field>
          <FieldLabel for="m-amount">Amount</FieldLabel>
          <Input id="m-amount" v-model="depositAmount" numeric />
        </Field>
        <Field>
          <FieldLabel for="m-plasma">Plasma limit</FieldLabel>
          <Input id="m-plasma" v-model="depositPlasma" numeric />
        </Field>
        <div class="sm:col-span-3">
          <Button :disabled="manage.isSending.value || !wallet.isConnected.value" @click="submitDeposit">Deposit</Button>
        </div>
      </CardContent>
    </Card>

    <Card v-if="manage.available.value.buyStorage" data-slot="manage-storage">
      <CardHeader>
        <CardTitle>Buy storage</CardTitle>
        <CardDescription>The fee is the bytes times the state price.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Field>
          <FieldLabel for="m-bytes">Bytes</FieldLabel>
          <Input id="m-bytes" v-model="storageBytes" numeric @update:model-value="previewFee" />
          <FieldDescription v-if="storageFee !== null">
            Fee <Amount :value="formatZnn(storageFee)" symbol="ZNN" />
          </FieldDescription>
        </Field>
        <Button :disabled="manage.isSending.value || !wallet.isConnected.value" @click="submitStorage">Buy storage</Button>
      </CardContent>
    </Card>

    <Card v-if="manage.available.value.ownership" data-slot="manage-ownership">
      <CardHeader>
        <CardTitle>Ownership</CardTitle>
        <CardDescription>Hand the contract to another address, or give it up for good.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <div class="space-y-3">
          <Field>
            <FieldLabel for="m-owner">New owner</FieldLabel>
            <Input id="m-owner" v-model="newOwner" class="font-mono" placeholder="z1q..." />
          </Field>
          <Button :disabled="manage.isSending.value || newOwner.trim() === ''" @click="manage.transferOwnership(newOwner)">
            Transfer ownership
          </Button>
        </div>
        <div class="space-y-3 rounded-md border border-destructive/50 p-3">
          <p class="font-medium text-destructive">Renounce ownership</p>
          <p class="text-sm text-muted-foreground">
            This transfers the contract to the zero address. Nobody can upgrade it or change its owner
            afterwards. It cannot be undone.
          </p>
          <div class="flex items-center gap-2">
            <Checkbox id="m-renounce" v-model="renounceConfirmed" />
            <Label for="m-renounce">I understand this is permanent</Label>
          </div>
          <Button variant="destructive" :disabled="!renounceConfirmed || manage.isSending.value" @click="manage.renounceOwnership()">
            Renounce ownership
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card v-if="manage.available.value.upgrade" data-slot="manage-upgrade">
      <CardHeader>
        <CardTitle>Upgrade</CardTitle>
        <CardDescription>Replace the module. The contract keeps its storage and its id.</CardDescription>
      </CardHeader>
      <CardContent>
        <RouterLink :to="`/deploy?upgrade=${contractId}&domain=${domainId}`"><Button>Upgrade this contract</Button></RouterLink>
      </CardContent>
    </Card>

    <p v-if="manage.error.value" role="alert" class="text-sm text-destructive">{{ manage.error.value }}</p>
    <p v-if="manage.lastHash.value" class="text-sm" data-slot="manage-sent">
      Sent.
      <RouterLink :to="`/tx/${manage.lastHash.value}`" class="font-mono text-xs break-all underline">
        {{ manage.lastHash.value }}
      </RouterLink>
    </p>
  </div>
</template>
