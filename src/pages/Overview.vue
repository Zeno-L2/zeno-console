<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { settlement } from 'znn-typescript-sdk'
import { EmptyState, Skeleton, StatTile } from 'nom-ui'
import { DomainCard } from '@/components'
import { useDomains, useMomentumTick, useNetwork } from '@/core'

// The network-wide view. Everything about one domain lives on that domain's pages.
const network = useNetwork()
const { domains, isLoaded, error: domainsError } = useDomains()

const inputsReceived = computed(() => domains.value.reduce((sum, d) => sum + d.receivedInputCount, 0))
const paused = computed(
  () => domains.value.filter((d) => d.status === settlement.DomainStatus.PAUSED).length
)

// Keeps the L1 height tile current
useMomentumTick(() => {})
</script>

<template>
  <div class="space-y-6">
    <div>
      <p class="text-ledger text-muted-foreground">Zenon L1 · Settlement</p>
      <h2 class="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h2>
    </div>

    <p v-if="domainsError" role="alert" class="text-sm text-destructive">{{ domainsError }}</p>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-slot="stat-tiles">
      <StatTile
        label="L1 height"
        :value="network.currentMomentum.value > 0 ? network.currentMomentum.value.toLocaleString() : undefined"
      />
      <StatTile label="Domains" :value="isLoaded ? domains.length : undefined" />
      <StatTile
        label="Inputs received"
        :value="isLoaded ? inputsReceived.toLocaleString() : undefined"
        data-slot="tile-inputs"
      />
      <StatTile label="Paused domains" :value="isLoaded ? paused : undefined" data-slot="tile-paused" />
    </div>

    <section class="space-y-3">
      <h3 class="text-ledger text-muted-foreground">Domains</h3>
      <Skeleton v-if="!isLoaded && !domainsError" class="h-32 w-full" />
      <EmptyState v-else-if="domains.length === 0 && !domainsError">No domain is registered on Settlement.</EmptyState>
      <div v-else class="grid gap-4 lg:grid-cols-2" data-slot="domain-cards">
        <RouterLink v-for="d in domains" :key="d.domainId" :to="`/domains/${d.domainId}`" class="block">
          <DomainCard :domain="d" />
        </RouterLink>
      </div>
    </section>
  </div>
</template>
