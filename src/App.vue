<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  Button,
  MobileNav,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Toaster,
  TooltipProvider,
  useTheme,
} from 'nom-ui'
import { MoonIcon, SettingsIcon, SunIcon } from '@lucide/vue'
import { NetworkIndicator, NetworkSelector } from '@/components'
import { useGateway, useMomentumTick, useNetwork, useSettings } from '@/core'
import { useDomains } from '@/core'
import { useWalletProvider } from '@/core/composables/useWalletProvider'
import { storageService } from '@/core/storage/storage-service'
import { STORAGE_KEY_SIDEBAR_COLLAPSED } from '@/config'
import AppSearch from '@/components/AppSearch.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import NetworkMismatchAlert from '@/components/NetworkMismatchAlert.vue'
import WalletButton from '@/components/WalletButton.vue'
import ZenoLogo from '@/components/ZenoLogo.vue'
import { useNavActive, useNavItems } from '@/nav'

// useGateway's URL watch points GatewayService at the saved URL. It exists only
// once something calls useGateway(), so this comes before every other composable.
useGateway()
const { theme, toggleTheme, initTheme } = useTheme()
const network = useNetwork()
const settings = useSettings()
const domains = useDomains()
const wallet = useWalletProvider()
const isActive = useNavActive()
const navItems = useNavItems()
const collapsed = ref(false)
const panel = ref<HTMLElement | null>(null)
const route = useRoute()

// The panel is the scroll container, so a new page starts at its top
watch(
  () => route.path,
  () => panel.value?.scrollTo({ top: 0 })
)

// Keeps the momentum height in the top bar current
useMomentumTick(() => {})

onMounted(async () => {
  collapsed.value = (await storageService.get<boolean>(STORAGE_KEY_SIDEBAR_COLLAPSED)) ?? false
  await initTheme()
  await settings.load()
  network.initialize()
  domains.load()
  void wallet.restore()
})

async function toggleSidebar() {
  collapsed.value = !collapsed.value
  await storageService.set(STORAGE_KEY_SIDEBAR_COLLAPSED, collapsed.value)
}

async function handleSelectNode(nodeUrl: string) {
  if (nodeUrl === network.currentNode.value) return
  await network.changeNode(nodeUrl)
}

async function handleNetworkConfigChange(chainId: number, networkId: number) {
  if (chainId === network.chainId.value && networkId === network.networkId.value) return
  await network.updateNetworkConfig(chainId, networkId)
}
</script>

<template>
  <TooltipProvider disable-hoverable-content>
    <!-- Two layers, as in the mark: the top bar and sidebar are the base layer, the page sits
         on the raised panel. -->
    <div class="relative flex h-dvh flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      <Toaster />
      <header class="z-20 flex min-h-14 shrink-0 items-center gap-2 bg-sidebar px-3 py-2 sm:gap-5 sm:px-5">
        <MobileNav
          :items="navItems"
          :is-active="isActive"
          :link-as="RouterLink"
          class="sm:inline-flex lg:hidden"
        />
        <RouterLink
          to="/"
          class="flex shrink-0 items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sidebar-ring"
          :class="collapsed ? 'lg:-ml-5 lg:w-16 lg:justify-center' : 'lg:w-[12.75rem]'"
        >
          <ZenoLogo :size="20" />
          <span
            class="flex items-baseline gap-2"
            :class="collapsed && 'lg:hidden'"
            aria-hidden="true"
          >
            <span class="text-lg leading-none font-bold tracking-[-0.03em]">zeno</span>
            <span class="text-ledger text-muted-foreground">Console</span>
          </span>
          <h1 class="sr-only">Zeno Console</h1>
        </RouterLink>

        <div class="hidden flex-1 items-center gap-5 font-mono text-xs tabular-nums md:flex">
          <div class="flex items-center gap-2" data-slot="momentum-stat">
            <span
              class="size-[7px] shrink-0"
              :class="network.isConnected.value ? 'animate-pulse bg-success' : 'bg-destructive'"
              aria-hidden="true"
            />
            <span class="text-ledger text-muted-foreground">Momentum</span>
            <span>{{
              network.currentMomentum.value ? network.currentMomentum.value.toLocaleString('en-US') : '…'
            }}</span>
          </div>
        </div>

        <div class="ml-auto flex items-center gap-0.5 sm:gap-2">
          <AppSearch />
          <WalletButton />
          <Popover>
            <PopoverTrigger as-child>
              <button
                type="button"
                class="flex h-9 w-9 items-center justify-center rounded-md hover:bg-sidebar-accent"
                aria-label="Select node"
              >
                <NetworkIndicator
                  :connected="network.isConnected.value"
                  :node="network.currentNode.value"
                />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" class="w-[26rem] max-w-[calc(100vw-2rem)] p-4">
              <NetworkSelector
                :current-node="network.currentNode.value"
                @select="handleSelectNode"
                @update-network-config="handleNetworkConfigChange"
              />
            </PopoverContent>
          </Popover>
          <Button as-child variant="ghost" size="icon" class="text-muted-foreground hover:bg-sidebar-accent">
            <RouterLink to="/settings" aria-label="Settings">
              <SettingsIcon class="h-5 w-5" />
            </RouterLink>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="text-muted-foreground hover:bg-sidebar-accent"
            aria-label="Toggle theme"
            @click="toggleTheme"
          >
            <SunIcon v-if="theme === 'dark'" class="h-5 w-5" />
            <MoonIcon v-else class="h-5 w-5" />
          </Button>
        </div>
      </header>

      <!-- Only the panel scrolls; the top bar and sidebar stay in place. -->
      <div class="flex min-h-0 flex-1">
        <AppSidebar
          :items="navItems"
          :is-active="isActive"
          :collapsed="collapsed"
          @toggle="toggleSidebar"
        />
        <main
          ref="panel"
          class="min-w-0 flex-1 space-y-6 overflow-y-auto overscroll-contain border-t border-sidebar-border bg-background p-4 text-foreground shadow-[var(--elevation-panel)] sm:p-6 lg:rounded-tl-xl lg:border-l lg:px-8 lg:py-7"
        >
          <NetworkMismatchAlert />
          <RouterView v-if="settings.isLoaded.value" />
        </main>
      </div>
    </div>
  </TooltipProvider>
</template>
