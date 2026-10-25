<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from '@lucide/vue'
import DomainSelect from '@/components/DomainSelect.vue'
import { useNavDomain } from '@/nav'
import type { NavItem } from '@/nav'

const props = defineProps<{
  items: NavItem[]
  isActive: (item: NavItem) => boolean
  collapsed: boolean
}>()

defineEmits<{ toggle: [] }>()

const route = useRoute()
const router = useRouter()
const domainId = useNavDomain()

// A domain page stays on the same page for the new domain; any other page opens its overview.
function switchDomain(id: number) {
  if (id === domainId.value) return
  const name = typeof route.name === 'string' && route.name.startsWith('domain-') ? route.name : null
  router.push(name ? { name, params: { domainId: id } } : `/domains/${id}`)
}

// Consecutive items that share a group sit under one ledger label
const groups = computed(() => {
  const out: { label: string; items: NavItem[] }[] = []
  for (const item of props.items) {
    const last = out.at(-1)
    if (last && last.label === item.group) last.items.push(item)
    else out.push({ label: item.group, items: [item] })
  }
  return out
})
</script>

<template>
  <nav
    id="app-sidebar"
    aria-label="Main"
    class="hidden shrink-0 flex-col gap-0.5 overflow-y-auto px-2.5 pt-1 pb-4 transition-[width] duration-200 lg:flex"
    :class="collapsed ? 'w-16' : 'w-56'"
    data-slot="app-sidebar"
  >
    <template v-for="(group, index) in groups" :key="group.label">
      <p
        class="text-ledger mb-1 px-2.5 text-muted-foreground"
        :class="[index > 0 ? 'mt-4' : 'mt-1', collapsed && 'sr-only']"
      >
        {{ group.label }}
      </p>
      <div v-if="group.label === 'Domain' && !collapsed" class="mb-1.5 px-1">
        <DomainSelect
          :model-value="domainId"
          trigger-class="h-8 w-full bg-sidebar"
          @update:model-value="switchDomain"
        />
      </div>
      <RouterLink
        v-for="item in group.items"
        :key="item.to"
        :to="item.to"
        class="relative flex items-center gap-3 rounded-md py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-ring"
        :class="[
          collapsed ? 'justify-center px-0' : 'px-2.5',
          isActive(item) && 'bg-sidebar-accent text-sidebar-foreground',
        ]"
        :aria-current="isActive(item) ? 'page' : undefined"
        :aria-label="collapsed ? item.label : undefined"
        :title="collapsed ? item.label : undefined"
      >
        <span
          v-if="isActive(item)"
          class="bg-plasma absolute inset-y-2 -left-2.5 w-[3px]"
          aria-hidden="true"
        />
        <component
          :is="item.icon"
          class="size-[18px] shrink-0"
          :class="isActive(item) && 'text-sidebar-primary'"
          aria-hidden="true"
        />
        <span v-if="!collapsed">{{ item.label }}</span>
      </RouterLink>
    </template>

    <button
      type="button"
      class="mt-auto flex items-center gap-3 border-t border-sidebar-border pt-3 pb-2 text-sm font-medium text-muted-foreground hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring"
      :class="collapsed ? 'justify-center' : 'px-2.5'"
      aria-controls="app-sidebar"
      :aria-expanded="!collapsed"
      :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      :title="collapsed ? 'Expand sidebar' : undefined"
      @click="$emit('toggle')"
    >
      <PanelLeftOpenIcon v-if="collapsed" class="size-[18px]" aria-hidden="true" />
      <PanelLeftCloseIcon v-else class="size-[18px]" aria-hidden="true" />
      <span v-if="!collapsed">Collapse</span>
    </button>
  </nav>
</template>
