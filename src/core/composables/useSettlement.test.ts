import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeZenonService } from '../../../test/rpc-fixture'
import { SettlementService } from '../settlement-service'
import { useSettlement } from './useSettlement'

describe('useSettlement', () => {
  afterEach(() => vi.restoreAllMocks())

  it('loads the overview from the recorded Settlement state', async () => {
    const { service } = fakeZenonService(1000)
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue(new SettlementService(service))
    const s = useSettlement()
    await s.loadOverview()
    expect(s.error.value).toBeNull()
    expect(s.domains.value.length).toBeGreaterThan(0)
    expect(s.pause.value?.global?.submitPaused).toBe(true)
    expect(s.periphery.value?.znnPerByteOfState).toBe(200n)
    expect(s.executors.value).toHaveLength(1)
    expect(s.challenges.value[0].dueHeight).toBe(1801)
    expect(s.frontierHeight.value).toBe(1000)
    expect(s.isLoading.value).toBe(false)
  })

  it('records the error and stops loading when a call fails', async () => {
    const { service } = fakeZenonService(1000, { 'embedded.settlement.getFeeInfo': undefined })
    const failing = new SettlementService(service)
    vi.spyOn(failing, 'getFeeInfo').mockRejectedValue(new Error('node unreachable'))
    vi.spyOn(SettlementService, 'getInstance').mockReturnValue(failing)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const s = useSettlement()
    await s.loadOverview()
    expect(s.error.value).toBe('node unreachable')
    expect(s.isLoading.value).toBe(false)
  })
})
