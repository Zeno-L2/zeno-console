import { computed, inject } from 'vue'
import type { Component } from 'vue'
import { routeLocationKey, useRoute } from 'vue-router'
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BoxesIcon,
  FileCode2Icon,
  GaugeIcon,
  GlobeIcon,
  InboxIcon,
  LayoutDashboardIcon,
  ShieldIcon,
  SquareTerminalIcon,
  UploadIcon,
  ZapIcon,
} from '@lucide/vue'
import { useDomains, useSettings } from '@/core'
import { isAdminAddress } from '@/core/admin-gate'
import { useWalletProvider } from '@/core/composables/useWalletProvider'

export type NavGroup = 'Explore' | 'Domain' | 'Build' | 'Manage'

export interface NavItem {
  to: string
  label: string
  match: RegExp[]
  icon: Component
  /** The sidebar section the item sits under. */
  group: NavGroup
  /** Shown only with a connected wallet, or only to the configured administrator. */
  requires?: 'wallet' | 'admin'
}

/**
 * The domain the Domain section points at: the one in the current route when the route names
 * one, otherwise the default domain. Outside a router it is the default domain.
 */
export function useNavDomain() {
  const route = inject(routeLocationKey, null)
  const { defaultDomainId } = useDomains()
  return computed(() => {
    const param = route?.params.domainId
    const id = typeof param === 'string' ? Number(param) : NaN
    return Number.isInteger(id) ? id : defaultDomainId.value
  })
}

/**
 * Every page the visitor may see, in sidebar order. The Domain items point at the domain from
 * useNavDomain. Detail pages light the item of the list they belong to.
 */
export function useNavItems() {
  const { settings } = useSettings()
  const wallet = useWalletProvider()
  const domainId = useNavDomain()
  return computed<NavItem[]>(() => {
    const domain = `/domains/${domainId.value}`
    const items: NavItem[] = [
      { to: '/', label: 'Dashboard', match: [/^\/$/], icon: LayoutDashboardIcon, group: 'Explore' },
      { to: '/network', label: 'Network', match: [/^\/network/], icon: GlobeIcon, group: 'Explore' },
      {
        to: domain,
        label: 'Overview',
        match: [/^\/domains\/\d+\/?$/],
        icon: GaugeIcon,
        group: 'Domain',
      },
      {
        to: `${domain}/batches`,
        label: 'Batches',
        match: [/^\/domains\/\d+\/batches/, /^\/batches\//],
        icon: BoxesIcon,
        group: 'Domain',
      },
      {
        to: `${domain}/inputs`,
        label: 'Inputs',
        match: [/^\/domains\/\d+\/inputs/, /^\/tx\//, /^\/address\//],
        icon: InboxIcon,
        group: 'Domain',
      },
      {
        to: `${domain}/events`,
        label: 'Events',
        match: [/^\/domains\/\d+\/events/],
        icon: ZapIcon,
        group: 'Domain',
      },
      {
        to: `${domain}/outbox`,
        label: 'Outbox',
        match: [/^\/domains\/\d+\/outbox/, /^\/outbox\//],
        icon: ArrowUpFromLineIcon,
        group: 'Domain',
      },
      {
        to: `${domain}/contracts`,
        label: 'Contracts',
        match: [/^\/domains\/\d+\/contracts/, /^\/contracts\//],
        icon: FileCode2Icon,
        group: 'Domain',
      },
      {
        to: '/playground',
        label: 'Playground',
        match: [/^\/playground/],
        icon: SquareTerminalIcon,
        group: 'Build',
      },
      { to: '/deploy', label: 'Deploy', match: [/^\/deploy/], icon: UploadIcon, group: 'Build' },
      {
        to: '/withdrawals',
        label: 'Withdrawals',
        match: [/^\/withdrawals/],
        requires: 'wallet',
        icon: ArrowDownToLineIcon,
        group: 'Manage',
      },
      {
        to: '/admin',
        label: 'Admin',
        match: [/^\/admin/],
        requires: 'admin',
        icon: ShieldIcon,
        group: 'Manage',
      },
    ]
    const isAdmin = isAdminAddress(wallet.address.value, settings.value.adminAddress)
    return items.filter(
      (item) =>
        !item.requires ||
        (item.requires === 'wallet' ? wallet.isConnected.value : isAdmin)
    )
  })
}

export function useNavActive() {
  const route = useRoute()
  return (item: NavItem) => item.match.some((pattern) => pattern.test(route.path))
}
