<script setup lang="ts">
import { useId } from 'vue'

withDefaults(defineProps<{ size?: number }>(), { size: 20 })

// The split Z on a 200 x 200 grid: the upper layer (L2) and the lower layer (L1)
const TOP = '24,40 176,40 176,68 130.5,96 82.5,96 128,68 24,68'
const BOTTOM = '69.5,104 117.5,104 72,132 176,132 176,160 24,160 24,132'
const gradientId = `zeno-plasma-${useId()}`
</script>

<template>
  <svg
    viewBox="24 40 152 120"
    :width="(size * 152) / 120"
    :height="size"
    class="shrink-0"
    aria-hidden="true"
    data-slot="zeno-logo"
  >
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#50f250" />
        <stop offset="1" stop-color="#00c257" />
      </linearGradient>
    </defs>
    <polygon :points="TOP" fill="var(--layer-l2)" />
    <polygon :points="BOTTOM" :fill="`url(#${gradientId})`" />
  </svg>
</template>
