<script setup lang="ts">
import {
  Address,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from 'nom-ui'
import { LogOutIcon, WalletIcon } from '@lucide/vue'
import { useWalletProvider } from '@/core/composables/useWalletProvider'

const wallet = useWalletProvider()
</script>

<template>
  <div class="flex items-center gap-1" data-slot="wallet-button">
    <template v-if="wallet.isConnected.value && wallet.address.value">
      <!-- Below sm the address and Disconnect sit in a popover so the header fits a phone. -->
      <Popover>
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="hidden max-sm:inline-flex"
            aria-label="Wallet"
            data-slot="wallet-menu"
          >
            <WalletIcon class="h-5 w-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="flex w-auto items-center gap-1 p-2">
          <Address :address="wallet.address.value" :start="8" :end="6" />
          <Button variant="ghost" size="icon-sm" aria-label="Disconnect wallet" @click="wallet.disconnect()">
            <LogOutIcon />
          </Button>
        </PopoverContent>
      </Popover>
      <div class="hidden items-center gap-1 sm:flex">
        <Address :address="wallet.address.value" :start="8" :end="6" />
        <Button variant="ghost" size="icon-sm" aria-label="Disconnect wallet" @click="wallet.disconnect()">
          <LogOutIcon />
        </Button>
      </div>
    </template>
    <Tooltip v-else-if="!wallet.isAvailable.value">
      <TooltipTrigger as-child>
        <span tabindex="0">
          <Button variant="outline" size="sm" disabled>
            <WalletIcon />
            No wallet
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Install the NoM web wallet and reload to connect.</TooltipContent>
    </Tooltip>
    <Button v-else size="sm" :disabled="wallet.isConnecting.value" @click="wallet.connect()">
      <WalletIcon />
      {{ wallet.isConnecting.value ? 'Waiting for wallet' : 'Connect wallet' }}
    </Button>
  </div>
</template>
