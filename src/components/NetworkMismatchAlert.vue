<script setup lang="ts">
import { computed } from 'vue'
import { Alert, AlertDescription, AlertTitle } from 'nom-ui'
import { TriangleAlertIcon } from '@lucide/vue'
import { useNetwork } from '@/core'
import { useWalletProvider } from '@/core/composables/useWalletProvider'

const wallet = useWalletProvider()
const network = useNetwork()

const show = computed(
  () => wallet.isConnected.value && (wallet.mismatch.value.chainMismatch || wallet.mismatch.value.nodeMismatch)
)
</script>

<template>
  <Alert v-if="show" variant="destructive" data-slot="network-mismatch">
    <TriangleAlertIcon />
    <div>
      <AlertTitle>The wallet is on a different network</AlertTitle>
      <AlertDescription>
        <p v-if="wallet.mismatch.value.chainMismatch">
          The wallet signs for chain id
          <span class="font-mono tabular-nums">{{ wallet.walletChainId.value }}</span>, but the
          console is set to
          <span class="font-mono tabular-nums">{{ network.chainId.value }}</span>.
        </p>
        <p v-if="wallet.mismatch.value.nodeMismatch">
          The wallet's node is <span class="font-mono break-all">{{ wallet.walletNodeUrl.value }}</span>,
          but the console reads from
          <span class="font-mono break-all">{{ network.currentNode.value }}</span>. Sends may be
          accepted by a node that does not run Settlement.
        </p>
      </AlertDescription>
    </div>
  </Alert>
</template>
