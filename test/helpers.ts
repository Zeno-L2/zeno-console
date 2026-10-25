import { vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import type { Component } from 'vue'
import { TooltipProvider } from 'nom-ui'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { GatewayClient } from 'zeno-client'
import type { SendSource } from 'zeno-client'
import { GatewayService, SettlementService, ZenonService } from '@/core'
import { call, recordedSends, replayClient, settlementBatches } from './replay-client'
import type { RecordedCall } from './replay-client'
import { fakeZenonService } from './rpc-fixture'

/** One GatewayService whose client replays the recorded gateway, with the roots Settlement holds. */
export const gatewayService = new GatewayService({ getBatch: async () => null } as never)

export function useRecordedGateway(
  extra: RecordedCall[] = [],
  roots: typeof settlementBatches = settlementBatches,
  sends: SendSource = recordedSends
) {
  const { client, requests } = replayClient(extra)
  vi.spyOn(gatewayService, 'client').mockResolvedValue(new GatewayClient(client, { batches: roots, sends }))
  vi.spyOn(GatewayService, 'getInstance').mockReturnValue(gatewayService)
  return requests
}

/** A SettlementService that answers from the recorded L1 results. */
export function useRecordedSettlement(overrides: Record<string, unknown> = {}) {
  const { service, calls } = fakeZenonService(1000, overrides)
  const settlement = new SettlementService(service)
  vi.spyOn(SettlementService, 'getInstance').mockReturnValue(settlement)
  return { settlement, calls }
}

export interface PageRoute {
  path: string
  component: Component
  children?: RouteRecordRaw[]
}

/** Matches every path, so links to pages a test does not mount resolve without router warnings. */
export const anyRoute: RouteRecordRaw = { path: '/:pathMatch(.*)*', component: { render: () => null } }

/** Mounts a routed page inside the tooltip provider the badges need. */
export async function mountAt(url: string, routes: RouteRecordRaw[], root?: Component) {
  const router = createRouter({ history: createMemoryHistory(), routes: [...routes, anyRoute] })
  await router.push(url)
  await router.isReady()
  const wrapper = mount(
    root ?? { render: () => h(TooltipProvider, null, () => h(RouterView)) },
    { global: { plugins: [router] }, attachTo: document.body }
  )
  await flushPromises()
  return { wrapper, router }
}

/** A ZenonService that answers the node checks the shell makes, without a connection. */
export function useFakeNode(height = 1000) {
  const node = {
    ensureInitialized: async () => undefined,
    getZenon: () => ({ ledger: { getFrontierMomentum: async () => ({ height }) } }),
    getNodeUrl: () => 'ws://node.example:35998',
    getChainId: () => 1,
    getNetworkId: () => 1,
    isConnected: () => true,
  }
  vi.spyOn(ZenonService, 'getInstance').mockReturnValue(node as never)
  return node
}

/**
 * A gateway whose client is a hand-made object, for list pages that are
 * asserted on the filter they send. `getHead` answers the recorded head.
 */
export function useFakeClient(methods: Record<string, unknown>) {
  const head = structuredClone(call('getHead').response.result)
  const client = { getHead: vi.fn(async () => head), ...methods }
  vi.spyOn(gatewayService, 'client').mockResolvedValue(client as never)
  vi.spyOn(GatewayService, 'getInstance').mockReturnValue(gatewayService)
  return client as Record<string, ReturnType<typeof vi.fn>>
}
