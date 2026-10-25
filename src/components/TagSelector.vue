<script setup lang="ts">
import { ToggleGroup, ToggleGroupItem } from 'nom-ui'
import type { TagName } from 'zeno-client'

defineProps<{ modelValue: TagName }>()
const emit = defineEmits<{ 'update:modelValue': [tag: TagName] }>()

const TAGS: { value: TagName; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'latest', label: 'Latest' },
  { value: 'finalized', label: 'Finalized' },
]

// A toggle group reports an empty value when the active item is clicked again.
function select(value: unknown) {
  if (typeof value === 'string') emit('update:modelValue', value as TagName)
}
</script>

<template>
  <ToggleGroup
    type="single"
    variant="outline"
    :model-value="modelValue"
    aria-label="Read at"
    data-slot="tag-selector"
    @update:model-value="select"
  >
    <ToggleGroupItem v-for="t in TAGS" :key="t.value" :value="t.value" :aria-label="t.label">
      {{ t.label }}
    </ToggleGroupItem>
  </ToggleGroup>
</template>
