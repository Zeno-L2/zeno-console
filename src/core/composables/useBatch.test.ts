import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DomainInconsistentError, GatewayClient, UnknownDomainError } from 'zeno-client'
import { GatewayService } from '../gateway-service'
import { SettlementService } from '../settlement-service'
import { altered, call, replayClient, settlementBatches } from '../../../test/replay-client'
import type { RecordedCall } from '../../../test/replay-client'
import { fakeZenonService } from '../../../test/rpc-fixture'
import { useBatch } from './useBatch'

const service = new GatewayService({ getBatch: async () => null } as never)

/** A copy of `getBatch latest` served at the params [1, 3]. */
const batch3 = (edit?: (result: Record<string, any>) => void): RecordedCall => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const source = edit ? altered('getBatch latest', edit) : call('getBatch latest')
  return { ...source, params: [1, 3] }
}

function serve(opts: { extra?: RecordedCall[]; l1?: boolean; roots?: typeof settlementBatches }) {
  const { client } = replayClient(opts.extra ?? [])
  const gateway = new GatewayClient(client, { batches: opts.roots ?? settlementBatches })
  vi.spyOn(service, 'client').mockResolvedValue(gateway)
  vi.spyOn(GatewayService, 'getInstance').mockReturnValue(service)
  const { service: zenon } = fakeZenonService(1000, opts.l1 === false ? { 'embedded.settlement.getBatch': null } : {})
  vi.spyOn(SettlementService, 'getInstance').mockReturnValue(new SettlementService(zenon))
}

const load = async (domainId = 1, batchId = 3) => {
  const b = useBatch(ref(domainId), ref(batchId))
  await b.load()
  return b
}

describe('useBatch', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads both layers and checks the roots', async () => {
    serve({ extra: [batch3()] })
    const b = await load()
    expect(b.l1.value).not.toBeNull()
    expect(b.l2.value?.check.rootChecked).toBe(true)
    expect(b.l2Missing.value).toBe(false)
    expect(b.failedCheck.value).toBe(false)
    expect(b.error.value).toBeNull()
    expect(b.isLoading.value).toBe(false)
  })

  it('marks l2Missing and keeps the L1 batch when the gateway answers NotFoundError', async () => {
    const missing: RecordedCall = { ...batch3(), response: { error: { code: -32004, message: 'batch not found' } } }
    serve({ extra: [missing] })
    const b = await load()
    expect(b.l1.value).not.toBeNull()
    expect(b.l2.value).toBeNull()
    expect(b.l2Missing.value).toBe(true)
    expect(b.error.value).toBeNull()
  })

  it('keeps the gateway batch when L1 answers null', async () => {
    serve({ extra: [batch3((r) => { r.verified = false })], l1: false, roots: async () => null })
    const b = await load()
    expect(b.l1.value).toBeNull()
    expect(b.l2.value?.verified).toBe(false)
    expect(b.l2.value?.check.rootChecked).toBe(false)
  })

  it('reports failedCheck and an error when a root differs from Settlement', async () => {
    serve({ extra: [batch3((r) => { r.postStateRoot = '11'.repeat(32) })] })
    const b = await load()
    expect(b.failedCheck.value).toBe(true)
    expect(b.error.value).toBeTruthy()
    expect(b.l2.value).toBeNull()
  })

  it('keeps DomainInconsistentError apart from error', async () => {
    serve({ extra: [batch3()] })
    vi.spyOn(service, 'client').mockResolvedValue({
      getBatch: async () => {
        throw new DomainInconsistentError('zeno_getBatch', { code: -32010, message: 'domain inconsistent' } as never)
      },
    } as never)
    const b = await load()
    expect(b.inconsistent.value).toBeTruthy()
    expect(b.error.value).toBeNull()
    expect(b.failedCheck.value).toBe(false)
  })

  it('records a plain error', async () => {
    serve({ extra: [batch3()] })
    vi.spyOn(service, 'client').mockRejectedValue(new Error('gateway down'))
    const b = await load()
    expect(b.error.value).toBe('gateway down')
    expect(b.failedCheck.value).toBe(false)
  })

  it('keeps l1 and sets l2Error when the gateway does not serve the domain', async () => {
    serve({ extra: [batch3()] })
    vi.spyOn(service, 'client').mockResolvedValue({
      getBatch: async () => {
        throw new UnknownDomainError('unknown domain', -32001)
      },
    } as never)
    const b = await load()
    expect(b.l1.value).not.toBeNull()
    expect(b.l2Error.value).toBe('This gateway does not serve domain 1')
    expect(b.error.value).toBeNull()
  })

  it('keeps l1 when the gateway is inconsistent', async () => {
    serve({ extra: [batch3()] })
    vi.spyOn(service, 'client').mockResolvedValue({
      getBatch: async () => {
        throw new DomainInconsistentError('domain inconsistent', -32010)
      },
    } as never)
    const b = await load()
    expect(b.l1.value).not.toBeNull()
    expect(b.inconsistent.value).toBeTruthy()
  })

  it('drops the previous batch when the batch id changes and the new load fails', async () => {
    serve({ extra: [batch3()] })
    const batchId = ref(3)
    const b = useBatch(ref(1), batchId)
    await b.load()
    expect(b.l1.value).not.toBeNull()
    expect(b.l2.value).not.toBeNull()
    vi.spyOn(service, 'client').mockRejectedValue(new Error('gateway down'))
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getBatch: async () => {
        throw new Error('node down')
      },
    } as never)
    batchId.value = 4
    await b.load()
    expect(b.l1.value).toBeNull()
    expect(b.l2.value).toBeNull()
    expect(b.l2Missing.value).toBe(false)
  })

  it('keeps the loaded batch when the same batch reloads', async () => {
    serve({ extra: [batch3()] })
    const b = await load()
    vi.spyOn(service, 'client').mockRejectedValue(new Error('gateway down'))
    await b.load()
    expect(b.l1.value).not.toBeNull()
    expect(b.l2.value).not.toBeNull()
  })
})
