<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  JsonView,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from 'nom-ui'
import { SendIcon } from '@lucide/vue'
import { PLAYGROUND_METHODS, PlaygroundService } from '@/core'

const CUSTOM = 'custom'

const playground = PlaygroundService.getInstance()
const route = useRoute()

const selected = ref(CUSTOM)
const request = ref('')
const result = ref<{ value: unknown } | null>(null)
const rpcError = ref<{ code: number; message: string } | null>(null)
const error = ref<string | null>(null)
const elapsedMs = ref<number | null>(null)
const isLoading = ref(false)

function body(method: string, params: unknown[]) {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }, null, 2)
}

function clearResult() {
  result.value = null
  rpcError.value = null
  error.value = null
  elapsedMs.value = null
}

function handleSelect(value: string) {
  selected.value = value
  clearResult()
  const entry = PLAYGROUND_METHODS.find((m) => m.method === value)
  request.value = entry ? body(entry.method, entry.params) : ''
}

// Pages link here with `?method=&params=` to preload the call behind their data.
onMounted(() => {
  const method = route.query.method
  if (typeof method !== 'string' || method === '') return
  let params: unknown[] = []
  try {
    const parsed = JSON.parse(typeof route.query.params === 'string' ? route.query.params : '[]')
    if (Array.isArray(parsed)) params = parsed
  } catch {
    // An unreadable params value falls back to no params.
  }
  selected.value = PLAYGROUND_METHODS.some((m) => m.method === method) ? method : CUSTOM
  request.value = body(method, params)
})

// A WebSocket gateway connection does not outlive the page.
onUnmounted(() => playground.close())

function parseRequest(): { method: string; params: unknown[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(request.value)
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  const { method, params = [] } = (parsed ?? {}) as { method?: unknown; params?: unknown }
  if (typeof method !== 'string' || method === '') throw new Error('Request needs a "method" string')
  if (!Array.isArray(params)) throw new Error('"params" must be an array')
  return { method, params }
}

async function send() {
  clearResult()
  isLoading.value = true
  try {
    const { method, params } = parseRequest()
    const response = await playground.send(method, params)
    elapsedMs.value = response.elapsedMs
    if (response.error) rpcError.value = response.error
    else result.value = { value: response.result ?? null }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <h2 class="text-2xl font-semibold tracking-tight">Playground</h2>

    <Card>
      <CardHeader>
        <CardTitle>Raw gateway request</CardTitle>
        <CardDescription>
          Sends one zeno_* JSON-RPC request to the gateway in the settings. Results are not checked against
          Settlement.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <div class="text-ledger text-muted-foreground">Method</div>
          <Select :model-value="selected" @update:model-value="(v) => handleSelect(v as string)">
            <SelectTrigger class="w-full sm:w-96" aria-label="Method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="CUSTOM">Custom request</SelectItem>
              <SelectItem v-for="m in PLAYGROUND_METHODS" :key="m.method" :value="m.method">
                {{ m.method }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-2">
          <div class="text-ledger text-muted-foreground">Request</div>
          <Textarea
            v-model="request"
            rows="10"
            spellcheck="false"
            placeholder='{ "jsonrpc": "2.0", "id": 1, "method": "zeno_getHead", "params": [1] }'
            class="font-mono text-xs"
            aria-label="Request"
          />
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <Button :disabled="isLoading || request.trim() === ''" @click="send">
            <SendIcon />
            Send
          </Button>
          <span v-if="elapsedMs !== null" class="font-mono text-xs tabular-nums text-muted-foreground" data-slot="elapsed">
            {{ elapsedMs }} ms
          </span>
        </div>

        <p v-if="error" role="alert" class="text-sm text-destructive" data-slot="playground-error">{{ error }}</p>
        <p v-if="rpcError" role="alert" class="text-sm text-destructive" data-slot="rpc-error">
          Error <span class="font-mono">{{ rpcError.code }}</span>: {{ rpcError.message }}
        </p>

        <div v-if="result" class="space-y-2" data-slot="playground-result">
          <Badge variant="secondary" data-slot="unverified">Unverified</Badge>
          <JsonView :value="result.value" label="Result" />
        </div>
      </CardContent>
    </Card>
  </div>
</template>
