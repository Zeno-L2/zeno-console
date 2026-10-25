<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Address,
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'nom-ui'
import { TriangleAlertIcon } from '@lucide/vue'
import { DomainCard, PauseBanner, TimeChallengeTable } from '@/components'
import { useSettings, useSettlement } from '@/core'
import AdminActionForm from '@/components/AdminActionForm.vue'
import PausePanel from '@/components/PausePanel.vue'
import { TIMED_ACTIONS } from '@/core/admin-actions'
import { useAdmin } from '@/core/composables/useAdmin'
import type { TimedMethod } from '@/core/admin-actions'

const admin = useAdmin()
const settlement = useSettlement()
const { settings } = useSettings()
const selected = ref<TimedMethod>('SetPeripheryConfig')
const action = computed(() => TIMED_ACTIONS.find((a) => a.method === selected.value) ?? TIMED_ACTIONS[0])

onMounted(() => settlement.loadOverview())

/** The action a pending challenge belongs to, from the method its key begins with. */
function openChallenge(methodName: string) {
  const method = methodName.split('/')[0] as TimedMethod
  if (TIMED_ACTIONS.some((a) => a.method === method)) selected.value = method
}
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-semibold tracking-tight">Administration</h2>

    <Alert v-if="!admin.isAdmin.value" variant="destructive" data-slot="admin-denied">
      <TriangleAlertIcon />
      <div>
        <AlertTitle>This area is for the network administrator</AlertTitle>
        <AlertDescription>
          Connect the administrator's wallet, and set the administrator address in
          <RouterLink to="/settings" class="underline">settings</RouterLink>. Settlement checks the
          sender on chain, so other addresses cannot send these changes.
        </AlertDescription>
      </div>
    </Alert>

    <template v-else>
      <Alert data-slot="admin-signer">
        <TriangleAlertIcon />
        <div>
          <AlertTitle>Check the signer before you approve</AlertTitle>
          <AlertDescription>
            Approve each send only when the wallet's approval window shows the administrator address:
            <Address :address="settings.adminAddress.trim()" wrap />.
            Settlement refuses a send from any other address. The console reports it only after the wallet publishes the send.
          </AlertDescription>
        </div>
      </Alert>

      <PauseBanner :pause="settlement.pause.value" />

      <Card>
        <CardHeader><CardTitle>Pending time challenges</CardTitle></CardHeader>
        <CardContent>
          <TimeChallengeTable :challenges="settlement.challenges.value" :frontier-height="settlement.frontierHeight.value">
            <template #actions="{ challenge }">
              <Button size="xs" variant="outline" @click="openChallenge(challenge.methodName)">Open</Button>
            </template>
          </TimeChallengeTable>
        </CardContent>
      </Card>

      <div class="grid gap-6 lg:grid-cols-2">
        <DomainCard v-for="d in settlement.domains.value" :key="d.domainId" :domain="d" />
      </div>

      <PausePanel />

      <div class="space-y-3">
        <p class="text-ledger text-muted-foreground">Time-challenged changes</p>
        <Select :model-value="selected" @update:model-value="selected = $event as TimedMethod">
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="a in TIMED_ACTIONS" :key="a.method" :value="a.method">{{ a.title }}</SelectItem>
          </SelectContent>
        </Select>
        <AdminActionForm :action="action" />
      </div>

      <p v-if="admin.lastHash.value" class="text-sm" data-slot="admin-sent">
        {{ admin.error.value ? (admin.lastRefused.value ? 'Published, refused:' : 'Published, result unknown:') : 'Sent.' }}
        <RouterLink :to="`/tx/${admin.lastHash.value}`" class="font-mono text-xs break-all underline">{{ admin.lastHash.value }}</RouterLink>
      </p>
    </template>
  </div>
</template>
