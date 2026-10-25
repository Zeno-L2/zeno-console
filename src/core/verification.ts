import type { DomainStatus, VerificationReport } from 'zeno-client'

export type VerificationState = 'verified' | 'pending' | 'inconsistent'

export interface VerificationInput {
  /**
   * True when the value passed its checks: the gateway's `verified` flag,
   * or the console's own check for a receipt.
   */
  verified: boolean
  /** The client's own checks, when the read ran them. */
  check?: VerificationReport | null
  /** The domain's status from `zeno_getHead`. */
  domainStatus?: DomainStatus | null
  /** True when an SDK check threw. */
  failed?: boolean
}

/**
 * The badge state of one L2 value (`ZENO-CONSOLE.md` 3):
 *
 * - `inconsistent`: the domain is INCONSISTENT or a check failed.
 * - `pending`: the gateway built it and L1 has not accepted it.
 * - `verified`: `latest` or `finalized`, with proofs checked.
 */
export function verificationState(input: VerificationInput): VerificationState {
  if (input.failed || input.domainStatus === 'INCONSISTENT') return 'inconsistent'
  return input.verified ? 'verified' : 'pending'
}

/** A note for the badge when a check did not run, or null when there is nothing to add. */
export function verificationNote(input: VerificationInput): string | null {
  const check = input.check
  if (!check || !input.verified) return null
  if (!check.rootChecked) {
    return 'The proofs verify against the root the gateway named, but the root was not compared with Settlement.'
  }
  if (check.proofs > 0 && !check.pathsChecked) {
    return 'The values are in the committed state, but they are not confirmed to belong to the requested contract.'
  }
  return null
}
