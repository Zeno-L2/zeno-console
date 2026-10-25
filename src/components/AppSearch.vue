<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { SearchInput } from 'nom-ui'
import { useSearch } from '@/core'

const router = useRouter()
const search = useSearch()
const query = ref('')
const error = ref<string | null>(null)
const isSearching = ref(false)

const MESSAGES = {
  none: 'No matching send hash, contract, outbox message, batch or address',
  retry: 'The gateway is busy or still starting. Try again in a moment.',
} as const

async function submit(value: string) {
  error.value = null
  isSearching.value = true
  try {
    const outcome = await search.navigate(router, value)
    if (outcome === 'found') query.value = ''
    else error.value = MESSAGES[outcome]
  } catch (err) {
    error.value = `Search failed: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    isSearching.value = false
  }
}
</script>

<template>
  <SearchInput
    v-model="query"
    placeholder="Address, hash or batch number"
    :loading="isSearching"
    :error="error"
    class="hidden w-56 md:block lg:w-72"
    data-slot="app-search"
    @update:model-value="error = null"
    @submit="submit"
  />
</template>
