<script setup lang="ts">
import { computed, onScopeDispose, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { Alert, AlertDescription, Badge, Skeleton } from 'nom-ui'
import { useDomainHeads, useDomains } from '@/core'
import DomainSelect from '@/components/DomainSelect.vue'
import InconsistentBanner from '@/components/InconsistentBanner.vue'

const route = useRoute()
const router = useRouter()
const { domains, isLoaded, error } = useDomains()
const { heads, errors, follow } = useDomainHeads()

const domainId = computed(() => Number(route.params.domainId))
const head = computed(() => heads.value[domainId.value] ?? null)
const headError = computed(() => errors.value[domainId.value] ?? null)
const missing = computed(
  () => isLoaded.value && error.value === null && !domains.value.some((d) => d.domainId === domainId.value)
)

// The domain's heads stay current while the layout is mounted.
let stop: (() => void) | null = null
watch(
  domainId,
  (id) => {
    stop?.()
    stop = follow(id)
  },
  { immediate: true }
)
onScopeDispose(() => stop?.())

// The sidebar's Domain section switches between the domain pages; the title names the page.
const page = computed(() => route.meta.tab as string | undefined)

function switchDomain(id: number) {
  if (id === domainId.value) return
  router.push({ name: route.name ?? 'domain-overview', params: { domainId: id } })
}

const STATUS_VARIANTS = { OK: 'success', SYNCING: 'pending', INCONSISTENT: 'destructive' } as const
const servesDomain = computed(() => !headError.value?.startsWith('This gateway does not serve'))
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>

    <Alert v-else-if="missing" data-slot="no-domain">
      <AlertDescription>No domain {{ domainId }} on Settlement</AlertDescription>
    </Alert>

    <template v-else-if="isLoaded">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <h2 class="text-2xl font-semibold tracking-tight" data-slot="domain-title">
            Domain {{ domainId }}<template v-if="page">
              <span class="text-muted-foreground" aria-hidden="true"> · </span>{{ page }}</template
            >
          </h2>
          <Badge v-if="head" :variant="STATUS_VARIANTS[head.status]" data-slot="domain-status">{{ head.status }}</Badge>
        </div>
        <!-- From lg the sidebar carries the domain picker. -->
        <DomainSelect trigger-class="w-40 lg:hidden" :model-value="domainId" @update:model-value="switchDomain" />
      </div>

      <InconsistentBanner v-if="head?.status === 'INCONSISTENT'" :domain-id="domainId" :inconsistent-at="head.inconsistentAt" />

      <Alert v-if="headError" variant="destructive" data-slot="head-error">
        <AlertDescription>
          <p>{{ headError }}</p>
          <p v-if="servesDomain">
            The gateway must list this origin in its allowedOrigins.
            <RouterLink to="/settings" class="underline underline-offset-4">Open settings</RouterLink>
          </p>
        </AlertDescription>
      </Alert>

      <RouterView />
    </template>

    <Skeleton v-else class="h-24 w-full" />
  </div>
</template>
