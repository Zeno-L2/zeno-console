import { Hash, QSR_ZTS, ZNN_ZTS, addNumberDecimals, settlement } from 'znn-typescript-sdk'
import { ZNN_QSR_DECIMALS } from '../config'
import type { WithdrawalState } from './withdrawal-read-service'

/** The name of the enumeration entry whose wire value is `value`, or `#value` for one the SDK lacks. */
export function enumLabel(entries: Readonly<Record<string, number>>, value: number): string {
  const name = Object.keys(entries).find((key) => entries[key] === value)
  return name ?? `#${value}`
}

/** Title case for an enumeration name: `PROOF_VERIFIED` becomes `Proof verified`. */
export function humanize(name: string): string {
  const lower = name.replace(/_/g, ' ').toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export const domainClassLabel = (v: number) => humanize(enumLabel(settlement.DomainClass, v))
export const runtimeKindLabel = (v: number) => enumLabel(settlement.RuntimeKind, v)
export const domainStatusLabel = (v: number) => humanize(enumLabel(settlement.DomainStatus, v))
export const finalityModelLabel = (v: number) => humanize(enumLabel(settlement.FinalityModel, v))
export const execProfileLabel = (v: number) => humanize(enumLabel(settlement.ExecProfile, v))
export const inputSourceLabel = (v: number) => humanize(enumLabel(settlement.InputSource, v))
export const daModeLabel = (v: number) => humanize(enumLabel(settlement.DAMode, v))

/** A raw ZNN or QSR amount as the decimal string `Amount` takes. */
export function formatZnn(raw: bigint): string {
  return addNumberDecimals(raw, ZNN_QSR_DECIMALS)
}

/** The badge text and variant of each withdrawal state. */
export const WITHDRAWAL_STATE_LABEL: Record<WithdrawalState, { label: string; variant: 'pending' | 'warning' | 'success' }> = {
  pending: { label: 'Waiting for the batch', variant: 'pending' },
  relayable: { label: 'Ready to relay', variant: 'warning' },
  queued: { label: 'Queued for release', variant: 'pending' },
  released: { label: 'Released', variant: 'success' },
}

/** The token a withdrawal pays, and its amount in display units (raw base units for tokens other than ZNN and QSR). */
export function describeAsset(assetId: string, amount: string | null) {
  const raw = BigInt(amount ?? '0')
  try {
    const zts = settlement.ztsFromAssetId(Hash.parse(assetId)).toString()
    if (zts === ZNN_ZTS.toString() || zts === QSR_ZTS.toString()) {
      return { symbol: zts === ZNN_ZTS.toString() ? 'ZNN' : 'QSR', value: formatZnn(raw), zts }
    }
    return { symbol: undefined, value: raw.toString(), zts }
  } catch {
    return { symbol: undefined, value: raw.toString(), zts: assetId }
  }
}
