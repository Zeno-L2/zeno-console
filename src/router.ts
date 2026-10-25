import { createRouter, createWebHistory } from 'vue-router'
import { useSettings } from '@/core'

/** The saved default domain. The first navigation runs before the app loads the settings. */
async function savedDomainId(): Promise<number> {
  const s = useSettings()
  if (!s.isLoaded.value) await s.load()
  return s.settings.value.domainId
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('@/pages/Overview.vue') },
    { path: '/network', component: () => import('@/pages/Network.vue') },
    {
      path: '/domains/:domainId(\\d+)',
      component: () => import('@/pages/DomainLayout.vue'),
      children: [
        {
          path: '',
          name: 'domain-overview',
          meta: { tab: 'Overview' },
          component: () => import('@/pages/DomainOverview.vue'),
        },
        {
          path: 'batches',
          name: 'domain-batches',
          meta: { tab: 'Batches' },
          component: () => import('@/pages/DomainBatches.vue'),
        },
        {
          path: 'inputs',
          name: 'domain-inputs',
          meta: { tab: 'Inputs' },
          component: () => import('@/pages/DomainInputs.vue'),
        },
        {
          path: 'events',
          name: 'domain-events',
          meta: { tab: 'Events' },
          component: () => import('@/pages/DomainEvents.vue'),
        },
        {
          path: 'outbox',
          name: 'domain-outbox',
          meta: { tab: 'Outbox' },
          component: () => import('@/pages/DomainOutbox.vue'),
        },
        {
          path: 'contracts',
          name: 'domain-contracts',
          meta: { tab: 'Contracts' },
          component: () => import('@/pages/DomainContracts.vue'),
        },
      ],
    },
    { path: '/batches/:domainId(\\d+)/:batchId(\\d+)', component: () => import('@/pages/BatchDetail.vue') },
    { path: '/tx/:sendHash', component: () => import('@/pages/TxDetail.vue') },
    { path: '/address/:address', component: () => import('@/pages/AddressDetail.vue') },
    { path: '/contracts/:domainId(\\d+)/:contractId', component: () => import('@/pages/ContractDetail.vue') },
    {
      path: '/contracts',
      component: { render: () => null },
      beforeEnter: async () => `/domains/${await savedDomainId()}/contracts`,
    },
    {
      path: '/contracts/:contractId([0-9a-fA-F]{64})',
      component: { render: () => null },
      beforeEnter: async (to) =>
        `/contracts/${await savedDomainId()}/${String(to.params.contractId).toLowerCase()}`,
    },
    { path: '/deploy', component: () => import('@/pages/Deploy.vue') },
    { path: '/withdrawals', component: () => import('@/pages/Withdrawals.vue') },
    { path: '/admin', component: () => import('@/pages/Admin.vue') },
    { path: '/outbox/:outboxId', component: () => import('@/pages/OutboxDetail.vue') },
    { path: '/playground', component: () => import('@/pages/Playground.vue') },
    { path: '/settings', component: () => import('@/pages/Settings.vue') },
    { path: '/:pathMatch(.*)*', component: () => import('@/pages/NotFound.vue') },
  ],
})
