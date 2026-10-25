import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** SHA-256 of each file in test/fixtures, and where it is copied from. */
const FIXTURES: Record<string, { sha256: string; source: string }> = {
  'gateway-go.json': {
    sha256: '8ec7e3a6977284c33c9ac535e675a53e4472a6f178e51a6e6efda8f974e6bbd2',
    source: 'zeno-client-ts test/fixtures/gateway/gateway-go.json',
  },
  'settlement-send-applied.json': {
    sha256: 'c2ee262242dbffe476743087c0f4bb880517b3b89651ba1ac56c3de2c2a1d70c',
    source: 'ledger.getAccountBlockByHash on the devnet node, a pause send Settlement applied',
  },
  'settlement-send-refused.json': {
    sha256: '2c36873ee35260ec58a9b48db817ab87062fc5ed57621e38887f58f75d496c96',
    source: 'ledger.getAccountBlockByHash on the devnet node, a pause send Settlement refused',
  },
  'settlement-rpc-go.json': {
    sha256: 'f0006e21f58d781d68a63a64066f84220d2dc68dce844372f45c31486fe930a6',
    source: 'znn-typescript-sdk test/fixtures/settlement-rpc-go.json',
  },
  'vault.interface.json': {
    sha256: '26f4d8c1b1d1cbf9dcf2ed4d99fcbc4b8e81af5bfb476c756bfd99b759fefba9',
    source: 'zeno-contract-sdk-rs examples/vault/artifacts/vault.interface.json',
  },
  'vault.wasm': {
    sha256: '03a69b05e5f04d8755f6ca837eb7e795406ab18c500265d712253f504ef5344f',
    source: 'zeno-contract-sdk-rs examples/vault/artifacts/vault.wasm',
  },
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

describe('test fixtures', () => {
  it('pins every copied fixture', () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(FIXTURES).sort())
    for (const [name, { sha256: pinned, source }] of Object.entries(FIXTURES)) {
      const message = `test/fixtures/${name} changed. Copy it again from ${source}, or pin the new copy.`
      expect(sha256(readFileSync(resolve(dir, name))), message).toBe(pinned)
    }
  })

  it('detects a changed copy', () => {
    const bytes = Uint8Array.from(readFileSync(resolve(dir, 'vault.wasm')))
    bytes[0] ^= 1
    expect(sha256(bytes)).not.toBe(FIXTURES['vault.wasm'].sha256)
  })
})
