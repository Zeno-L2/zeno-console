<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { JsonView } from 'nom-ui'
import { TerminalIcon } from '@lucide/vue'

const props = defineProps<{
  data: unknown
  /** The request behind the data. Adds an "Open in playground" link. */
  rpc?: { method: string; params: unknown[] }
}>()

const playground = computed(() =>
  props.rpc
    ? { path: '/playground', query: { method: props.rpc.method, params: JSON.stringify(props.rpc.params) } }
    : null
)
</script>

<template>
  <JsonView :value="data" data-slot="rpc-json">
    <template v-if="playground" #actions>
      <RouterLink :to="playground" class="inline-flex items-center gap-1 text-xs text-info underline-offset-4 hover:underline">
        <TerminalIcon class="h-3.5 w-3.5" />
        Open in playground
      </RouterLink>
    </template>
  </JsonView>
</template>
