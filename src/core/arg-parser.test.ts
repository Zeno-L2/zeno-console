import { describe, expect, it } from 'vitest'
import { parseArgs, parseTextValue } from './arg-parser'

describe('parseTextValue', () => {
  it('parses integers as bigints from decimal or hex', () => {
    expect(parseTextValue('u64', ' 42 ')).toBe(42n)
    expect(parseTextValue('u256', '0xff')).toBe(255n)
    expect(parseTextValue('i32', '-7')).toBe(-7n)
    expect(parseTextValue('i8', '-1')).toBe(-1n)
    expect(parseTextValue('u128', '1')).toBe(1n)
  })

  it('rejects a non-number, a negative unsigned number and unsupported types', () => {
    expect(() => parseTextValue('u64', '1.5')).toThrow('Enter a whole number.')
    expect(() => parseTextValue('u8', '-1')).toThrow('is not negative')
    expect(() => parseTextValue('i256', '1')).toThrow()
  })

  it('parses booleans only as true or false', () => {
    expect(parseTextValue('bool', 'true')).toBe(true)
    expect(parseTextValue('bool', 'false')).toBe(false)
    expect(() => parseTextValue('bool', 'yes')).toThrow('Enter true or false.')
  })

  it('checks hex bytes, hashes and fixed bytes by length', () => {
    expect(parseTextValue('bytes', '0xdeadbeef')).toBe('0xdeadbeef')
    expect(parseTextValue('bytes', '')).toBe('')
    expect(() => parseTextValue('bytes', 'xyz')).toThrow('hex')
    expect(() => parseTextValue('hash', 'ab')).toThrow('32 bytes')
    expect(parseTextValue('hash', 'ab'.repeat(32))).toBe('ab'.repeat(32))
    expect(() => parseTextValue('bytes4', 'aabb')).toThrow('4 bytes')
    expect(parseTextValue('bytes4', 'aabbccdd')).toBe('aabbccdd')
  })

  describe('32-byte fields', () => {
    const CALLER = 'b0ebd11e758ddc06bc598e4d693943a807f9e9838b2840946e2c4c2f6ace00fa'
    const ADDRESS = 'z1qpeet8dcjg0m6x6m3tg437wnc42aa2nez2fzth'
    const ZNN_ASSET = '0000000000000000000000000000000000000000000014e66318c6318c6318c6'
    const QSR_ASSET = '0000000000000000000000000000000000000000000004066318c6318c6318c6'

    it('turns a z1 address into its caller key', () => {
      expect(parseTextValue('hash', ` ${ADDRESS} `)).toBe(CALLER)
      expect(parseTextValue('bytes32', ADDRESS)).toBe(CALLER)
      expect(parseTextValue('hash', 'z1qq6eg8n43g032hanpsfp02qcdmv7zfj3y2lt5d')).toBe(
        '8596e4919e0195ff2247a7e66a2c1e9176d1237b6864b147c8a73e28ee9bc730'
      )
    })

    it('turns a zts1 token standard into its asset id', () => {
      expect(parseTextValue('bytes32', 'zts1znnxxxxxxxxxxxxx9z4ulx')).toBe(ZNN_ASSET)
      expect(parseTextValue('hash', 'zts1qsrxxxxxxxxxxxxxmrhjll')).toBe(QSR_ASSET)
    })

    it('keeps hex working with or without 0x', () => {
      expect(parseTextValue('hash', CALLER)).toBe(CALLER)
      expect(parseTextValue('bytes32', `0x${CALLER}`)).toBe(`0x${CALLER}`)
      expect(() => parseTextValue('bytes32', 'abcd')).toThrow('32 bytes')
      expect(() => parseTextValue('bytes32', 'zz')).toThrow('Enter bytes as hex.')
    })

    it('names what is wrong with a bad address or token standard', () => {
      expect(() => parseTextValue('hash', 'z1qpeet8dcjg0m6x6m3tg437wnc42aa2nez2fzzz')).toThrow('valid Zenon address')
      expect(() => parseTextValue('hash', 'z1abc')).toThrow('valid Zenon address')
      expect(() => parseTextValue('bytes32', 'zts1abc')).toThrow('valid token standard')
    })

    it('converts only 32-byte types', () => {
      expect(() => parseTextValue('bytes16', ADDRESS)).toThrow('Enter bytes as hex.')
      expect(() => parseTextValue('bytes', ADDRESS)).toThrow('hex')
    })
  })

  it('keeps a string as typed and checks an address shape', () => {
    expect(parseTextValue('string', ' hi ')).toBe(' hi ')
    expect(parseTextValue('l1Address', 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp')).toBe(
      'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'
    )
    expect(() => parseTextValue('l1Address', 'nope')).toThrow('z1')
  })

  it('parses lists and tuples as JSON arrays', () => {
    expect(parseTextValue('list<u32>', '[1, 2]')).toEqual([1, 2])
    expect(parseTextValue('(u8,bytes4)', '[9, "aabbccdd"]')).toEqual([9, 'aabbccdd'])
    expect(() => parseTextValue('list<u32>', '1, 2')).toThrow('JSON array')
    expect(() => parseTextValue('list<u32>', '{"a":1}')).toThrow('JSON array')
  })
})

describe('parseArgs', () => {
  const params = [
    { name: 'start', type: 'u64' },
    { name: 'flag', type: 'bool' },
  ]

  it('returns the values in order when every field parses', () => {
    expect(parseArgs(params, ['5', 'true'])).toEqual({ values: [5n, true], errors: [null, null] })
  })

  it('reports each bad field and returns no values', () => {
    const parsed = parseArgs(params, ['x', 'true'])
    expect(parsed.values).toBeNull()
    expect(parsed.errors[0]).toBe('Enter a whole number.')
    expect(parsed.errors[1]).toBeNull()
  })

  it('counts a missing text as empty', () => {
    expect(parseArgs(params, []).values).toBeNull()
  })
})
