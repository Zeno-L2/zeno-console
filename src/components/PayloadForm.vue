<script setup lang="ts">
import { computed } from 'vue'
import type { Param } from 'zeno-client'
import {
  Address,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from 'nom-ui'
import { isKey32, parseArgs, resolveKeyText } from '@/core'
import type { ResolvedKey } from '@/core'

const props = defineProps<{
  params: Param[]
  /** One text per parameter, in order. Use with v-model. */
  modelValue: string[]
  /** Show a field's problem only after the user typed in it or asked to validate. */
  showErrors?: boolean
  /** Prefix of the input ids, so two forms on one page keep distinct ids. */
  idPrefix?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [texts: string[]] }>()

const errors = computed(() => parseArgs(props.params, props.modelValue).errors)

const ZNN_ZTS = 'zts1znnxxxxxxxxxxxxx9z4ulx'
const QSR_ZTS = 'zts1qsrxxxxxxxxxxxxxmrhjll'

/** Per field: the 32-byte value an address or token standard resolved to, else null. */
const resolved = computed<(ResolvedKey | null)[]>(() =>
  props.params.map((param, i) => {
    if (!isKey32(param.type)) return null
    try {
      return resolveKeyText(props.modelValue[i] ?? '')
    } catch {
      return null
    }
  })
)

const hasAssetShortcuts = (param: Param) =>
  param.type.startsWith('bytes') && isKey32(param.type) && param.name.toLowerCase().includes('asset')

function set(index: number, text: string) {
  const next = [...props.modelValue]
  next[index] = text
  emit('update:modelValue', next)
}
</script>

<template>
  <FieldGroup data-slot="payload-form">
    <Field v-for="(param, i) in params" :key="param.name">
      <FieldLabel :for="`${idPrefix ?? 'arg'}-${param.name}`">
        {{ param.name }}
        <span class="text-ledger text-muted-foreground">{{ param.type }}</span>
      </FieldLabel>
      <Input
        :id="`${idPrefix ?? 'arg'}-${param.name}`"
        :model-value="modelValue[i] ?? ''"
        class="font-mono"
        :aria-invalid="showErrors && errors[i] !== null ? true : undefined"
        @update:model-value="set(i, String($event))"
      />
      <div v-if="hasAssetShortcuts(param)" class="flex gap-2" data-slot="asset-shortcuts">
        <Button type="button" variant="outline" size="sm" @click="set(i, ZNN_ZTS)">ZNN</Button>
        <Button type="button" variant="outline" size="sm" @click="set(i, QSR_ZTS)">QSR</Button>
      </div>
      <FieldError v-if="showErrors && errors[i]">{{ errors[i] }}</FieldError>
      <FieldDescription v-else-if="resolved[i]" data-slot="resolved">
        Resolved: {{ resolved[i]!.kind === 'caller' ? 'caller' : 'asset id' }} of
        <Address :address="resolved[i]!.source" :start="8" :end="6" />:
        <Address :address="resolved[i]!.hex" :start="10" :end="8" />
      </FieldDescription>
      <FieldDescription v-else-if="isKey32(param.type) && !(modelValue[i] ?? '').trim()" data-slot="key-hint">
        32 bytes as hex, a z1 address, or a zts1 token standard.
      </FieldDescription>
      <FieldDescription v-else-if="param.type.startsWith('list') || param.type.startsWith('(')">
        Enter a JSON array.
      </FieldDescription>
    </Field>
  </FieldGroup>
</template>
