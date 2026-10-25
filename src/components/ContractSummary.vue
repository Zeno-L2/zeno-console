<script setup lang="ts">
import { computed } from 'vue'
import { Address, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, DescriptionItem, Progress } from 'nom-ui'
import type { ContractView, ReadResult, TagName, Verified } from 'zeno-client'

const props = defineProps<{
  view: Verified<ReadResult<ContractView>>
  /** The tag the gateway answered at. */
  answeredTag: TagName
}>()

const quotaPercent = computed(() => {
  const q = props.view.result.quota
  if (!q || q.purchased === 0) return 0
  return Math.min(100, (q.used / q.purchased) * 100)
})
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Contract</CardTitle>
      <CardDescription>
        Batch <span class="font-mono tabular-nums">{{ view.batchId }}</span>, read at
        {{ answeredTag }}.
      </CardDescription>
    </CardHeader>
    <CardContent class="grid gap-6 sm:grid-cols-2">
      <DescriptionItem label="CodeHash">
        <span class="font-mono text-xs break-all">{{ view.result.codeHash }}</span>
      </DescriptionItem>
      <DescriptionItem label="code_hash">
        <span class="font-mono text-xs break-all">{{ view.result.sourceCodeHash }}</span>
      </DescriptionItem>
      <DescriptionItem label="Upgrade policy">
        <Badge variant="secondary">{{ view.result.upgradePolicy }}</Badge>
      </DescriptionItem>
      <DescriptionItem label="Owner">
        <Address v-if="view.result.owner" :address="view.result.owner" />
        <span v-else class="text-muted-foreground">None</span>
      </DescriptionItem>
      <DescriptionItem v-if="view.result.nativeAddress" label="Native address">
        <Address :address="view.result.nativeAddress" />
      </DescriptionItem>
      <DescriptionItem v-if="view.result.quota" label="Storage quota">
        <div class="space-y-2">
          <Progress :model-value="quotaPercent" />
          <p class="font-mono text-xs tabular-nums">
            {{ view.result.quota.used }} / {{ view.result.quota.purchased }} bytes
          </p>
        </div>
      </DescriptionItem>
    </CardContent>
  </Card>
</template>
