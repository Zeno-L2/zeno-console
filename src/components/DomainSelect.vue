<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from 'nom-ui'
import { useDomains } from '@/core'

const model = defineModel<number>({ required: true })
withDefaults(defineProps<{ triggerClass?: string }>(), { triggerClass: 'w-40' })
const { domains } = useDomains()
</script>

<template>
  <Select :model-value="String(model)" @update:model-value="(v) => (model = Number(v))">
    <SelectTrigger :class="triggerClass" aria-label="Domain" data-slot="domain-select">
      <!-- Named from the model, not from the matching option: the options mount and unmount as the
           domain list loads, and the trigger would then show nothing until the next pick. -->
      <SelectValue>Domain {{ model }}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="d in domains" :key="d.domainId" :value="String(d.domainId)">
        Domain {{ d.domainId }}
      </SelectItem>
      <SelectItem v-if="!domains.some((d) => d.domainId === model)" :value="String(model)">
        Domain {{ model }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
