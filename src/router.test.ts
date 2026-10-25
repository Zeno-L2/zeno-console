import { afterEach, describe, expect, it } from 'vitest'
import { useSettings } from '@/core'
import { STORAGE_KEY_SETTINGS } from './config'
import { storageService } from '@/core/storage/storage-service'
import { router } from './router'

const nameOf = (path: string) => router.resolve(path).matched.map((r) => r.name ?? r.path)

describe('router', () => {
  it.each([
    ['/domains/1/inputs', 'domain-inputs'],
    ['/domains/1/events', 'domain-events'],
    ['/domains/1/outbox', 'domain-outbox'],
  ])('resolves %s to the %s tab inside the domain layout', (path, name) => {
    const matched = router.resolve(path).matched
    expect(matched).toHaveLength(2)
    expect(matched[1].name).toBe(name)
  })

  it('passes the ?batch= query through to the outbox tab', () => {
    expect(router.resolve('/domains/1/outbox?batch=3').query.batch).toBe('3')
  })

  it.each([
    ['/tx/abc', 'sendHash', 'abc'],
    ['/address/z1abc', 'address', 'z1abc'],
    ['/outbox/def', 'outboxId', 'def'],
  ])('resolves the detail route %s', (path, param, value) => {
    const route = router.resolve(path)
    expect(route.matched).toHaveLength(1)
    expect(route.params[param]).toBe(value)
  })

  it('resolves an unknown path to the not-found page', () => {
    expect(nameOf('/nowhere/at/all')).toHaveLength(1)
    expect(router.resolve('/nowhere/at/all').params.pathMatch).toEqual(['nowhere', 'at', 'all'])
  })

  it.each(['/deploy', '/withdrawals', '/admin'])('resolves %s to one page', (path) => {
    const matched = router.resolve(path).matched
    expect(matched).toHaveLength(1)
    expect(matched[0].path).toBe(path)
  })

  it('resolves a 64 hex contract id to the redirect route and a domain contract to the detail page', () => {
    const id = 'ab'.repeat(32)
    const bare = router.resolve(`/contracts/${id}`)
    expect(bare.params.contractId).toBe(id)
    expect(bare.params.domainId).toBeUndefined()
    const detail = router.resolve(`/contracts/2/${id}`)
    expect(detail.params).toMatchObject({ domainId: '2', contractId: id })
  })

  it.each([
    ['/', 1],
    ['/network', 1],
    ['/playground', 1],
    ['/settings', 1],
    ['/batches/1/2', 1],
    ['/domains/1', 2],
    ['/domains/1/batches', 2],
    ['/domains/1/contracts', 2],
    ['/contracts/1/' + 'ab'.repeat(32), 1],
  ])('resolves the explorer route %s to a real page', (path, depth) => {
    const matched = router.resolve(path).matched
    expect(matched).toHaveLength(depth)
    expect(matched.every((r) => r.path !== '/:pathMatch(.*)*')).toBe(true)
  })

  it('resolves the batch route params', () => {
    expect(router.resolve('/batches/3/9').params).toMatchObject({ domainId: '3', batchId: '9' })
  })

  it.each(['/contracts/xyz', '/contracts/' + 'ab'.repeat(31), '/contracts/' + 'zz'.repeat(32)])(
    'sends %s, which is not a 64 hex id, to the not-found page',
    (path) => {
      expect(router.resolve(path).params.pathMatch).toBeDefined()
    }
  )

  it('rejects a non-numeric domain id', () => {
    expect(router.resolve('/domains/abc').params.pathMatch).toBeDefined()
  })

  describe('/contracts', () => {
    afterEach(() => {
      useSettings().settings.value = { ...useSettings().settings.value, domainId: 1 }
    })

    it('redirects to the contracts tab of the saved domain', async () => {
      const s = useSettings()
      s.settings.value = { ...s.settings.value, domainId: 3 }
      s.isLoaded.value = true
      await router.push('/contracts')
      expect(router.currentRoute.value.fullPath).toBe('/domains/3/contracts')
    })

    it('reads the stored settings before it redirects on a cold start', async () => {
      const s = useSettings()
      await storageService.set(STORAGE_KEY_SETTINGS, { domainId: 6 })
      s.isLoaded.value = false
      s.settings.value = { ...s.settings.value, domainId: 1 }
      await router.push('/domains/1/contracts')
      await router.push('/contracts')
      expect(router.currentRoute.value.fullPath).toBe('/domains/6/contracts')
      await storageService.remove(STORAGE_KEY_SETTINGS)
    })
  })

  describe('/contracts/<64 hex>', () => {
    afterEach(() => {
      useSettings().settings.value = { ...useSettings().settings.value, domainId: 1 }
    })

    it('redirects to the contract page of the saved domain, in lower case', async () => {
      const s = useSettings()
      s.settings.value = { ...s.settings.value, domainId: 3 }
      s.isLoaded.value = true
      await router.push('/contracts/' + 'AB'.repeat(32))
      expect(router.currentRoute.value.fullPath).toBe('/contracts/3/' + 'ab'.repeat(32))
    })

    it('sends a path that is not 64 hex characters to the not-found page', async () => {
      await router.push('/contracts/' + 'ab'.repeat(31))
      expect(router.currentRoute.value.fullPath).toBe('/contracts/' + 'ab'.repeat(31))
      expect(nameOf('/contracts/' + 'ab'.repeat(31))).toEqual(['/:pathMatch(.*)*'])
    })

    it('reads the stored settings before it redirects on a cold start', async () => {
      const s = useSettings()
      await storageService.set(STORAGE_KEY_SETTINGS, { domainId: 6 })
      s.isLoaded.value = false
      s.settings.value = { ...s.settings.value, domainId: 1 }
      await router.push('/domains/1/contracts')
      await router.push('/contracts/' + 'ab'.repeat(32))
      expect(router.currentRoute.value.fullPath).toBe('/contracts/6/' + 'ab'.repeat(32))
      await storageService.remove(STORAGE_KEY_SETTINGS)
    })
  })
})
