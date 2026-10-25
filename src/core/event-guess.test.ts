import { describe, expect, it } from 'vitest'
import { guessEvent } from './event-guess'

const T0 = 'ab'.repeat(32)
const hex = (s: string) => Buffer.from(s).toString('hex')

describe('guessEvent', () => {
  it('names the event from topic 0 in any case', () => {
    const g = guessEvent({ topics: [`0x${T0.toUpperCase()}`], data: '' }, new Map([[T0, 'Moved']]))
    expect(g.name).toBe('Moved')
    expect(g.bytes).toBe(0)
  })

  it('reads a topic with 24 leading zero bytes as an integer', () => {
    const small = '00'.repeat(24) + '00000000000004d2'
    const g = guessEvent({ topics: [T0, small, 'ff'.repeat(32)], data: '' }, new Map())
    expect(g.name).toBeNull()
    expect(g.topics).toEqual([{ hex: small, number: '1234' }, { hex: 'ff'.repeat(32) }])
  })

  it('reads a length-prefixed string', () => {
    const g = guessEvent({ topics: [T0], data: `0x0000000568656c6c6f` }, new Map())
    expect(g.text).toBe('hello')
    expect(g.bytes).toBe(9)
  })

  it('reads printable data as text and leaves binary data alone', () => {
    expect(guessEvent({ topics: [T0], data: hex('plain text') }, new Map()).text).toBe('plain text')
    expect(guessEvent({ topics: [T0], data: '00ff10' }, new Map()).text).toBeNull()
  })
})
