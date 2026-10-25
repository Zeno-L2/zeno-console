import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError, TagUnavailableError, UnknownDomainError, UnsupportedProfileError } from 'zeno-client'
import { GatewayService } from '../gateway-service'
import type { Router } from 'vue-router'
import { gatewayService } from '../../../test/helpers'
import { useDomains } from './useDomains'
import { useSearch } from './useSearch'

const HASH = 'ab'.repeat(32)
const ADDRESS = `z1${'q'.repeat(38)}`

const notFound = () => new NotFoundError('not found', -32004)
const tagUnavailable = () => new TagUnavailableError('tag unavailable', -32005)

interface Probes {
  getReceipt?: () => Promise<unknown>
  contract?: () => Promise<unknown>
  getOutboxProof?: () => Promise<unknown>
}

/** A gateway whose three probes answer as given; an omitted probe answers NotFoundError. */
function serve(probes: Probes = {}) {
  const miss = async () => {
    throw notFound()
  }
  const contract = vi.fn(probes.contract ?? miss)
  const contracts = vi.fn(async () => ({ contract }))
  const client = {
    getReceipt: vi.fn(probes.getReceipt ?? miss),
    getOutboxProof: vi.fn(probes.getOutboxProof ?? miss),
    contracts,
  }
  vi.spyOn(gatewayService, 'client').mockResolvedValue(client as never)
  vi.spyOn(GatewayService, 'getInstance').mockReturnValue(gatewayService)
  return { ...client, contract }
}

function fakeRouter() {
  const push = vi.fn(async () => undefined)
  return { router: { push } as unknown as Router, push }
}

describe('useSearch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const { defaultDomainId } = useDomains()

  it('routes an address without probing the gateway', async () => {
    const probes = serve()
    const { router, push } = fakeRouter()
    expect(await useSearch().navigate(router, ADDRESS)).toBe('found')
    expect(push).toHaveBeenCalledWith(`/address/${ADDRESS}`)
    expect(probes.getReceipt).not.toHaveBeenCalled()
  })

  it('routes a number to that batch of the default domain', async () => {
    serve()
    const { router, push } = fakeRouter()
    expect(await useSearch().navigate(router, ' 42 ')).toBe('found')
    expect(push).toHaveBeenCalledWith(`/batches/${defaultDomainId.value}/42`)
  })

  it('routes a send hash to the receipt page', async () => {
    serve({ getReceipt: async () => ({ sendHash: HASH }) })
    const { router, push } = fakeRouter()
    expect(await useSearch().navigate(router, HASH)).toBe('found')
    expect(push).toHaveBeenCalledWith(`/tx/${HASH}`)
  })

  it('lower-cases an upper-case 64-hex id before probing and routing', async () => {
    const probes = serve({ getReceipt: async () => ({ sendHash: HASH }) })
    const { router, push } = fakeRouter()
    expect(await useSearch().navigate(router, HASH.toUpperCase())).toBe('found')
    expect(probes.getReceipt).toHaveBeenCalledWith(HASH)
    expect(push).toHaveBeenCalledWith(`/tx/${HASH}`)
  })

  it('routes a contract id with a code hash to the contract page of the default domain', async () => {
    const probes = serve({ contract: async () => ({ result: { codeHash: 'cd'.repeat(32) } }) })
    const { router, push } = fakeRouter()
    expect(await useSearch().navigate(router, HASH)).toBe('found')
    expect(push).toHaveBeenCalledWith(`/contracts/${defaultDomainId.value}/${HASH}`)
    expect(probes.contract).toHaveBeenCalledWith(HASH)
  })

  it('does not route a contract answer with a null code hash', async () => {
    serve({ contract: async () => ({ result: { codeHash: null } }) })
    const { router, push } = fakeRouter()
    expect(await useSearch().navigate(router, HASH)).toBe('none')
    expect(push).not.toHaveBeenCalled()
  })

  it('routes an outbox id to the outbox page', async () => {
    serve({ getOutboxProof: async () => ({ outboxId: HASH }) })
    const { router, push } = fakeRouter()
    expect(await useSearch().navigate(router, HASH)).toBe('found')
    expect(push).toHaveBeenCalledWith(`/outbox/${HASH}`)
  })

  it('rethrows a transport error', async () => {
    serve({
      getReceipt: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const { router, push } = fakeRouter()
    await expect(useSearch().navigate(router, HASH)).rejects.toThrow('Failed to fetch')
    expect(push).not.toHaveBeenCalled()
  })

  it('rethrows a transport error from a later probe', async () => {
    serve({
      getOutboxProof: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await expect(useSearch().navigate(fakeRouter().router, HASH)).rejects.toThrow('Failed to fetch')
  })

  it('resolves none when every probe answers NotFoundError', async () => {
    const probes = serve()
    const { router, push } = fakeRouter()
    expect(await useSearch().navigate(router, HASH)).toBe('none')
    expect(probes.getReceipt).toHaveBeenCalledOnce()
    expect(probes.contract).toHaveBeenCalledOnce()
    expect(probes.getOutboxProof).toHaveBeenCalledOnce()
    expect(push).not.toHaveBeenCalled()
  })

  it('resolves none when the contract probe answers UnsupportedProfileError and the others NotFoundError', async () => {
    serve({
      contract: async () => {
        throw new UnsupportedProfileError('contracts', 1)
      },
    })
    expect(await useSearch().navigate(fakeRouter().router, HASH)).toBe('none')
  })

  it('resolves none when the contract probe answers UnknownDomainError', async () => {
    serve({
      contract: async () => {
        throw new UnknownDomainError('unknown domain', -32001)
      },
    })
    expect(await useSearch().navigate(fakeRouter().router, HASH)).toBe('none')
  })

  it('resolves retry when getOutboxProof answers TagUnavailableError and nothing else matches', async () => {
    serve({
      getOutboxProof: async () => {
        throw tagUnavailable()
      },
    })
    const { router, push } = fakeRouter()
    expect(await useSearch().navigate(router, HASH)).toBe('retry')
    expect(push).not.toHaveBeenCalled()
  })

  it('routes a later match even when an earlier probe answered TagUnavailableError', async () => {
    serve({
      getReceipt: async () => {
        throw tagUnavailable()
      },
      getOutboxProof: async () => ({ outboxId: HASH }),
    })
    const { router, push } = fakeRouter()
    expect(await useSearch().navigate(router, HASH)).toBe('found')
    expect(push).toHaveBeenCalledWith(`/outbox/${HASH}`)
  })

  it('resolves none for text that is no address, number or 64-hex id, without probing', async () => {
    const probes = serve()
    for (const query of ['', 'hello', 'ab'.repeat(31), `z1${'q'.repeat(37)}`, '-5', '1.5']) {
      expect(await useSearch().navigate(fakeRouter().router, query)).toBe('none')
    }
    expect(probes.getReceipt).not.toHaveBeenCalled()
  })
})
