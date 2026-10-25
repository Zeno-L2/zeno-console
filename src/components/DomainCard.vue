<script setup lang="ts">
import { settlement } from 'znn-typescript-sdk'
import type { SettlementDomainInfo } from 'znn-typescript-sdk'
import { Badge, Card, CardContent, CardHeader, CardTitle, DescriptionItem } from 'nom-ui'
import {
  daModeLabel,
  domainClassLabel,
  domainStatusLabel,
  finalityModelLabel,
  runtimeKindLabel,
} from '../core/labels'

defineProps<{ domain: SettlementDomainInfo }>()
</script>

<template>
  <Card data-slot="domain-card">
    <CardHeader class="flex-row items-center justify-between gap-2">
      <CardTitle>Domain <span class="font-mono tabular-nums">{{ domain.domainId }}</span></CardTitle>
      <Badge :variant="domain.status === settlement.DomainStatus.PAUSED ? 'warning' : 'success'">
        {{ domainStatusLabel(domain.status) }}
      </Badge>
    </CardHeader>
    <CardContent class="grid gap-4 sm:grid-cols-2">
      <DescriptionItem label="Class">{{ domainClassLabel(domain.domainClass) }}</DescriptionItem>
      <DescriptionItem label="Runtime">{{ runtimeKindLabel(domain.runtimeKind) }}</DescriptionItem>
      <DescriptionItem label="Finality">{{ finalityModelLabel(domain.finalityModel) }}</DescriptionItem>
      <DescriptionItem label="Min executors">
        <span class="font-mono tabular-nums">{{ domain.minExecutors }}</span>
      </DescriptionItem>
      <DescriptionItem label="Withdrawal delay">
        <span class="font-mono tabular-nums">{{ domain.withdrawalDelay }}</span> momentums
      </DescriptionItem>
      <DescriptionItem label="Runtime upgrade delay">
        <span class="font-mono tabular-nums">{{ domain.runtimeUpgradeDelay }}</span> momentums
      </DescriptionItem>
      <DescriptionItem label="DA modes">
        {{ domain.approvedDAModes.map(daModeLabel).join(', ') || 'None' }}
      </DescriptionItem>
      <DescriptionItem label="Inputs received">
        <span class="font-mono tabular-nums">{{ domain.receivedInputCount }}</span>
      </DescriptionItem>
      <DescriptionItem v-if="domain.escapeHatch" label="Escape hatch">
        <Badge variant="destructive">
          Triggered at {{ domain.escapeHatch.triggeredAtHeight }}
        </Badge>
      </DescriptionItem>
    </CardContent>
  </Card>
</template>
