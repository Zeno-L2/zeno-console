<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  Address,
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CursorPagination,
  EmptyState,
  FileDropzone,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from 'nom-ui'
import { DownloadIcon, TriangleAlertIcon } from '@lucide/vue'
import { DomainInconsistentError } from 'zeno-client'
import type { ContractInterface, TagName } from 'zeno-client'
import { ContractSummary, TagSelector, VerificationBadge } from '@/components'
import { GatewayService, useContract } from '@/core'
import { CURSOR_PAGE_SIZES, useCursorList, useLiveHead } from '@/core'
import { useWalletProvider } from '@/core/composables/useWalletProvider'
import CallTab from '@/components/CallTab.vue'
import EventTable from '@/components/EventTable.vue'
import InconsistentBanner from '@/components/InconsistentBanner.vue'
import InputTable from '@/components/InputTable.vue'
import ManageTab from '@/components/ManageTab.vue'
import ListNotices from '@/components/ListNotices.vue'
import RpcJson from '@/components/RpcJson.vue'
import StorageBrowser from '@/components/StorageBrowser.vue'

const TABS = ['overview', 'call', 'state', 'events', 'activity', 'manage'] as const
type TabName = (typeof TABS)[number]

const route = useRoute()
const router = useRouter()
const toast = useToast()
const wallet = useWalletProvider()

const domainId = computed(() => Number(route.params.domainId))
const contractId = computed(() => String(route.params.contractId ?? '').toLowerCase())
const valid = computed(() => /^[0-9a-f]{64}$/.test(contractId.value))

const head = useLiveHead(domainId, onNewBatch)
const domainStatus = computed(() => head.value?.status ?? null)
const c = useContract(contractId, { domainId, domainStatus })
// An unknown fragment opens Overview. So does #manage without a wallet, and #call or #manage once the load settled with no contract or a failed read.
const tab = computed<TabName>(() => {
  const name = route.hash.slice(1)
  if (!(TABS as readonly string[]).includes(name)) return 'overview'
  if (name === 'manage' && !wallet.isConnected.value) return 'overview'
  if ((name === 'call' || name === 'manage') && !c.exists.value && (c.view.value || c.error.value)) return 'overview'
  return name as TabName
})
const interfaceFile = ref<File | null>(null)
const storage = ref<InstanceType<typeof StorageBrowser> | null>(null)
const readInconsistent = computed(() => c.cause.value instanceof DomainInconsistentError)

function openTab(name: unknown) {
  router.replace({ path: route.path, query: route.query, hash: name === 'overview' ? '' : `#${String(name)}` })
}

// Events and Activity read at the contract's tag. Each has its own answered tag for the fallback alert.
const eventsAnswered = ref<TagName>('latest')
const activityAnswered = ref<TagName>('latest')
const sender = ref('')
const kind = ref('')
const senderFilter = computed(() => (/^z1[0-9a-z]{38}$/.test(sender.value.trim()) ? sender.value.trim() : undefined))
const inputKind = computed(() => (/^\d+$/.test(kind.value) ? Number(kind.value) : undefined))

const events = useCursorList(async (cursor, limit) => {
  const gateway = GatewayService.getInstance()
  const client = await gateway.client()
  const { value, tag: used } = await gateway.withTagFallback(c.tag.value, (t) =>
    client.getEvents({ domainId: domainId.value, contractId: contractId.value, toBatch: t, limit, cursor: cursor ?? undefined })
  )
  eventsAnswered.value = used as TagName
  return value
}, 'Failed to load the events')

const activity = useCursorList(async (cursor, limit) => {
  const gateway = GatewayService.getInstance()
  const client = await gateway.client()
  const { value, tag: used } = await gateway.withTagFallback(c.tag.value, (t) =>
    client.getInputs({
      domainId: domainId.value,
      contractId: contractId.value,
      sender: senderFilter.value,
      inputKind: inputKind.value,
      toBatch: t,
      limit,
      cursor: cursor ?? undefined,
    })
  )
  activityAnswered.value = used as TagName
  return value
}, 'Failed to load the activity')

const interfaces = computed<Record<string, ContractInterface>>(() =>
  c.iface.value ? { [contractId.value]: c.iface.value } : {}
)

/** Loads the list of the open tab. Overview and State read nothing from the lists. */
function loadList(restart = false) {
  const list = tab.value === 'events' ? events : tab.value === 'activity' ? activity : null
  if (list) return restart ? list.restart() : list.reset()
}

function onNewBatch() {
  if (!valid.value) return
  c.load()
  if (tab.value === 'state') storage.value?.refresh()
  if (tab.value === 'events') events.refresh()
  if (tab.value === 'activity') activity.refresh()
}

onMounted(() => {
  if (!valid.value) return
  c.load()
  loadList()
})

// A new contract or domain drops everything the page showed for the old one.
watch([domainId, contractId], () => {
  c.view.value = null
  c.registered.value = null
  c.features.value = null
  c.error.value = null
  c.cause.value = null
  c.failedCheck.value = false
  interfaceFile.value = null
  sender.value = ''
  kind.value = ''
  events.page.value = null
  activity.page.value = null
  if (!valid.value) return
  c.load()
  loadList(true)
})
watch(c.tag, () => {
  if (!valid.value) return
  c.load()
  loadList()
})
watch(tab, () => valid.value && loadList())
watch([senderFilter, inputKind], () => valid.value && tab.value === 'activity' && activity.reset())

const active = computed(() => (tab.value === 'activity' ? activity : events))
const isUnreached = (list: { page: { value: { batchId: number | null } | null }; items: { value: unknown[] } }) =>
  list.page.value?.batchId === null && list.items.value.length === 0

async function download() {
  try {
    await c.downloadModule()
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'The module could not be downloaded', 'error')
  }
}

async function importInterface(file: File | null) {
  interfaceFile.value = file
  if (!file) return
  try {
    await c.importInterface(file)
    toast.show('Interface saved', 'success')
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'The interface could not be read', 'error')
    interfaceFile.value = null
  }
}
</script>

<template>
  <Alert v-if="!valid" variant="destructive">
    <TriangleAlertIcon />
    <div>
      <AlertTitle>Not a contract id</AlertTitle>
      <AlertDescription>A contract id is 64 hex characters.</AlertDescription>
    </div>
  </Alert>

  <div v-else class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-2xl font-semibold tracking-tight">{{ c.registered.value?.name ?? 'Contract' }}</h2>
        <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Address :address="contractId" :start="10" :end="8" />
          <span>in</span>
          <RouterLink :to="`/domains/${domainId}`" class="text-info underline-offset-4 hover:underline">domain {{ domainId }}</RouterLink>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <VerificationBadge
          v-if="c.view.value || c.failedCheck.value"
          :verified="c.view.value?.verified ?? false"
          :check="c.view.value?.check"
          :domain-status="domainStatus"
          :failed="c.failedCheck.value"
        />
        <TagSelector v-model="c.tag.value" />
      </div>
    </div>

    <InconsistentBanner
      v-if="head?.status === 'INCONSISTENT' || readInconsistent"
      :domain-id="domainId"
      :inconsistent-at="head?.inconsistentAt ?? null"
      :detail="head?.status === 'INCONSISTENT' ? undefined : (c.error.value ?? undefined)"
    />

    <template v-if="tab === 'overview'">
      <Alert v-if="c.answeredTag.value !== c.tag.value" data-slot="tag-fallback">
        <AlertTitle>Showing the latest accepted state</AlertTitle>
        <AlertDescription>This gateway does not serve pending state.</AlertDescription>
      </Alert>

      <Alert v-if="c.failedCheck.value" variant="destructive">
        <TriangleAlertIcon />
        <div>
          <AlertTitle>A check failed</AlertTitle>
          <AlertDescription>{{ c.error.value }}</AlertDescription>
        </div>
      </Alert>
      <p v-else-if="c.error.value && !readInconsistent" role="alert" class="text-sm text-destructive" data-slot="contract-error">{{ c.error.value }}</p>
    </template>

    <Tabs :model-value="tab" @update:model-value="openTab">
      <TabsList variant="underline">
        <TabsTrigger value="overview" variant="underline">Overview</TabsTrigger>
        <TabsTrigger v-if="c.exists.value" value="call" variant="underline">Call</TabsTrigger>
        <TabsTrigger value="state" variant="underline">State</TabsTrigger>
        <TabsTrigger value="events" variant="underline">Events</TabsTrigger>
        <TabsTrigger value="activity" variant="underline">Activity</TabsTrigger>
        <TabsTrigger v-if="c.exists.value && wallet.isConnected.value" value="manage" variant="underline">Manage</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" class="space-y-6 pt-4">
        <Skeleton v-if="c.isLoading.value && !c.view.value" class="h-48 w-full" />

        <Alert v-else-if="c.view.value && !c.exists.value">
          <AlertTitle>No contract at this id</AlertTitle>
          <AlertDescription>
            Nothing is deployed with this id at the selected tag. A deploy appears once its batch is accepted.
          </AlertDescription>
        </Alert>

        <ContractSummary v-else-if="c.view.value" :view="c.view.value" :answered-tag="c.answeredTag.value" />

        <div v-if="c.exists.value" class="flex flex-wrap items-center gap-3">
          <Button variant="outline" @click="download"><DownloadIcon /> Download module</Button>
          <Button v-if="!c.registered.value" variant="outline" @click="c.register()">Save in this browser</Button>
        </div>

        <Card v-if="c.exists.value">
          <CardHeader>
            <CardTitle>Interface file</CardTitle>
            <CardDescription>
              <template v-if="c.ifaceSource.value === 'saved'">An interface is loaded for this contract.</template>
              <template v-else-if="c.ifaceSource.value === 'code'">
                Calls and events decode with the interface known for this contract's code
                <span class="font-mono text-xs">{{ c.iface.value?.code_hash.slice(0, 10) }}…</span>. Add a file to
                save one for this contract.
              </template>
              <template v-else>Add the interface file to decode calls and events and read named state.</template>
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <Alert v-if="c.registered.value?.interfaceCleared">
              <TriangleAlertIcon />
              <div>
                <AlertTitle>Import the interface file again</AlertTitle>
                <AlertDescription>
                  The saved interface used an older format and was removed. Drop the contract's interface file below.
                </AlertDescription>
              </div>
            </Alert>
            <FileDropzone
              :model-value="interfaceFile"
              accept=".json"
              :max-size="1024 * 1024"
              hint=".json"
              @update:model-value="importInterface"
            >
              Drop the interface file here, or click to choose
            </FileDropzone>
          </CardContent>
        </Card>

        <RpcJson
          v-if="c.view.value"
          :data="c.view.value.result"
          :rpc="{ method: 'zeno_read', params: [domainId, 'contract', { contractId }] }"
        />
      </TabsContent>

      <TabsContent v-if="c.exists.value" value="call" class="pt-4">
        <CallTab
          :domain-id="domainId"
          :contract-id="contractId"
          :iface="c.iface.value"
          :features="c.features.value"
          :tag="c.tag.value"
        />
      </TabsContent>

      <TabsContent value="state" class="pt-4">
        <StorageBrowser
          ref="storage"
          :domain-id="domainId"
          :contract-id="contractId"
          :iface="c.iface.value"
          :tag="c.tag.value"
          :domain-status="domainStatus"
        />
      </TabsContent>

      <TabsContent value="events" class="space-y-4 pt-4">
        <ListNotices
          :domain-id="domainId"
          :tag="c.tag.value"
          :answered-tag="eventsAnswered"
          :head="head"
          :cause="events.cause.value"
          :error="events.error.value"
        />
        <Skeleton v-if="events.isLoading.value && !events.page.value" class="h-48 w-full" />
        <EmptyState v-else-if="isUnreached(events)" data-slot="unreached">No batch has reached {{ eventsAnswered }} yet</EmptyState>
        <EventTable
          v-else-if="events.page.value"
          :items="events.items.value"
          :domain-id="domainId"
          :domain-status="domainStatus"
          :interfaces="interfaces"
        />
      </TabsContent>

      <TabsContent value="activity" class="space-y-4 pt-4">
        <div class="flex flex-wrap items-center gap-3">
          <Input v-model="sender" placeholder="Sender address" aria-label="Sender" class="w-80 font-mono" data-slot="sender-filter" />
          <Input v-model="kind" type="number" min="0" placeholder="Input kind" aria-label="Input kind" class="w-40" data-slot="kind-filter" />
        </div>
        <ListNotices
          :domain-id="domainId"
          :tag="c.tag.value"
          :answered-tag="activityAnswered"
          :head="head"
          :cause="activity.cause.value"
          :error="activity.error.value"
        />
        <Skeleton v-if="activity.isLoading.value && !activity.page.value" class="h-48 w-full" />
        <EmptyState v-else-if="isUnreached(activity)" data-slot="unreached">No batch has reached {{ activityAnswered }} yet</EmptyState>
        <InputTable v-else-if="activity.page.value" :items="activity.items.value" :domain-id="domainId" :domain-status="domainStatus" />
      </TabsContent>

      <TabsContent v-if="c.exists.value && wallet.isConnected.value" value="manage" class="pt-4">
        <ManageTab
          :domain-id="domainId"
          :contract-id="contractId"
          :view="c.view.value?.result ?? null"
          :features="c.features.value"
        />
      </TabsContent>
    </Tabs>

    <div v-if="tab === 'events' || tab === 'activity'" class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-sm text-muted-foreground" data-slot="page-number">Page {{ active.pageNumber.value }}</span>
      <CursorPagination
        :has-previous="active.hasNewer.value"
        :has-next="active.hasOlder.value"
        :page-size="active.pageSize.value"
        :page-sizes="CURSOR_PAGE_SIZES"
        :loading="active.isLoading.value"
        previous-label="Newer"
        next-label="Older"
        @previous="active.newer"
        @next="active.older"
        @update:page-size="(size) => (active.pageSize.value = size)"
      />
    </div>
  </div>
</template>
