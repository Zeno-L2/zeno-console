import { describe, expect, it, vi } from 'vitest'
import { Hash } from 'znn-typescript-sdk'
import { fakeZenonService, fixture } from '../../test/rpc-fixture'
import { SettlementService } from './settlement-service'

describe('SettlementService', () => {
  const make = (overrides: Record<string, unknown> = {}) => {
    const { service, calls } = fakeZenonService(1000, overrides)
    return { settlement: new SettlementService(service), calls }
  }

  it('lists domains as models', async () => {
    const { settlement } = make()
    const domains = await settlement.getDomains()
    expect(domains.count).toBe(fixture.allDomains.count)
    expect(domains.list[0].domainId).toBe(fixture.allDomains.list[0].domainId)
    expect(domains.list[0].stfSpecHash.toString()).toBe(fixture.allDomains.list[0].stfSpecHash)
  })

  it('reads the pause state, prices, executors and fees', async () => {
    const { settlement } = make()
    const pause = await settlement.getPauseState()
    expect(pause.global?.submitPaused).toBe(true)
    expect(pause.domains[0].relayPaused).toBe(true)
    expect((await settlement.getPeripheryConfig())?.znnPerByteOfBytecode).toBe(100n)
    expect((await settlement.getExecutorSet()).list[0].pillarName).toBe('pillar-one')
    expect((await settlement.getFeeInfo()).totalFeesCollected).toBe(1000n)
  })

  it('returns null prices before the first SetPeripheryConfig', async () => {
    const { settlement } = make({ 'embedded.settlement.getPeripheryConfig': null })
    expect(await settlement.getPeripheryConfig()).toBeNull()
  })

  it('reads time challenges with their due height', async () => {
    const { settlement } = make()
    const challenges = await settlement.getTimeChallenges()
    expect(challenges.list[0].dueHeight).toBe(1801)
    expect(challenges.list[0].methodName).toMatch(/^SetAssetConfig\/3\//)
  })

  it('passes a deployer address and paging through to the node', async () => {
    const { settlement, calls } = make()
    const records = await settlement.getDeployRecords(3, fixture.deployRecord.deployer, 1, 5)
    expect(records.list[0].codeHash.toString()).toBe(fixture.deployRecord.codeHash)
    const call = calls.find((c) => c.method === 'embedded.settlement.getDeployRecordsByDeployer')
    expect(call?.params[0]).toBe(3)
    expect(call?.params.slice(2)).toEqual([1, 5])
  })

  it('reads an asset, the release queue and outbox processing', async () => {
    const { settlement } = make()
    const asset = await settlement.getAssetInfo(3, Hash.parse(fixture.assetInfo.assetId))
    expect(asset?.totalDeposited).toBe(400n)
    expect((await settlement.getReleaseQueue(3)).count).toBe(1)
    expect(await settlement.isOutboxProcessed(Hash.parse('00'.repeat(32)))).toBe(false)
  })

  it('reports the frontier height', async () => {
    const { settlement } = make()
    expect(await settlement.getFrontierHeight()).toBe(1000)
  })

  it('treats an empty domain list as no domains', async () => {
    const { settlement } = make({ 'embedded.settlement.getAllDomains': fixture.emptyDomains })
    expect((await settlement.getDomains()).list).toEqual([])
  })

  it('reads an account block by hash from the node', async () => {
    const marker = { hash: 'block' }
    const getAccountBlockByHash = vi.fn(async () => marker)
    const settlement = new SettlementService({
      getZenon: () => ({ ledger: { getAccountBlockByHash } }),
      ensureInitialized: async () => undefined,
    } as never)
    const hash = Hash.parse('ab'.repeat(32))
    expect(await settlement.getAccountBlock(hash)).toBe(marker)
    expect(getAccountBlockByHash).toHaveBeenCalledWith(hash)
    getAccountBlockByHash.mockResolvedValue(null as never)
    expect(await settlement.getAccountBlock(hash)).toBeNull()
  })
})
