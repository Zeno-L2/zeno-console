import { describe, expect, it } from 'vitest'
import { verificationNote, verificationState } from './verification'

const full = { proofs: 5, rootChecked: true, pathsChecked: true }

describe('verificationState', () => {
  it('is verified for a verified result', () => {
    expect(verificationState({ verified: true, check: full })).toBe('verified')
  })

  it('is pending for a result the gateway did not verify', () => {
    expect(verificationState({ verified: false })).toBe('pending')
  })

  it('is inconsistent when the domain is, even for a verified result', () => {
    expect(verificationState({ verified: true, domainStatus: 'INCONSISTENT' })).toBe('inconsistent')
  })

  it('is inconsistent when a check failed', () => {
    expect(verificationState({ verified: false, failed: true })).toBe('inconsistent')
  })

  it('does not call a syncing domain inconsistent', () => {
    expect(verificationState({ verified: true, domainStatus: 'SYNCING' })).toBe('verified')
  })
})

describe('verificationNote', () => {
  it('has no note for a fully checked result', () => {
    expect(verificationNote({ verified: true, check: full })).toBeNull()
  })

  it('warns when the Settlement root was not compared', () => {
    expect(verificationNote({ verified: true, check: { ...full, rootChecked: false } })).toMatch(/not compared with Settlement/)
  })

  it('warns when proofs were checked but paths were not', () => {
    expect(verificationNote({ verified: true, check: { proofs: 3, rootChecked: true, pathsChecked: false } })).toMatch(
      /not confirmed to belong/
    )
  })

  it('has no path warning for a view without proofs', () => {
    expect(verificationNote({ verified: true, check: { proofs: 0, rootChecked: true, pathsChecked: false } })).toBeNull()
  })

  it('has no note for a pending result', () => {
    expect(verificationNote({ verified: false, check: { proofs: 5, rootChecked: false, pathsChecked: true } })).toBeNull()
  })
})
