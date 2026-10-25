import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LOCAL_RUNNER_URL, STORAGE_KEY_SETTINGS } from '../../config'
import { DEFAULT_SETTINGS, useSettings } from './useSettings'

describe('useSettings', () => {
  beforeEach(async () => {
    localStorage.clear()
    await useSettings().reset()
  })

  it('loads the defaults when nothing is stored', async () => {
    const s = useSettings()
    await s.load()
    expect(s.settings.value).toEqual(DEFAULT_SETTINGS)
    expect(s.isLoaded.value).toBe(true)
  })

  it('persists an update and merges it with the current settings', async () => {
    const s = useSettings()
    await s.update({ gatewayUrl: 'https://gw.example', domainId: 4 })
    expect(s.settings.value).toEqual({ ...DEFAULT_SETTINGS, gatewayUrl: 'https://gw.example', domainId: 4 })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) ?? '{}').domainId).toBe(4)
  })

  it('reads stored settings and fills in fields added later', async () => {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({ gatewayUrl: 'https://stored.example' }))
    const s = useSettings()
    await s.load()
    expect(s.settings.value.gatewayUrl).toBe('https://stored.example')
    expect(s.settings.value.domainId).toBe(DEFAULT_SETTINGS.domainId)
    expect(s.settings.value.localRunnerUrl).toBe(DEFAULT_LOCAL_RUNNER_URL)
  })

  it('restores the defaults and clears the stored value', async () => {
    const s = useSettings()
    await s.update({ adminAddress: 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp' })
    await s.reset()
    expect(s.settings.value).toEqual(DEFAULT_SETTINGS)
    expect(localStorage.getItem(STORAGE_KEY_SETTINGS)).toBeNull()
  })
})
