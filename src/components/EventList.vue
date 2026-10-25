<script setup lang="ts">
import { computed } from 'vue'
import { Badge, DescriptionItem, EmptyState, HexView } from 'nom-ui'
import type { ReceiptDetails } from '../core/receipt'
import { formatValue } from '../core/receipt'
import { guessEvent } from '../core/event-guess'
import { useEventNames } from '../core/composables/useEventNames'

const props = defineProps<{ events: ReceiptDetails['events'] }>()

const { names } = useEventNames()

// An event no interface decodes still shows what can be read from it, marked as a guess.
const rows = computed(() =>
  props.events.map((e) => ({ ...e, guess: e.decoded ? null : guessEvent(e.raw, names.value) }))
)
</script>

<template>
  <EmptyState v-if="events.length === 0" data-slot="event-list">No events.</EmptyState>
  <ul v-else class="space-y-3" data-slot="event-list">
    <li v-for="e in rows" :key="`${e.raw.inputIndex}-${e.raw.eventIndex}`" class="space-y-2 rounded-md border p-3">
      <div class="flex flex-wrap items-center gap-2">
        <Badge v-if="e.decoded" variant="secondary" data-slot="event-name">{{ e.decoded.name }}</Badge>
        <template v-else>
          <Badge variant="outline" data-slot="event-name">{{ e.guess?.name ?? 'Unknown event' }}</Badge>
          <span class="text-xs text-muted-foreground" data-slot="event-undecoded">
            {{
              e.guess?.name
                ? 'Named from another interface. No interface is known for this contract’s code, so the fields are not decoded.'
                : 'No interface is known for this contract’s code.'
            }}
          </span>
        </template>
        <span class="text-ledger text-muted-foreground">
          input <span class="font-mono tabular-nums">{{ e.raw.inputIndex }}</span> event
          <span class="font-mono tabular-nums">{{ e.raw.eventIndex }}</span>
        </span>
      </div>
      <div v-if="e.decoded" class="grid gap-3 sm:grid-cols-2">
        <DescriptionItem v-for="(value, name) in e.decoded.fields" :key="name" :label="String(name)">
          <span class="font-mono tabular-nums break-all">{{ formatValue(value) }}</span>
        </DescriptionItem>
      </div>
      <template v-else-if="e.guess">
        <DescriptionItem :label="e.guess.name ? `Topic 0 · SHA3-256 of ${e.guess.name}` : 'Topic 0'">
          <span class="font-mono text-xs break-all">{{ e.raw.topics[0] ?? 'None' }}</span>
        </DescriptionItem>
        <DescriptionItem
          v-for="(topic, i) in e.guess.topics"
          :key="i"
          :label="`Topic ${i + 1} · indexed field ${i + 1}`"
          data-slot="event-topic"
        >
          <span class="font-mono text-xs break-all">{{ topic.hex }}</span>
          <span v-if="topic.number !== undefined" class="mt-1 block text-xs text-muted-foreground">
            As an integer: <span class="font-mono tabular-nums text-foreground">{{ topic.number }}</span>
          </span>
        </DescriptionItem>
        <HexView :value="e.raw.data" label="Data" />
        <p v-if="e.guess.text !== null" class="text-xs text-muted-foreground" data-slot="event-text">
          As text: <span class="font-mono whitespace-pre-wrap break-all text-foreground">{{ e.guess.text }}</span>
        </p>
      </template>
    </li>
  </ul>
</template>
