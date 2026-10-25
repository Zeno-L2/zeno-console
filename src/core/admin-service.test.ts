import { beforeAll, describe, expect, it } from 'vitest'
import { SettlementContract, Zenon, settlement } from 'znn-typescript-sdk'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import { actionFor } from './admin-actions'
import { isAdminAddress } from './admin-gate'
import { AdminSendError, AdminService } from './admin-service'
import { SettlementWriteService } from './settlement-write-service'

class MemoryStorage {
  data = new Map<string, unknown>()
  async get<T>(key: string) {
    return (this.data.has(key) ? structuredClone(this.data.get(key)) : null) as T | null
  }
  async set<T>(key: string, value: T) {
    this.data.set(key, structuredClone(value))
  }
  async remove(key: string) {
    this.data.delete(key)
  }
}

const sighash = (name: string) => SettlementContract.abi.getSighash(name).replace(/^0x/, '')

const ADMIN = 'z1qadmin'
const HASH = 'cd'.repeat(32)

interface PauseEntry {
  domainId: number
  submitPaused?: boolean
  relayPaused?: boolean
}

function rig() {
  const sent: AccountBlockTemplate[] = []
  const storage = new MemoryStorage()
  const state = {
    published: { hash: HASH, address: ADMIN } as Record<string, unknown>,
    pause: { global: null, domains: [] } as { global: PauseEntry | null; domains: PauseEntry[] },
    /** Pause states returned by successive reads; the last one repeats. */
    pauseReads: [] as { global: PauseEntry | null; domains: PauseEntry[] }[],
    reads: 0,
    sleeps: [] as number[],
    /** What the node returns for the send, one entry per read; the last repeats. */
    receives: [{ received: true, refused: false }] as ({ received: boolean; refused?: boolean } | Error)[],
    receiveReads: 0,
  }
  const service = new AdminService({
    writer: new SettlementWriteService({ getZenon: () => Zenon.getInstance(), ensureInitialized: async () => undefined }),
    wallet: {
      send: async (t) => {
        sent.push(t)
        return state.published as never
      },
    },
    reads: {
      getPauseState: async () => {
        const next = state.pauseReads[Math.min(state.reads, state.pauseReads.length - 1)] ?? state.pause
        state.reads += 1
        return next as never
      },
    },
    ledger: {
      getSend: async () => {
        const next = state.receives[Math.min(state.receiveReads, state.receives.length - 1)]
        state.receiveReads += 1
        if (next instanceof Error) throw next
        return { createsInput: false, ...next }
      },
    },
    storage,
    now: () => 1234,
    sleep: async (ms) => {
      state.sleeps.push(ms)
    },
  })
  return { service, sent, storage, state }
}

beforeAll(() => Zenon.setChainID(1))

describe('isAdminAddress', () => {
  it('needs a connected address equal to the configured administrator', () => {
    expect(isAdminAddress('z1a', 'z1a')).toBe(true)
    expect(isAdminAddress('z1a', ' z1a ')).toBe(true)
    expect(isAdminAddress('z1b', 'z1a')).toBe(false)
    expect(isAdminAddress(null, 'z1a')).toBe(false)
    expect(isAdminAddress('z1a', '')).toBe(false)
  })
})

describe('AdminService', () => {
  const prices = { znnPerByteOfBytecode: '100', znnPerByteOfState: '200' }

  it('sends the method with the typed values and remembers them under the key', async () => {
    const { service, sent } = rig()
    const hash = await service.send(actionFor('SetPeripheryConfig'), prices, ADMIN)
    expect(hash).toBe(HASH)
    expect(Buffer.from(sent[0].data).toString('hex').startsWith(sighash('SetPeripheryConfig'))).toBe(true)
    const saved = await service.saved('SetPeripheryConfig')
    expect(saved).toMatchObject({ method: 'SetPeripheryConfig', texts: prices, sendHash: hash, sentAt: 1234 })
    expect(saved?.hash).toBe(settlement.settlementParamsHash('SetPeripheryConfig', { znnPerByteOfBytecode: 100n, znnPerByteOfState: 200n }).toString())
  })

  it('sends the identical values again to execute, with the same hash', async () => {
    const { service, sent } = rig()
    await service.send(actionFor('SetPeripheryConfig'), prices, ADMIN)
    await service.send(actionFor('SetPeripheryConfig'), prices, ADMIN)
    expect(Buffer.from(sent[0].data).toString('hex')).toBe(Buffer.from(sent[1].data).toString('hex'))
  })

  it('sends nothing when the values do not parse', async () => {
    const { service, sent } = rig()
    await expect(service.send(actionFor('SetPeripheryConfig'), { znnPerByteOfBytecode: 'x', znnPerByteOfState: '1' }, ADMIN)).rejects.toThrow('whole number')
    expect(sent).toHaveLength(0)
  })

  it('keeps one saved proposal per key and forgets it on request', async () => {
    const { service } = rig()
    await service.send(actionFor('SetDomainConfig'), { domainId: '3', withdrawalDelay: '1', runtimeUpgradeDelay: '2' }, ADMIN)
    await service.send(actionFor('SetDomainConfig'), { domainId: '4', withdrawalDelay: '1', runtimeUpgradeDelay: '2' }, ADMIN)
    expect(await service.saved('SetDomainConfig/3')).not.toBeNull()
    expect(await service.saved('SetDomainConfig/4')).not.toBeNull()
    await service.forget('SetDomainConfig/3')
    expect(await service.saved('SetDomainConfig/3')).toBeNull()
  })

  it('pauses and resumes both scopes, globally and per domain', async () => {
    const { service, sent, state } = rig()
    state.pause = {
      global: { domainId: 0, submitPaused: true },
      domains: [{ domainId: 3, relayPaused: false }],
    }
    await service.pause({ domainId: 0, isGlobal: true, scope: settlement.PauseScope.PAUSE_SUBMIT, active: true }, ADMIN)
    await service.pause({ domainId: 3, isGlobal: false, scope: settlement.PauseScope.PAUSE_RELAY, active: false }, ADMIN)
    expect(sent).toHaveLength(2)
    for (const t of sent) expect(Buffer.from(t.data).toString('hex').startsWith(sighash('Pause'))).toBe(true)
    expect(Buffer.from(sent[0].data).toString('hex')).not.toBe(Buffer.from(sent[1].data).toString('hex'))
  })

  it('refuses a pause scope Settlement does not know', async () => {
    const { service, sent } = rig()
    await expect(service.pause({ domainId: 1, isGlobal: false, scope: 7, active: true }, ADMIN)).rejects.toThrow('Choose what to pause.')
    expect(sent).toHaveLength(0)
  })

  const relayPause = { domainId: 3, isGlobal: false, scope: settlement.PauseScope.PAUSE_RELAY, active: true }

  it('refuses a send the wallet signed with another address and saves no proposal', async () => {
    const { service, state } = rig()
    state.published = { hash: HASH, address: 'z1qother' }
    const err = await service.send(actionFor('SetPeripheryConfig'), prices, ADMIN).catch((e) => e)
    expect(err).toBeInstanceOf(AdminSendError)
    expect(err.sendHash).toBe(HASH)
    expect(err.message).toContain('z1qother')
    expect(err.message).toContain(ADMIN)
    expect(err.refused).toBe(true)
    expect(await service.saved('SetPeripheryConfig')).toBeNull()
  })

  it('refuses a send that Settlement received and refused', async () => {
    const { service, state } = rig()
    state.receives = [{ received: true, refused: true }]
    const err = await service.send(actionFor('SetPeripheryConfig'), prices, ADMIN).catch((e) => e)
    expect(err).toBeInstanceOf(AdminSendError)
    expect(err.sendHash).toBe(HASH)
    expect(err.message).toContain('Settlement refused this send')
    expect(err.refused).toBe(true)
  })

  it('waits for the receive block before it resolves a send', async () => {
    const { service, state } = rig()
    state.receives = [{ received: false }, new Error('node down'), { received: true, refused: false }]
    expect(await service.send(actionFor('SetPeripheryConfig'), prices, ADMIN)).toBe(HASH)
    expect(state.receiveReads).toBe(3)
  })

  it('refuses a send whose receive block never shows, keeping the send hash', async () => {
    const { service, state } = rig()
    state.receives = [{ received: false }]
    const err = await service.send(actionFor('SetPeripheryConfig'), prices, ADMIN).catch((e) => e)
    expect(err).toBeInstanceOf(AdminSendError)
    expect(err.sendHash).toBe(HASH)
    expect(err.message).toContain('has not received this send')
    expect(err.refused).toBe(false)
    expect(state.receiveReads).toBe(6)
  })

  it('refuses a pause signed by another address without reading the pause state', async () => {
    const { service, state } = rig()
    state.published = { hash: HASH, address: 'z1qother' }
    await expect(service.pause(relayPause, ADMIN)).rejects.toBeInstanceOf(AdminSendError)
    expect(state.reads).toBe(0)
  })

  it('resolves a pause once Settlement shows the scope', async () => {
    const { service, state } = rig()
    state.pauseReads = [{ global: null, domains: [] }, { global: null, domains: [{ domainId: 3, relayPaused: true }] }]
    expect(await service.pause(relayPause, ADMIN)).toBe(HASH)
    expect(state.reads).toBe(2)
    expect(state.sleeps).toEqual([10000, 10000])
  })

  it('resolves a resume of a domain with no stored pause entry', async () => {
    const { service, state } = rig()
    state.pause = { global: null, domains: [] }
    expect(await service.pause({ ...relayPause, active: false }, ADMIN)).toBe(HASH)
    expect(state.reads).toBe(1)
  })

  it('refuses a pause that never shows, keeping the send hash', async () => {
    const { service, state } = rig()
    const err = await service.pause(relayPause, ADMIN).catch((e) => e)
    expect(err).toBeInstanceOf(AdminSendError)
    expect(err.sendHash).toBe(HASH)
    expect(err.message).toContain('does not show the change')
    expect(err.refused).toBe(false)
    expect(state.reads).toBe(6)
  })

  it('keeps the proposal and reports an unknown signer when the wallet names none', async () => {
    const { service, state } = rig()
    state.published = { hash: HASH }
    const err = await service.send(actionFor('SetPeripheryConfig'), prices, ADMIN).catch((e) => e)
    expect(err).toBeInstanceOf(AdminSendError)
    expect(err.sendHash).toBe(HASH)
    expect(err.message).toContain('did not report which account signed')
    expect(err.refused).toBe(false)
    expect(await service.saved('SetPeripheryConfig')).not.toBeNull()
  })

  it('confirms a pause by the read when the wallet names no signer', async () => {
    const { service, state } = rig()
    state.published = { hash: HASH }
    state.pause = { global: null, domains: [{ domainId: 3, relayPaused: true }] }
    expect(await service.pause(relayPause, ADMIN)).toBe(HASH)
  })

  it('confirms a global submit pause only from the global entry\'s submit flag', async () => {
    const { service, state } = rig()
    const request = { domainId: 0, isGlobal: true, scope: settlement.PauseScope.PAUSE_SUBMIT, active: true }
    state.pause = { global: { domainId: 0, relayPaused: true }, domains: [{ domainId: 0, submitPaused: true }] }
    await expect(service.pause(request, ADMIN)).rejects.toBeInstanceOf(AdminSendError)
    state.reads = 0
    state.pause = { global: { domainId: 0, submitPaused: true }, domains: [] }
    expect(await service.pause(request, ADMIN)).toBe(HASH)
    expect(state.reads).toBe(1)
  })

  it('does not confirm a pause shown for another domain', async () => {
    const { service, state } = rig()
    state.pause = { global: null, domains: [{ domainId: 4, relayPaused: true }] }
    await expect(service.pause(relayPause, ADMIN)).rejects.toBeInstanceOf(AdminSendError)
    expect(state.reads).toBe(6)
  })

  it('reads a global resume with no global entry as not paused', async () => {
    const { service, state } = rig()
    const request = { domainId: 0, isGlobal: true, scope: settlement.PauseScope.PAUSE_RELAY, active: false }
    expect(await service.pause(request, ADMIN)).toBe(HASH)
    expect(state.reads).toBe(1)
  })
})
