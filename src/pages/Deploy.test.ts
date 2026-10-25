import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { TooltipProvider } from 'nom-ui'
import { createMemoryHistory, createRouter } from 'vue-router'
import { AccountService, ContractRegistryService, SettlementService, ZenonService } from '@/core'
import { connectWallet, disconnectWallet } from '@/core/composables/call-test-helpers'
import { useNetwork } from '@/core/composables/useNetwork'
import { setTrackerFactory } from '@/core/composables/useTxTracker'
import { setDeployService, useDeploy } from '@/core/composables/useDeploy'
import type { TxTrackerService } from '@/core/tx-tracker-service'
import type { DeployService } from '@/core/deploy-service'
import { anyRoute, useFakeNode } from '../../test/helpers'
import Deploy from './Deploy.vue'

const fixture = (name: string) => readFileSync(join(__dirname, '../../test/fixtures', name))
const toFile = (bytes: Uint8Array, name: string) => new File([bytes as BlobPart], name)
const WASM = toFile(Uint8Array.from(fixture('vault.wasm')), 'vault.wasm')
const INTERFACE = toFile(Uint8Array.from(fixture('vault.interface.json')), 'vault.interface.json')
const CONTRACT = 'ab'.repeat(32)

let router: ReturnType<typeof createRouter>

async function render(path: string) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/deploy', component: Deploy }, anyRoute],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(
    { render: () => h(TooltipProvider, null, () => h(Deploy)) },
    { global: { plugins: [router] } }
  )
  await flushPromises()
  return wrapper
}

/** Stands in for the node-backed services the page reads, so no test opens a node connection. */
function stubNodeServices() {
  useFakeNode()
  vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
    getPeripheryConfig: async () => ({ znnPerByteOfBytecode: 100n }),
    getDeployRecords: async () => ({ list: [] }),
    getDomains: async () => ({ list: [], count: 0 }),
    getPauseState: async () => null,
    getExecutorSet: async () => ({ list: [] }),
    getFeeInfo: async () => null,
    getTimeChallenges: async () => ({ list: [] }),
    getFrontierHeight: async () => 100,
  } as unknown as SettlementService)
  vi.spyOn(AccountService, 'getInstance').mockReturnValue({
    getPlasma: async () => ({ currentPlasma: 500_000 }),
  } as unknown as AccountService)
}

const PANEL = '[data-slot="dry-run"]'

describe('Deploy page test panel', () => {
  beforeEach(() => {
    stubNodeServices()
    setDeployService({ journals: async () => [] } as unknown as DeployService)
    useDeploy().reset()
    useDeploy().configureUpgrade(null)
  })
  afterEach(() => {
    setDeployService(null)
    vi.restoreAllMocks()
  })

  it('shows no panel before a module is loaded and shows it once the module loads', async () => {
    const w = await render('/deploy')
    expect(w.find(PANEL).exists()).toBe(false)
    await useDeploy().loadModule(WASM)
    await flushPromises()
    expect(w.find(PANEL).exists()).toBe(true)
  })

  it('keeps the panel when the interface file loads and hides it when the interface file is invalid', async () => {
    const w = await render('/deploy')
    await useDeploy().loadModule(WASM)
    await useDeploy().loadInterface(INTERFACE)
    await flushPromises()
    expect(w.find(PANEL).exists()).toBe(true)
    await useDeploy().loadInterface(toFile(new TextEncoder().encode('{"interface_version":1}'), 'bad.json'))
    await flushPromises()
    expect(useDeploy().interfaceError.value).not.toBeNull()
    expect(w.find(PANEL).exists()).toBe(false)
  })

  it('shows no panel in upgrade mode', async () => {
    const w = await render(`/deploy?upgrade=${CONTRACT}`)
    await useDeploy().loadModule(WASM)
    await flushPromises()
    expect(useDeploy().mode.value).toBe('upgrade')
    expect(w.find(PANEL).exists()).toBe(false)
  })
})

const TX = 'ee'.repeat(32)
const DEPLOYED = 'cd'.repeat(32)

const button = (w: Awaited<ReturnType<typeof render>>, text: string) =>
  w.findAll('button').find((b) => b.text().includes(text))

describe('Deploy page domain', () => {
  const preflight: number[] = []
  const begun: number[] = []
  const add = vi.fn(async () => undefined)
  let proof: unknown
  const follow = vi.fn()
  let sendHash = TX
  let codeHash = 'aa'.repeat(32)
  let holdResume = false

  beforeEach(async () => {
    follow.mockClear()
    sendHash = TX
    codeHash = 'aa'.repeat(32)
    holdResume = false
    preflight.length = 0
    begun.length = 0
    add.mockClear()
    proof = { state: 'verified' }
    stubNodeServices()
    vi.spyOn(ContractRegistryService, 'getInstance').mockReturnValue({
      add,
    } as unknown as ContractRegistryService)
    setTrackerFactory(
      () =>
        ({
          follow: (_hash: string, onUpdate: (state: unknown) => void) => {
            follow()
            onUpdate({
              sendHash,
              stage: 'finalized',
              proof,
              receipt: {
                receipt: { status: 'SUCCESS', contractId: DEPLOYED, gasUsed: 1, abortCode: 0 },
                events: [],
                outbox: [],
                returnData: '',
              },
            })
            return () => undefined
          },
        }) as unknown as TxTrackerService
    )
    setDeployService({
      journals: async () => [],
      preflight: async (input: { domainId: number }) => {
        preflight.push(input.domainId)
        return []
      },
      journal: async () => null,
      begin: async (input: { domainId: number; deployer: string }) => {
        begun.push(input.domainId)
        return {
          id: 'j',
          kind: 'deploy',
          domainId: input.domainId,
          deployer: input.deployer,
          codeHash,
          chunkCount: 1,
          steps: [{ id: 's', kind: 'finalize', status: 'published', hash: TX }],
        }
      },
      resume: async () => (holdResume ? new Promise<never>(() => undefined) : 'submitted'),
    } as unknown as DeployService)
    useDeploy().reset()
    useDeploy().configureUpgrade(null)
    await connectWallet()
  })
  afterEach(async () => {
    setDeployService(null)
    setTrackerFactory(null)
    await disconnectWallet()
    vi.restoreAllMocks()
  })

  async function toReview(w: Awaited<ReturnType<typeof render>>) {
    await useDeploy().loadModule(WASM)
    await flushPromises()
    await button(w, 'Continue')!.trigger('click')
    await flushPromises()
    await button(w, 'Review')!.trigger('click')
    await vi.waitFor(() => expect(useDeploy().step.value).toBe(3))
    await flushPromises()
  }

  it('reviews, sends and links to the domain of ?domain=, not the settings domain', async () => {
    const w = await render('/deploy?domain=2')
    await toReview(w)
    expect(preflight).toEqual([2])
    expect(w.find('[data-slot="planned-domain"]').text()).toBe('2')
    await button(w, 'Send')!.trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="deploy-success"]').exists()).toBe(true))
    expect(begun).toEqual([2])
    expect(w.find('[data-slot="deploy-success"] a').attributes('href')).toBe(`/contracts/2/${DEPLOYED}`)
    expect(w.find('[data-slot="journal-domain-result"]').text()).toBe('2')
    w.unmount()
  })

  it.each([
    ['failed', { state: 'failed', reason: 'x' }],
    ['waiting', { state: 'waiting', reason: 'x', bindingsChecked: true }],
  ])('shows no outcome and records no contract for a %s receipt check', async (state, value) => {
    proof = value
    const w = await render('/deploy?domain=2')
    await toReview(w)
    await button(w, 'Send')!.trigger('click')
    await vi.waitFor(() => expect(useDeploy().step.value).toBe(5))
    await flushPromises()
    expect(w.find('[data-slot="deploy-success"]').exists()).toBe(false)
    expect(add).not.toHaveBeenCalled()
    if (state === 'failed') {
      expect(w.find('[data-slot="deploy-check"]').text()).toContain('x')
      expect(w.find('[data-slot="deploy-check"] a').attributes('href')).toBe(`/tx/${TX}`)
      expect(w.find('[data-slot="deploy-waiting"]').exists()).toBe(false)
    } else {
      expect(w.find('[data-slot="deploy-waiting"]').text()).toContain('x')
      expect(w.find('[data-slot="deploy-check"]').exists()).toBe(false)
    }
    w.unmount()
  })

  it.each([
    ['waiting', { state: 'waiting', reason: 'x', bindingsChecked: true, latestChecked: true }, false],
    ['failed', { state: 'failed', reason: 'x', latestChecked: true }, true],
  ])('shows the outcome of a %s finalize receipt whose latest copy passed', async (_state, value, finality) => {
    proof = value
    const w = await render('/deploy?domain=2')
    await toReview(w)
    await button(w, 'Send')!.trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="deploy-success"]').exists()).toBe(true))
    expect(add).toHaveBeenCalledTimes(1)
    expect(w.find('[data-slot="deploy-check"]').exists()).toBe(false)
    const alert = w.find('[data-slot="deploy-finality"]')
    expect(alert.exists()).toBe(finality)
    if (finality) {
      expect(alert.text()).toContain('x')
      expect(alert.text()).toContain('failed its finality check')
    }
    w.unmount()
  })

  it('stops following the finalize after the deploy resets, so a node switch records nothing', async () => {
    const w = await render('/deploy?domain=2')
    await toReview(w)
    await button(w, 'Send')!.trigger('click')
    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(follow).toHaveBeenCalledTimes(1)
    useDeploy().reset()
    codeHash = 'bb'.repeat(32)
    holdResume = true
    await toReview(w)
    await button(w, 'Send')!.trigger('click')
    await vi.waitFor(() => expect(useDeploy().step.value).toBe(4))
    const { isChecking } = useNetwork()
    isChecking.value = true
    await flushPromises()
    vi.spyOn(ZenonService.getInstance(), 'getNodeUrl').mockReturnValue('ws://other')
    isChecking.value = false
    await flushPromises()
    expect(follow).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).not.toHaveBeenCalledWith(expect.objectContaining({ sourceCodeHash: codeHash }))
    w.unmount()
  })

  it('records no contract when the receipt state belongs to a send other than the journal finalize', async () => {
    sendHash = 'ff'.repeat(32)
    const w = await render('/deploy?domain=2')
    await toReview(w)
    await button(w, 'Send')!.trigger('click')
    await vi.waitFor(() => expect(w.find('[data-slot="deploy-success"]').exists()).toBe(true))
    await flushPromises()
    expect(add).not.toHaveBeenCalled()
    w.unmount()
  })

  it('shows the fixed sentence while no receipt check has run', async () => {
    proof = { state: 'bound' }
    const w = await render('/deploy?domain=2')
    await toReview(w)
    await button(w, 'Send')!.trigger('click')
    await vi.waitFor(() => expect(useDeploy().step.value).toBe(5))
    await flushPromises()
    expect(w.find('[data-slot="deploy-waiting"]').text()).toContain('Waiting for the batch that holds the finalize.')
    w.unmount()
  })

  it('falls back to the default domain without ?domain=', async () => {
    const w = await render('/deploy')
    await toReview(w)
    expect(preflight).toEqual([1])
    expect(w.find('[data-slot="planned-domain"]').text()).toBe('1')
    w.unmount()
  })

  it('returns to step 2 with no plan when the page domain changes at the review', async () => {
    const w = await render('/deploy?domain=2')
    await toReview(w)
    await router.push('/deploy')
    await flushPromises()
    expect(useDeploy().step.value).toBe(2)
    expect(useDeploy().plan.value).toBeNull()
    expect(useDeploy().plannedDomainId.value).toBeNull()
    w.unmount()
  })

  it('keeps the sent domain when the page domain changes after the send', async () => {
    const w = await render('/deploy?domain=2')
    await toReview(w)
    await button(w, 'Send')!.trigger('click')
    await vi.waitFor(() => expect(useDeploy().step.value).toBe(5))
    await router.push('/deploy?domain=3')
    await flushPromises()
    expect(useDeploy().step.value).toBe(5)
    expect(w.find('[data-slot="journal-domain-result"]').text()).toBe('2')
    expect(w.find('[data-slot="deploy-success"] a').attributes('href')).toBe(`/contracts/2/${DEPLOYED}`)
    w.unmount()
  })

  it.each(['abc', '-2', '1.5', ''])('falls back to the default domain for ?domain=%s', async (value) => {
    const w = await render(`/deploy?domain=${value}`)
    await toReview(w)
    expect(preflight).toEqual([1])
    w.unmount()
  })

  it('keeps the Configure step and reviews the new domain when the domain changes at step 2', async () => {
    const w = await render('/deploy?domain=2')
    await useDeploy().loadModule(WASM)
    await flushPromises()
    await button(w, 'Continue')!.trigger('click')
    await flushPromises()
    expect(useDeploy().step.value).toBe(2)
    await router.push('/deploy?domain=3')
    await flushPromises()
    expect(useDeploy().step.value).toBe(2)
    expect(useDeploy().plan.value).toBeNull()
    await button(w, 'Review')!.trigger('click')
    await vi.waitFor(() => expect(useDeploy().step.value).toBe(3))
    expect(preflight).toEqual([3])
    expect(w.find('[data-slot="planned-domain"]').text()).toBe('3')
    w.unmount()
  })

  it('writes the chosen domain to the query from the Configure select', async () => {
    const w = await render('/deploy')
    await useDeploy().loadModule(WASM)
    await flushPromises()
    await button(w, 'Continue')!.trigger('click')
    await flushPromises()
    w.findComponent({ name: 'DomainSelect' }).vm.$emit('update:modelValue', 5)
    await flushPromises()
    expect(router.currentRoute.value.query.domain).toBe('5')
    await button(w, 'Review')!.trigger('click')
    await vi.waitFor(() => expect(useDeploy().step.value).toBe(3))
    expect(preflight).toEqual([5])
    w.unmount()
  })

  it('discards the plan of an upgrade and returns to the first step when the domain changes', async () => {
    const w = await render(`/deploy?upgrade=${CONTRACT}&domain=2`)
    await useDeploy().loadModule(WASM)
    await flushPromises()
    await button(w, 'Continue')!.trigger('click')
    await vi.waitFor(() => expect(useDeploy().step.value).toBe(3))
    expect(preflight).toEqual([2])
    await router.push(`/deploy?upgrade=${CONTRACT}&domain=3`)
    await flushPromises()
    expect(useDeploy().step.value).toBe(1)
    expect(useDeploy().plan.value).toBeNull()
    w.unmount()
  })

  it('sends a retry to the reviewed domain after the page domain changed during a failed send', async () => {
    const w = await render('/deploy?domain=2')
    setDeployService({
      journals: async () => [],
      preflight: async () => [],
      journal: async () => null,
      begin: async (input: { domainId: number }) => {
        begun.push(input.domainId)
        return { id: 'j', kind: 'deploy', domainId: input.domainId, steps: [] }
      },
      resume: async () => 'failed',
    } as unknown as DeployService)
    await toReview(w)
    await button(w, 'Send')!.trigger('click')
    await vi.waitFor(() => expect(useDeploy().phase.value).toBe('failed'))
    await router.push('/deploy?domain=3')
    await flushPromises()
    await button(w, 'Retry')!.trigger('click')
    await flushPromises()
    expect(begun).toEqual([2, 2])
    w.unmount()
  })

  describe('a domain change while the plan builds', () => {
    const upgradeTo = (domain: number) => `/deploy?upgrade=${CONTRACT}&domain=${domain}`

    async function toBuilding(w: Awaited<ReturnType<typeof render>>) {
      await useDeploy().loadModule(WASM)
      await flushPromises()
      await button(w, 'Continue')!.trigger('click')
      await flushPromises()
    }

    it('drops a build that was waiting on the price read', async () => {
      let release: (v: unknown) => void = () => undefined
      vi.mocked(SettlementService.getInstance).mockReturnValue({
        getPeripheryConfig: () => new Promise((resolve) => (release = resolve)),
        getDeployRecords: async () => ({ list: [] }),
        getDomains: async () => ({ list: [], count: 0 }),
        getFrontierHeight: async () => 100,
      } as unknown as SettlementService)
      const w = await render(upgradeTo(2))
      await toBuilding(w)
      await router.push(upgradeTo(3))
      await flushPromises()
      release({ znnPerByteOfBytecode: 100n })
      await flushPromises()
      expect(useDeploy().step.value).toBe(1)
      expect(useDeploy().plannedDomainId.value).toBeNull()
      expect(useDeploy().plan.value).toBeNull()
      expect(preflight).toEqual([])
      w.unmount()
    })

    it('drops a build that was waiting on the preflight', async () => {
      let release: (v: unknown[]) => void = () => undefined
      setDeployService({
        journals: async () => [],
        preflight: (input: { domainId: number }) => {
          preflight.push(input.domainId)
          return new Promise((resolve) => (release = resolve))
        },
      } as unknown as DeployService)
      const w = await render(upgradeTo(2))
      await toBuilding(w)
      await vi.waitFor(() => expect(preflight).toEqual([2]))
      await router.push(upgradeTo(3))
      await flushPromises()
      release([])
      await flushPromises()
      expect(useDeploy().step.value).toBe(1)
      expect(useDeploy().plannedDomainId.value).toBeNull()
      expect(useDeploy().plan.value).toBeNull()
      w.unmount()
    })

    it('keeps no stale plan when the build starts again', async () => {
      const w = await render(upgradeTo(2))
      await toBuilding(w)
      await vi.waitFor(() => expect(useDeploy().step.value).toBe(3))
      useDeploy().step.value = 1
      await flushPromises()
      let release: (v: unknown[]) => void = () => undefined
      setDeployService({
        journals: async () => [],
        preflight: () => new Promise((resolve) => (release = resolve)),
      } as unknown as DeployService)
      await button(w, 'Continue')!.trigger('click')
      await flushPromises()
      expect(useDeploy().plan.value).toBeNull()
      release([])
      w.unmount()
    })
  })

  it('shows the domain of each unfinished deploy', async () => {
    setDeployService({
      journals: async () => [
        { id: 'j', domainId: 4, codeHash: 'bb'.repeat(32), steps: [{ status: 'waiting' }] },
      ],
    } as unknown as DeployService)
    const w = await render('/deploy')
    expect(w.find('[data-slot="journal-domain"]').text()).toBe('Domain 4')
    w.unmount()
  })

  it('lists the unfinished deploys on L1 of the page domain', async () => {
    const asked: number[] = []
    vi.mocked(SettlementService.getInstance).mockReturnValue({
      getDeployRecords: async (domainId: number) => {
        asked.push(domainId)
        return {
          list: [{ codeHash: { toString: () => 'ab'.repeat(32) }, receivedCount: 1, chunkCount: 3, isExpired: false, expiresAtHeight: 150 }],
        }
      },
      getDomains: async () => ({ list: [], count: 0 }),
      getPauseState: async () => null,
      getPeripheryConfig: async () => null,
      getExecutorSet: async () => ({ list: [] }),
      getFeeInfo: async () => null,
      getTimeChallenges: async () => ({ list: [] }),
      getFrontierHeight: async () => 100,
    } as unknown as SettlementService)
    const w = await render('/deploy?domain=2')
    expect(asked).toContain(2)
    expect(w.find('[data-slot="l1-records"]').exists()).toBe(true)
    w.unmount()
  })
})
