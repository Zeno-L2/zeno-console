import type { EventJson } from 'zeno-client'

export interface GuessedTopic {
  hex: string
  /** The topic as an integer, when its first 24 bytes are zero. */
  number?: string
}

/** What can be read from an event with no interface. Every field but the hex is a guess. */
export interface EventGuess {
  /** The name of an event a known interface declares with this topic 0. */
  name: string | null
  /** Topics 1 to 3, the indexed fields. */
  topics: GuessedTopic[]
  /** The data as text: a length-prefixed string filling it, or the whole data when it is printable. */
  text: string | null
  /** The data length in bytes. */
  bytes: number
}

const PRINTABLE = /^[\t\n\r\x20-\x7e -￿]+$/

function bytesOf(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '')
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return new Uint8Array()
  return Uint8Array.from(clean.match(/../g) ?? [], (b) => parseInt(b, 16))
}

function asText(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return PRINTABLE.test(text) ? text : null
  } catch {
    return null
  }
}

function guessTopic(hex: string): GuessedTopic {
  const clean = hex.replace(/^0x/, '').toLowerCase()
  if (clean.length === 64 && /^0{48}/.test(clean)) return { hex, number: BigInt(`0x${clean}`).toString() }
  return { hex }
}

/** Reads what it can from an event no interface decodes. `names` maps lower-case topics to event names. */
export function guessEvent(raw: Pick<EventJson, 'topics' | 'data'>, names: Map<string, string>): EventGuess {
  const [first, ...rest] = raw.topics
  const data = bytesOf(raw.data)
  let text: string | null = null
  // The Zeno codec writes a string or bytes field as a u32 big-endian length, then the bytes.
  if (data.length >= 5) {
    const length = new DataView(data.buffer, data.byteOffset).getUint32(0)
    if (length === data.length - 4) text = asText(data.subarray(4))
  }
  text ??= asText(data)
  return {
    name: first ? (names.get(first.replace(/^0x/, '').toLowerCase()) ?? null) : null,
    topics: rest.map(guessTopic),
    text,
    bytes: data.length,
  }
}
