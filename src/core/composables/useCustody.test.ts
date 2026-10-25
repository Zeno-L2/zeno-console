import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hash, QSR_ZTS, ZNN_ZTS, settlement } from 'znn-typescript-sdk'
import { SettlementService } from '../settlement-service'
import { useCustody } from './useCustody'

const znnId = settlement.assetIdFromZts(ZNN_ZTS)
const qsrId = settlement.assetIdFromZts(QSR_ZTS)
const otherId = Hash.parse('00'.repeat(22) + '01'.repeat(10))

const entries = (assetId: Hash, count: number) => Array.from({ length: count }, () => ({ assetId }))
const info = (domainId: number, assetId: Hash) => ({ domainId, assetId, totalDeposited: 5n }) as never

function serve(queue: Hash[], knownAssets: Hash[]) {
  const getReleaseQueue = vi.fn(async (_domain: number, page: number, size: number) => ({
    list: queue.slice(page * size, (page + 1) * size).map((assetId) => ({ assetId })),
  }))
  const getAssetInfo = vi.fn(async (domainId: number, assetId: Hash) =>
    knownAssets.some((a) => a.toString() === assetId.toString()) ? info(domainId, assetId) : null
  )
  vi.spyOn(SettlementService, 'getInstance').mockReturnValue({ getReleaseQueue, getAssetInfo } as never)
  return { getReleaseQueue, getAssetInfo }
}

describe('useCustody', () => {
  afterEach(() => vi.restoreAllMocks())

  it('counts release queue entries per asset across pages of 100', async () => {
    const queue = [...entries(otherId, 120), ...entries(znnId, 30)].map((e) => e.assetId)
    const { getReleaseQueue } = serve(queue, [znnId, qsrId, otherId])
    const custody = useCustody()
    await custody.load([3])
    expect(getReleaseQueue.mock.calls.map(([, page, size]) => [page, size])).toEqual([
      [0, 100],
      [1, 100],
    ])
    const depth = Object.fromEntries(custody.rows.value.map((r) => [r.assetId, r.queueDepth]))
    expect(depth[otherId.toString()]).toBe(120)
    expect(depth[znnId.toString()]).toBe(30)
    expect(depth[qsrId.toString()]).toBe(0)
    expect(custody.rows.value.find((r) => r.assetId === znnId.toString())?.zts).toBe(ZNN_ZTS.toString())
    expect(custody.error.value).toBeNull()
  })

  it('drops a row whose asset info is null', async () => {
    serve([otherId, otherId], [znnId])
    const custody = useCustody()
    await custody.load([3])
    expect(custody.rows.value.map((r) => r.assetId)).toEqual([znnId.toString()])
  })

  it('reads every domain it is given', async () => {
    const { getAssetInfo } = serve([], [znnId, qsrId])
    const custody = useCustody()
    await custody.load([3, 4])
    expect(custody.rows.value.map((r) => r.domainId).sort()).toEqual([3, 3, 4, 4])
    expect(getAssetInfo).toHaveBeenCalledTimes(4)
  })

  it('records the error and leaves loading when a read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue({
      getReleaseQueue: vi.fn().mockRejectedValue(new Error('node unreachable')),
    } as never)
    const custody = useCustody()
    await custody.load([3])
    expect(custody.error.value).toBe('node unreachable')
    expect(custody.isLoading.value).toBe(false)
    expect(custody.rows.value).toEqual([])
  })
})
