<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { settlement as znn } from 'znn-typescript-sdk'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'nom-ui'
import { PauseBanner, TimeChallengeTable } from '@/components'
import { domainClassLabel, domainStatusLabel, finalityModelLabel, useNetwork, useSettlement } from '@/core'
import { useCustody, useDomains, useMomentumTick } from '@/core'
import CustodyTable from '@/components/CustodyTable.vue'
import ExecutorFees from '@/components/ExecutorFees.vue'
import PauseTable from '@/components/PauseTable.vue'

const network = useNetwork()
const settlement = useSettlement()
const { domains, isLoaded: domainsLoaded, error: domainsError } = useDomains()
const custody = useCustody()

const domainIds = computed(() => domains.value.map((d) => d.domainId))

function refresh() {
  settlement.loadOverview()
  if (domainsLoaded.value) custody.load(domainIds.value)
}

onMounted(refresh)
// The board loads once a node answers, and again when the node or the domain list changes.
watch(() => [network.isConnected.value, network.currentNode.value], ([connected]) => connected && settlement.loadOverview())
watch(domainsLoaded, (loaded) => loaded && custody.load(domainIds.value))
useMomentumTick(refresh)
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-semibold tracking-tight">Network</h2>
    <PauseBanner :pause="settlement.pause.value" />

    <p v-if="settlement.error.value" role="alert" class="text-sm text-destructive">{{ settlement.error.value }}</p>

    <Card>
      <CardHeader>
        <CardTitle>Pause</CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton v-if="!settlement.pause.value" class="h-24 w-full" />
        <PauseTable v-else :pause="settlement.pause.value" :domain-ids="domainIds" />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Domains</CardTitle>
      </CardHeader>
      <CardContent>
        <p v-if="domainsError" role="alert" class="text-sm text-destructive">{{ domainsError }}</p>
        <Skeleton v-else-if="!domainsLoaded" class="h-24 w-full" />
        <EmptyState v-else-if="domains.length === 0" title="No domains registered">
          The node reports no Settlement domains. The Settlement spork may not be active.
        </EmptyState>
        <Table v-else density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Finality</TableHead>
              <TableHead>Inputs received</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="d in domains" :key="d.domainId">
              <TableCell>
                <RouterLink
                  :to="`/domains/${d.domainId}`"
                  class="font-mono tabular-nums text-info underline-offset-4 hover:underline"
                >
                  {{ d.domainId }}
                </RouterLink>
              </TableCell>
              <TableCell>{{ domainClassLabel(d.domainClass) }}</TableCell>
              <TableCell>{{ finalityModelLabel(d.finalityModel) }}</TableCell>
              <TableCell class="font-mono tabular-nums">{{ d.receivedInputCount }}</TableCell>
              <TableCell>
                <Badge :variant="d.status === znn.DomainStatus.PAUSED ? 'warning' : 'success'">
                  {{ domainStatusLabel(d.status) }}
                </Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Pending time challenges</CardTitle>
      </CardHeader>
      <CardContent>
        <TimeChallengeTable
          :challenges="settlement.challenges.value"
          :frontier-height="settlement.frontierHeight.value"
        />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Executors and fees</CardTitle>
      </CardHeader>
      <CardContent>
        <ExecutorFees
          :executors="settlement.executors.value"
          :periphery="settlement.periphery.value"
          :fees="settlement.fees.value"
        />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Custody</CardTitle>
      </CardHeader>
      <CardContent>
        <p v-if="custody.error.value" role="alert" class="text-sm text-destructive">{{ custody.error.value }}</p>
        <CustodyTable v-else :rows="custody.rows.value" />
      </CardContent>
    </Card>
  </div>
</template>
