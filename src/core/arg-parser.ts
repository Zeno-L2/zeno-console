import { l1Caller, parseType } from 'zeno-client'
import type { Param, Value } from 'zeno-client'
import { Address, TokenStandard, settlement } from 'znn-typescript-sdk'

/** Where a 32-byte value came from when the text was an address or a token standard. */
export interface ResolvedKey {
  kind: 'caller' | 'asset'
  /** The address or token standard the user typed. */
  source: string
  /** The 32 bytes as 64 hex digits. */
  hex: string
}

/** True for the types that hold 32 bytes: `hash` and `bytes32`. */
export function isKey32(type: string): boolean {
  const spec = parseType(type)
  return spec.kind === 'hash' || (spec.kind === 'bytesN' && spec.length === 32)
}

/**
 * Converts a `z1` address to its caller key or a `zts1` token standard to
 * its asset id. Returns null for any other text, and throws an `Error` that
 * names what is wrong when the text starts like one but is not valid.
 */
export function resolveKeyText(text: string): ResolvedKey | null {
  const source = text.trim()
  if (source.startsWith('z1')) {
    let address: Address
    try {
      address = Address.parse(source)
    } catch {
      throw new Error('Enter a valid Zenon address that starts with z1.')
    }
    return { kind: 'caller', source, hex: l1Caller(address).toString() }
  }
  if (source.startsWith('zts1')) {
    let token: TokenStandard
    try {
      token = TokenStandard.parse(source)
    } catch {
      throw new Error('Enter a valid token standard that starts with zts1.')
    }
    return { kind: 'asset', source, hex: settlement.assetIdFromZts(token).toString() }
  }
  return null
}

/**
 * Turns the text a user typed into the value of `type`. Integers take
 * decimal or `0x` hex, bytes take hex (a 32-byte type also takes a `z1`
 * address or a `zts1` token standard and returns the resolved hex), a bool takes `true` or `false`, and a
 * list or tuple takes JSON. Throws an `Error` that names what is wrong.
 */
export function parseTextValue(type: string, text: string): Value {
  const spec = parseType(type)
  const trimmed = text.trim()
  switch (spec.kind) {
    case 'uint':
    case 'int': {
      if (!/^-?(\d+|0x[0-9a-fA-F]+)$/.test(trimmed)) throw new Error('Enter a whole number.')
      const n = BigInt(trimmed)
      if (spec.kind === 'uint' && n < 0n) throw new Error('Enter a number that is not negative.')
      return n
    }
    case 'bool':
      if (trimmed !== 'true' && trimmed !== 'false') throw new Error('Enter true or false.')
      return trimmed === 'true'
    case 'bytes':
    case 'bytesN':
    case 'hash': {
      if (isKey32(type)) {
        const resolved = resolveKeyText(trimmed)
        if (resolved) return resolved.hex
      }
      const hex = trimmed.replace(/^0x/i, '')
      if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw new Error('Enter bytes as hex.')
      if (spec.kind === 'hash' && hex.length !== 64) throw new Error('Enter 32 bytes (64 hex digits).')
      if (spec.kind === 'bytesN' && hex.length !== spec.length * 2) {
        throw new Error(`Enter ${spec.length} bytes (${spec.length * 2} hex digits).`)
      }
      return trimmed
    }
    case 'string':
      return text
    case 'l1Address':
      if (!/^z1[0-9a-z]{38}$/.test(trimmed)) throw new Error('Enter an address that starts with z1.')
      return trimmed
    case 'list':
    case 'tuple': {
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        throw new Error('Enter a JSON array, for example [1, 2].')
      }
      if (!Array.isArray(parsed)) throw new Error('Enter a JSON array, for example [1, 2].')
      return parsed as Value
    }
  }
}

export interface ParsedArgs {
  /** The values in declared order, present only when every field parsed. */
  values: Value[] | null
  /** One message per field, null where the field is fine. */
  errors: (string | null)[]
}

/** Parses one text per parameter. A missing text counts as empty. */
export function parseArgs(params: Param[], texts: string[]): ParsedArgs {
  const values: Value[] = []
  const errors = params.map((p, i) => {
    try {
      values.push(parseTextValue(p.type, texts[i] ?? ''))
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid value.'
    }
  })
  return { values: errors.every((e) => e === null) ? values : null, errors }
}
