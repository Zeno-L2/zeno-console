<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import {
  Address,
  Alert,
  AlertDescription,
  AlertTitle,
  Amount,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DescriptionItem,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  FileDropzone,
  HexView,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'nom-ui'
import { settlement } from 'znn-typescript-sdk'
import { ContractRegistryService, describeReceipt, fieldsChecked, formatZnn, useDomains, useSettlement, useTxTracker } from '@/core'
import { TriangleAlertIcon } from '@lucide/vue'
import DomainSelect from '@/components/DomainSelect.vue'
import DryRunPanel from '@/components/DryRunPanel.vue'
import { useDeploy } from '@/core/composables/useDeploy'
import { useWalletProvider } from '@/core/composables/useWalletProvider'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const deploy = useDeploy()
const wallet = useWalletProvider()
const route = useRoute()
const router = useRouter()
const { defaultDomainId } = useDomains()
const overview = useSettlement()
const tracker = useTxTracker()

// The last send's receipt carries the contract id once its batch is accepted.
watch(
  () => deploy.step.value === 5 && deploy.journal.value?.steps[deploy.journal.value.steps.length - 1]?.hash,
  (hash) => {
    if (hash) tracker.track(hash)
    else tracker.untrack()
  },
  { immediate: true }
)

const check = computed(() => tracker.state.value?.proof)
const outcome = computed(() => {
  const state = tracker.state.value
  return state?.receipt && fieldsChecked(check.value) ? describeReceipt(state.receipt) : null
})
const deployedId = computed(() => (outcome.value?.status === 'SUCCESS' ? tracker.state.value?.receipt?.receipt.contractId : null))

// A successful deploy goes into the local registry with the module hash.
watch(deployedId, async (id) => {
  const journal = deploy.journal.value
  if (!id || !journal || journal.kind !== 'deploy') return
  if (tracker.state.value?.sendHash !== journal.steps[journal.steps.length - 1]?.hash?.toLowerCase()) return
  await ContractRegistryService.getInstance().add({
    contractId: id,
    domainId: journal.domainId,
    deployer: journal.deployer,
    sourceCodeHash: journal.codeHash,
  })
})

const domainId = computed(() => {
  const value = route.query.domain
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : defaultDomainId.value
})
const isUpgrade = computed(() => deploy.mode.value === 'upgrade')

function selectDomain(id: number) {
  router.replace({ path: route.path, query: { ...route.query, domain: String(id) } })
}

// A plan belongs to the domain it was checked against. At steps 4 and 5 the journal holds the domain.
watch(domainId, () => {
  if (deploy.step.value !== 2 && deploy.step.value !== 3) return
  deploy.clearPlan()
  deploy.step.value = isUpgrade.value ? 1 : 2
})

onMounted(async () => {
  const contract = route.query.upgrade
  deploy.configureUpgrade(typeof contract === 'string' && /^[0-9a-fA-F]{64}$/.test(contract) ? contract : null)
  if (overview.frontierHeight.value === 0) overview.loadOverview()
  await Promise.all([deploy.loadPending(), deploy.loadRecords(domainId.value)])
})
watch([domainId, () => wallet.address.value], () => deploy.loadRecords(domainId.value))

const remaining = (expiresAtHeight: number) => Math.max(0, expiresAtHeight - overview.frontierHeight.value)

const canContinue = computed(
  () =>
    deploy.moduleBytes.value !== null &&
    deploy.loadError.value === null &&
    deploy.interfaceError.value === null &&
    wallet.isConnected.value
)

function toConfigure() {
  deploy.step.value = isUpgrade.value ? 3 : 2
  if (isUpgrade.value) deploy.buildPlan(domainId.value)
}

function toReview() {
  deploy.buildPlan(domainId.value)
}

const planRows = computed(() => {
  const p = deploy.plan.value
  if (!p) return null
  return {
    chunkCount: p.chunkCount,
    sendCount: p.sendCount,
    fee: formatZnn(p.fee),
    maxChunkPlasma: p.maxChunkPlasma,
    needsFusedPlasma: p.needsFusedPlasma,
    qsr: formatZnn(p.qsrPerChunkInFlight),
    chunksInFlight: p.chunksInFlight,
  }
})

const expiryMinutes = Math.round((settlement.DeploymentExpiryWindow * 10) / 60)
const phaseFailed = computed(() => deploy.phase.value === 'failed')
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <div>
      <h2 class="text-2xl font-semibold tracking-tight">
        {{ isUpgrade ? 'Upgrade contract' : 'Deploy contract' }}
      </h2>
      <p class="text-sm text-muted-foreground">
        Every send is an L1 transaction to Settlement that your wallet signs. A deploy takes a start,
        one send per chunk of the module, and a finalize that carries the bytecode fee.
      </p>
    </div>

    <Alert v-if="!wallet.isConnected.value">
      <TriangleAlertIcon />
      <div>
        <AlertTitle>Connect a wallet</AlertTitle>
        <AlertDescription>The wallet signs every send. Use the button in the header.</AlertDescription>
      </div>
    </Alert>

    <Card v-if="deploy.pending.value.length > 0 && deploy.step.value === 1">
      <CardHeader>
        <CardTitle>Unfinished deploys</CardTitle>
        <CardDescription>
          Drop the same module again to continue. The module is not stored in this browser.
          Discard drops the record in this browser only.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-2">
        <div
          v-for="j in deploy.pending.value"
          :key="j.id"
          class="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
        >
          <span class="font-mono text-xs break-all">{{ j.codeHash }}</span>
          <span class="text-xs text-muted-foreground" data-slot="journal-domain">Domain {{ j.domainId }}</span>
          <Badge variant="warning">
            {{ j.steps.filter((s) => s.status === 'published').length }} of {{ j.steps.length }} sent
          </Badge>
          <Button variant="outline" @click="deploy.discardPending(j.id)">Discard</Button>
        </div>
      </CardContent>
    </Card>

    <Card v-if="wallet.isConnected.value && deploy.records.value.length > 0 && deploy.step.value === 1" data-slot="l1-records">
      <CardHeader>
        <CardTitle>Unfinished deploys on L1</CardTitle>
        <CardDescription>
          Settlement holds these in domain <span class="font-mono tabular-nums">{{ domainId }}</span> until
          they finalize or expire.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>Module hash</TableHead>
              <TableHead>Chunks received</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="r in deploy.records.value" :key="r.codeHash.toString()">
              <TableCell><Address :address="r.codeHash.toString()" :copy="false" /></TableCell>
              <TableCell class="font-mono tabular-nums">{{ r.receivedCount }} / {{ r.chunkCount }}</TableCell>
              <TableCell>
                <Badge v-if="r.isExpired" variant="destructive">Expired</Badge>
                <Badge v-else variant="pending">{{ remaining(r.expiresAtHeight) }} momentums left</Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <!-- 1. Load -->
    <Card v-if="deploy.step.value === 1">
      <CardHeader>
        <CardTitle>1. Load the module</CardTitle>
        <CardDescription>The compiled module, and its interface file when you have one.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <FileDropzone
          :model-value="deploy.moduleFile.value"
          accept=".wasm"
          :max-size="settlement.MaxCodeSize"
          hint=".wasm, up to 256 KiB"
          :error="deploy.loadError.value ?? undefined"
          @update:model-value="deploy.loadModule($event)"
        >
          Drop a contract module here, or click to choose
        </FileDropzone>
        <div v-if="deploy.moduleHash.value">
          <DescriptionItem label="SHA3-256 of the module">
            <span class="font-mono text-xs break-all">{{ deploy.moduleHash.value }}</span>
          </DescriptionItem>
        </div>
        <FileDropzone
          v-if="!isUpgrade"
          :model-value="deploy.interfaceFile.value"
          accept=".json"
          :max-size="1024 * 1024"
          hint="Interface file, .json (optional)"
          :error="deploy.interfaceError.value ?? undefined"
          @update:model-value="deploy.loadInterface($event)"
        >
          Drop the interface file here, or click to choose
        </FileDropzone>
      </CardContent>
      <CardFooter class="justify-end">
        <Button :disabled="!canContinue" @click="toConfigure">Continue</Button>
      </CardFooter>
    </Card>

    <DryRunPanel
      v-if="deploy.step.value === 1 && !isUpgrade && deploy.moduleBytes.value && !deploy.loadError.value && !deploy.interfaceError.value"
      :module-bytes="deploy.moduleBytes.value"
      :iface="deploy.iface.value"
    />

    <!-- 2. Configure -->
    <Card v-if="deploy.step.value === 2">
      <CardHeader>
        <CardTitle>2. Configure</CardTitle>
        <CardDescription>The domain the contract is deployed to, and its upgrade policy.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <Field>
          <FieldLabel>Domain</FieldLabel>
          <DomainSelect :model-value="domainId" @update:model-value="selectDomain" />
        </Field>
        <Field>
          <FieldLabel>Upgrade policy</FieldLabel>
          <RadioGroup v-model="deploy.policy.value">
            <div class="flex items-center gap-2">
              <RadioGroupItem id="policy-immutable" value="IMMUTABLE" />
              <Label for="policy-immutable">Immutable</Label>
            </div>
            <div class="flex items-center gap-2">
              <RadioGroupItem id="policy-owner" value="OWNER_UPGRADEABLE" />
              <Label for="policy-owner">Owner upgradeable</Label>
            </div>
          </RadioGroup>
        </Field>
        <Field v-if="deploy.policy.value === 'OWNER_UPGRADEABLE'">
          <FieldLabel for="owner">Owner</FieldLabel>
          <Input id="owner" v-model="deploy.owner.value" :placeholder="wallet.address.value ?? 'z1q...'" class="font-mono" />
          <FieldDescription>Defaults to the connected address.</FieldDescription>
        </Field>
      </CardContent>
      <CardFooter class="justify-between">
        <Button variant="outline" @click="deploy.step.value = 1">Back</Button>
        <Button :disabled="deploy.isBuilding.value" @click="toReview">Review</Button>
      </CardFooter>
    </Card>

    <!-- 3. Review -->
    <Card v-if="deploy.step.value === 3">
      <CardHeader>
        <CardTitle>3. Review</CardTitle>
        <CardDescription>Check the sends and the fee before the wallet asks you to approve them.</CardDescription>
      </CardHeader>
      <CardContent v-if="planRows" class="space-y-6">
        <Alert v-for="p in deploy.problems.value" :key="p.kind" variant="destructive">
          <TriangleAlertIcon />
          <div>
            <AlertTitle>Cannot deploy yet</AlertTitle>
            <AlertDescription>{{ p.message }}</AlertDescription>
          </div>
        </Alert>
        <Alert v-if="isUpgrade">
          <TriangleAlertIcon />
          <div>
            <AlertTitle>The protocol does not check state layout</AlertTitle>
            <AlertDescription>
              An upgrade keeps the contract's storage as it is. Make sure the new module reads it the
              way the old one wrote it. Upgrading to the module the contract already runs is rejected
              and the fee is kept.
            </AlertDescription>
          </div>
        </Alert>
        <div class="grid gap-6 sm:grid-cols-2">
          <DescriptionItem label="Domain">
            <span class="font-mono tabular-nums" data-slot="planned-domain">{{ deploy.plannedDomainId.value }}</span>
          </DescriptionItem>
          <DescriptionItem label="Chunks">
            <span class="font-mono tabular-nums">{{ planRows.chunkCount }}</span>
          </DescriptionItem>
          <DescriptionItem label="Sends">
            <span class="font-mono tabular-nums">{{ planRows.sendCount }}</span>
          </DescriptionItem>
          <DescriptionItem label="Bytecode fee">
            <Amount :value="planRows.fee" symbol="ZNN" />
          </DescriptionItem>
          <DescriptionItem label="Available plasma">
            <span class="font-mono tabular-nums">{{ deploy.availablePlasma.value }}</span>
          </DescriptionItem>
          <DescriptionItem label="Plasma of the largest chunk">
            <span class="font-mono tabular-nums">{{ planRows.maxChunkPlasma }}</span>
          </DescriptionItem>
          <DescriptionItem label="Expires if unfinished">
            about {{ expiryMinutes }} minutes ({{ settlement.DeploymentExpiryWindow }} momentums)
          </DescriptionItem>
        </div>
        <Alert v-if="planRows.needsFusedPlasma">
          <TriangleAlertIcon />
          <div>
            <AlertTitle>Fuse QSR for plasma first</AlertTitle>
            <AlertDescription>
              A chunk send needs more plasma than proof of work can supply. Fuse about
              <Amount :value="planRows.qsr" symbol="QSR" /> for each chunk in flight. Your plasma
              covers {{ planRows.chunksInFlight }} at once.
            </AlertDescription>
          </div>
        </Alert>
      </CardContent>
      <CardContent v-else>
        <EmptyState>Building the plan.</EmptyState>
      </CardContent>
      <CardFooter class="justify-between">
        <Button variant="outline" @click="deploy.step.value = isUpgrade ? 1 : 2">Back</Button>
        <Button :disabled="!planRows || deploy.blocked.value" @click="deploy.send()">
          Send {{ planRows?.sendCount }} transactions
        </Button>
      </CardFooter>
    </Card>

    <!-- 4. Send -->
    <Card v-if="deploy.step.value >= 4">
      <CardHeader>
        <CardTitle>4. Send</CardTitle>
        <CardDescription>
          Approve each request in your wallet. The wallet asks once per send.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <DescriptionItem v-if="deploy.journal.value" label="Domain">
          <span class="font-mono tabular-nums" data-slot="journal-domain-send">{{ deploy.journal.value.domainId }}</span>
        </DescriptionItem>
        <Stepper :steps="deploy.stepItems.value" />
        <p v-if="deploy.error.value" role="alert" class="text-sm text-destructive">{{ deploy.error.value }}</p>
      </CardContent>
      <CardFooter v-if="phaseFailed" class="justify-between">
        <Button variant="outline" @click="deploy.discard()">Discard</Button>
        <Button @click="deploy.retry()">Retry from the failed send</Button>
      </CardFooter>
    </Card>

    <!-- 5. Result -->
    <Card v-if="deploy.step.value === 5">
      <CardHeader>
        <CardTitle>5. Submitted</CardTitle>
        <CardDescription>
          Settlement accepted the finalize on L1. The contract id appears in the finalize's receipt,
          which the gateway serves once the batch is accepted.
        </CardDescription>
      </CardHeader>
      <CardContent v-if="deploy.journal.value" class="space-y-4">
        <DescriptionItem label="Domain">
          <span class="font-mono tabular-nums" data-slot="journal-domain-result">{{ deploy.journal.value.domainId }}</span>
        </DescriptionItem>
        <DescriptionItem label="Module hash">
          <HexView :value="deploy.journal.value.codeHash" label="code_hash" />
        </DescriptionItem>
        <Alert v-if="deployedId" data-slot="deploy-success">
          <AlertTitle>{{ isUpgrade ? 'Contract upgraded' : 'Contract deployed' }}</AlertTitle>
          <AlertDescription>
            <RouterLink :to="`/contracts/${deploy.journal.value.domainId}/${deployedId}`" class="font-mono text-xs break-all underline">
              {{ deployedId }}
            </RouterLink>
          </AlertDescription>
        </Alert>
        <Alert v-else-if="outcome && outcome.status !== 'SUCCESS'" variant="destructive" data-slot="deploy-failed">
          <AlertTitle>The deploy failed on L2: {{ outcome.status }}</AlertTitle>
          <AlertDescription>
            The fee was kept. The contract id and code hash in the receipt are zero.
          </AlertDescription>
        </Alert>
        <Alert v-else-if="check?.state === 'failed'" variant="destructive" data-slot="deploy-check">
          <TriangleAlertIcon />
          <div>
            <AlertTitle>The finalize receipt failed a check</AlertTitle>
            <AlertDescription>
              {{ check.reason }}
              <RouterLink :to="`/tx/${tracker.state.value?.sendHash}`" class="underline">Follow the send</RouterLink>
            </AlertDescription>
          </div>
        </Alert>
        <p v-else class="text-sm text-muted-foreground" data-slot="deploy-waiting">
          {{ check?.state === 'waiting' ? check.reason : 'Waiting for the batch that holds the finalize.' }}
          <RouterLink v-if="deploy.journal.value.steps[deploy.journal.value.steps.length - 1].hash" :to="`/tx/${deploy.journal.value.steps[deploy.journal.value.steps.length - 1].hash}`" class="underline">
            Follow the send
          </RouterLink>
        </p>
        <Alert v-if="check?.state === 'failed' && check.latestChecked" variant="destructive" data-slot="deploy-finality">
          <TriangleAlertIcon />
          <div>
            <AlertTitle>The finalize receipt failed its finality check</AlertTitle>
            <AlertDescription>
              {{ check.reason }}
              <RouterLink :to="`/tx/${tracker.state.value?.sendHash}`" class="underline">Follow the send</RouterLink>
            </AlertDescription>
          </div>
        </Alert>
      </CardContent>
      <CardFooter class="justify-end">
        <Button variant="outline" @click="deploy.reset()">Deploy another</Button>
      </CardFooter>
    </Card>
  </div>
</template>
