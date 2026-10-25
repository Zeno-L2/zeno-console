import { describe, expect, it } from 'vitest'
import { Address, Hash, SettlementTimeChallenge, settlement } from 'znn-typescript-sdk'
import { TIMED_ACTIONS, actionFor, canExecute, evaluateProposal, hashOf } from './admin-actions'

const ASSET = '00'.repeat(22) + '14e66318c6318c6318c6'
const EXECUTOR = 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'

const challenge = (methodName: string, paramsHash: string, due: number) =>
  new SettlementTimeChallenge(methodName, Hash.parse(paramsHash), due - 100, due)

describe('admin actions', () => {
  it('covers every time-challenged method the SDK knows', () => {
    expect(TIMED_ACTIONS.map((a) => a.method).sort()).toEqual(
      [
        'InitiateEscapeHatch',
        'RegisterDomain',
        'RegisterExecutor',
        'SetApprovedDAModes',
        'SetAssetConfig',
        'SetDomainConfig',
        'SetPeripheryConfig',
      ]
    )
  })

  describe('parsing', () => {
    it('parses the periphery prices', () => {
      const a = actionFor('SetPeripheryConfig')
      expect(a.parse({ znnPerByteOfBytecode: '100', znnPerByteOfState: '200' })).toEqual({
        znnPerByteOfBytecode: 100n,
        znnPerByteOfState: 200n,
      })
      expect(() => a.parse({ znnPerByteOfBytecode: '-1', znnPerByteOfState: '2' })).toThrow('The bytecode price must be a whole number.')
      expect(() => a.parse({ znnPerByteOfBytecode: '1', znnPerByteOfState: '' })).toThrow('The state price')
    })

    it('parses domain delays and rejects a domain id above u32', () => {
      const a = actionFor('SetDomainConfig')
      expect(a.parse({ domainId: '3', withdrawalDelay: '100800', runtimeUpgradeDelay: '201600' })).toEqual({
        domainId: 3,
        withdrawalDelay: 100800n,
        runtimeUpgradeDelay: 201600n,
      })
      expect(() => a.parse({ domainId: '4294967296', withdrawalDelay: '1', runtimeUpgradeDelay: '1' })).toThrow('above')
    })

    it('parses an asset limit and checks the asset id length', () => {
      const a = actionFor('SetAssetConfig')
      const p = a.parse({ domainId: '3', assetId: ASSET, maxBatchWithdrawal: '1000' }) as { assetId: Hash }
      expect(p.assetId.toString()).toBe(ASSET)
      expect(() => a.parse({ domainId: '3', assetId: 'ab', maxBatchWithdrawal: '1' })).toThrow('32 bytes')
    })

    it('parses the DA modes as a list', () => {
      const a = actionFor('SetApprovedDAModes')
      expect(a.parse({ domainId: '1', modes: '0, 2' })).toEqual({ domainId: 1, modes: [0, 2] })
      expect(() => a.parse({ domainId: '1', modes: '' })).toThrow('at least one')
      expect(() => a.parse({ domainId: '1', modes: '300' })).toThrow('above 255')
    })

    it('parses an executor and refuses a bad address or an empty name', () => {
      const a = actionFor('RegisterExecutor')
      const p = a.parse({ pillarName: ' pillar-one ', executorAddress: EXECUTOR }) as { pillarName: string; executorAddress: Address }
      expect(p.pillarName).toBe('pillar-one')
      expect(p.executorAddress.toString()).toBe(EXECUTOR)
      expect(() => a.parse({ pillarName: '', executorAddress: EXECUTOR })).toThrow('pillar name is required')
      expect(() => a.parse({ pillarName: 'p', executorAddress: 'nope' })).toThrow('starts with z1')
    })

    it('parses a full domain registration with its defaults', () => {
      const a = actionFor('RegisterDomain')
      const texts = Object.fromEntries(a.fields.map((f) => [f.key, f.default ?? '']))
      Object.assign(texts, { domainId: '3', stfSpecHash: 'ab'.repeat(32), withdrawalDelay: '100800', runtimeUpgradeDelay: '201600' })
      const p = a.parse(texts) as { domainId: number; minExecutors: number; status: number; profileConfig: Uint8Array }
      expect(p.domainId).toBe(3)
      expect(p.minExecutors).toBe(1)
      expect(p.status).toBe(settlement.DomainStatus.ACTIVE)
      expect(p.profileConfig).toHaveLength(0)
    })
  })

  describe('hash and key', () => {
    it('matches the SDK for the pending key and hash', () => {
      const a = actionFor('SetDomainConfig')
      const params = a.parse({ domainId: '3', withdrawalDelay: '100800', runtimeUpgradeDelay: '201600' })
      const h = hashOf(a, params)
      expect(h.key).toBe('SetDomainConfig/3')
      expect(h.hash).toBe(settlement.settlementParamsHash('SetDomainConfig', params as never).toString())
    })

    it('keys an asset limit by domain and asset', () => {
      const a = actionFor('SetAssetConfig')
      const h = hashOf(a, a.parse({ domainId: '3', assetId: ASSET, maxBatchWithdrawal: '1' }))
      expect(h.key).toBe(`SetAssetConfig/3/${ASSET}`)
    })

    it('changes the hash when a value changes and keeps the key', () => {
      const a = actionFor('SetPeripheryConfig')
      const one = hashOf(a, a.parse({ znnPerByteOfBytecode: '1', znnPerByteOfState: '2' }))
      const two = hashOf(a, a.parse({ znnPerByteOfBytecode: '1', znnPerByteOfState: '3' }))
      expect(one.key).toBe(two.key)
      expect(one.hash).not.toBe(two.hash)
    })
  })

  describe('matching a proposal to the pending challenge', () => {
    const a = actionFor('SetPeripheryConfig')
    const params = a.parse({ znnPerByteOfBytecode: '100', znnPerByteOfState: '200' })
    const hashed = hashOf(a, params)

    it('is none when nothing is pending under the key', () => {
      expect(evaluateProposal(hashed, [], 1000)).toEqual({ kind: 'none' })
      expect(evaluateProposal(hashed, [challenge('SetDomainConfig/3', 'cd'.repeat(32), 2000)], 1000)).toEqual({ kind: 'none' })
    })

    it('is pending, with the momentums left, before the due height', () => {
      const state = evaluateProposal(hashed, [challenge(hashed.key, hashed.hash, 1800)], 1000)
      expect(state).toEqual({ kind: 'pending', dueHeight: 1800, remaining: 800 })
      expect(canExecute(state)).toBe(false)
    })

    it('is ready at the due height and after it', () => {
      for (const height of [1800, 1801, 5000]) {
        const state = evaluateProposal(hashed, [challenge(hashed.key, hashed.hash, 1800)], height)
        expect(state).toEqual({ kind: 'ready', dueHeight: 1800 })
        expect(canExecute(state)).toBe(true)
      }
    })

    it('is different when another proposal holds the key, and never executable', () => {
      const other = 'ef'.repeat(32)
      const state = evaluateProposal(hashed, [challenge(hashed.key, other, 1800)], 5000)
      expect(state).toEqual({ kind: 'different', dueHeight: 1800, pendingHash: other })
      expect(canExecute(state)).toBe(false)
    })
  })
})
