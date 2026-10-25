<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Button,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
  useToast,
} from 'nom-ui'
import { CheckIcon, TrashIcon } from '@lucide/vue'
import { useNetwork, useStorage } from '../core'
import { DEFAULT_NODES, STORAGE_KEY_CUSTOM_NODES } from '../config'

export interface NetworkSelectorProps {
  currentNode: string
}

const props = defineProps<NetworkSelectorProps>()

const emit = defineEmits<{
  select: [nodeUrl: string]
  'update-network-config': [chainId: number, networkId: number]
}>()

const storage = useStorage()
const toast = useToast()
const network = useNetwork()

const defaultNodes = DEFAULT_NODES

const customNode = ref('')
const selectedNode = ref(props.currentNode)
const customNodes = ref<string[]>([])
const chainId = ref<number>(network.chainId.value)
const networkId = ref<number>(network.networkId.value)

interface NodeItem {
  url: string
  isCustom: boolean
}

const allNodes = computed<NodeItem[]>(() => {
  const defaults = defaultNodes.map((url) => ({ url, isCustom: false }))
  const customs = customNodes.value.map((url) => ({ url, isCustom: true }))
  return [...defaults, ...customs]
})

watch(
  () => props.currentNode,
  (newVal) => {
    selectedNode.value = newVal
  }
)
watch(
  () => network.chainId.value,
  (newVal) => {
    chainId.value = newVal
  }
)
watch(
  () => network.networkId.value,
  (newVal) => {
    networkId.value = newVal
  }
)

async function loadCustomNodes() {
  try {
    const stored = await storage.get<string[]>(STORAGE_KEY_CUSTOM_NODES)
    if (stored) {
      customNodes.value = stored
    }
  } catch (e) {
    console.error('Failed to load custom nodes:', e)
    customNodes.value = []
  }
}

async function saveCustomNodes() {
  try {
    await storage.set(STORAGE_KEY_CUSTOM_NODES, customNodes.value)
  } catch (e) {
    console.error('Failed to save custom nodes:', e)
    toast.show('Failed to save custom node', 'error')
  }
}

// Chain/Network IDs must be positive whole numbers. v-model.number leaves the
// raw string in place when the field is empty or non-numeric (looseToNumber),
// so guard before it can reach the SDK or storage.
function isValidId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

async function handleNetworkConfigChange() {
  if (!isValidId(chainId.value) || !isValidId(networkId.value)) {
    toast.show('Chain ID and Network ID must be positive whole numbers', 'error')
    return
  }
  try {
    await network.updateNetworkConfig(chainId.value, networkId.value)
    toast.show('Network configuration saved', 'success')
  } catch (e) {
    console.error('Failed to save network configuration:', e)
    toast.show('Failed to save network configuration', 'error')
    return
  }
  emit('update-network-config', chainId.value, networkId.value)
}

async function handleSelect(nodeUrl: string) {
  const previousNode = selectedNode.value
  selectedNode.value = nodeUrl
  const host = nodeUrl.replace(/^wss?:\/\//, '').split(':')[0]
  // The connection check can take up to CONNECT_TIMEOUT_MS, so show a loading
  // toast immediately and replace it in place (by id) with the outcome.
  const { toast: sonner } = toast
  const toastId = sonner.loading(`Checking ${host}…`)
  try {
    await network.changeNode(nodeUrl)
    sonner.success(`Connected to ${host}`, { id: toastId })
  } catch (err) {
    selectedNode.value = previousNode
    const message = err instanceof Error ? err.message : 'Failed to connect to node'
    sonner.error(message, { id: toastId })
    return
  }
  emit('select', nodeUrl)
}

async function handleCustomNodeSubmit() {
  if (
    customNode.value &&
    (customNode.value.startsWith('wss://') || customNode.value.startsWith('ws://'))
  ) {
    if (!customNodes.value.includes(customNode.value) && !defaultNodes.includes(customNode.value)) {
      customNodes.value.push(customNode.value)
      await saveCustomNodes()
    }
    await handleSelect(customNode.value)
    customNode.value = ''
  }
}

async function handleDeleteCustomNode(nodeUrl: string) {
  customNodes.value = customNodes.value.filter((url) => url !== nodeUrl)
  await saveCustomNodes()

  if (selectedNode.value === nodeUrl) {
    await handleSelect(defaultNodes[0])
  }
}

onMounted(async () => {
  await loadCustomNodes()
})
</script>

<template>
  <div class="w-full min-w-0 space-y-3">
    <div class="text-lg font-semibold">Node Selection</div>

    <div class="space-y-2">
      <Item
        v-for="node in allNodes"
        :key="node.url"
        :class="[
          'transition-colors',
          selectedNode === node.url ? 'border-primary/50 bg-primary/10' : '',
        ]"
        variant="hover"
        size="sm"
        @click="handleSelect(node.url)"
      >
        <ItemContent class="min-w-0 flex-1">
          <ItemTitle>{{ node.isCustom ? 'Custom Node' : `Default Node` }}</ItemTitle>
          <ItemDescription class="font-mono break-all">
            {{ node.url }}
          </ItemDescription>
        </ItemContent>
        <Button
          v-if="node.isCustom"
          type="button"
          variant="ghost"
          @click.stop="handleDeleteCustomNode(node.url)"
          class="text-muted-foreground hover:text-destructive"
        >
          <TrashIcon class="h-3.5 w-3.5" />
        </Button>
      </Item>
    </div>

    <Field class="mt-4">
      <FieldLabel for="custom-node"> Custom Node URL </FieldLabel>
      <InputGroup>
        <InputGroupInput
          v-model="customNode"
          placeholder="wss://..."
          @keyup.enter="handleCustomNodeSubmit"
          id="custom-node"
          class="bg-background"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            size="icon-xs"
            @click="handleCustomNodeSubmit"
            :disabled="!customNode"
          >
            <CheckIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>

    <div class="mt-4 text-lg font-semibold">Network Configuration</div>

    <div class="grid grid-cols-2 gap-4">
      <Field>
        <FieldLabel for="chain-id"> Chain ID </FieldLabel>
        <InputGroup>
          <InputGroupInput
            v-model.number="chainId"
            type="number"
            min="1"
            step="1"
            id="chain-id"
            placeholder="1"
            @change="handleNetworkConfigChange"
          />
        </InputGroup>
      </Field>

      <Field>
        <FieldLabel for="network-id"> Network ID </FieldLabel>
        <InputGroup>
          <InputGroupInput
            v-model.number="networkId"
            type="number"
            min="1"
            step="1"
            id="network-id"
            placeholder="1"
            @change="handleNetworkConfigChange"
          />
        </InputGroup>
      </Field>
    </div>
  </div>
</template>
