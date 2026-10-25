import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RunnerUnreachableError,
  runCommands,
  runnerVersion,
  serveCommand,
  toSimulateResult,
} from './local-runner'
import type { RunnerCommand, RunnerReceipt } from './local-runner'

const receipt = (over: Partial<RunnerReceipt> = {}): RunnerReceipt => ({
  status: 'SUCCESS',
  gasUsed: 10,
  abortCode: 0,
  contractId: '11'.repeat(32),
  codeHash: '22'.repeat(32),
  returnData: '',
  events: [
    {
      contractId: '11'.repeat(32),
      inputIndex: 1,
      eventIndex: 0,
      topics: ['aa'.repeat(32)],
      data: '00',
    },
  ],
  outbox: [],
  stateDiff: [],
  claimedDeposit: '0',
  ...over,
})

const deploy: RunnerCommand = {
  op: 'deploy',
  sender: '00' + '01'.repeat(19),
  module: '0061736d',
  metadata: 'immutable',
}

const stubFetch = (response: Response | Error) => {
  const fn = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('runCommands', () => {
  it('posts the commands as JSON and returns the results', async () => {
    const results = [{ ok: true, receipt: receipt(), contractId: '11'.repeat(32) }]
    const fetchFn = stubFetch(json({ results }))
    expect(await runCommands('http://127.0.0.1:8547', [deploy])).toEqual(results)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8547/v1/run')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.body).toBe(JSON.stringify({ commands: [deploy] }))
  })

  it('drops trailing slashes from the base url', async () => {
    const fetchFn = stubFetch(
      json({ results: [{ ok: false, error: { kind: 'halt', message: 'x' } }] })
    )
    await runCommands('http://127.0.0.1:8547//', [deploy])
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('http://127.0.0.1:8547/v1/run')
  })

  it('throws RunnerUnreachableError when fetch rejects', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    const run = runCommands('http://127.0.0.1:8547', [deploy])
    await expect(run).rejects.toBeInstanceOf(RunnerUnreachableError)
    await expect(run).rejects.toThrow('zeno-exec is not answering at http://127.0.0.1:8547')
  })

  it('reports the status and text of a non-2xx answer', async () => {
    stubFetch(new Response('body must be {"commands":[...]}\n', { status: 400 }))
    await expect(runCommands('http://x', [deploy])).rejects.toThrow(
      'zeno-exec answered 400: body must be {"commands":[...]}'
    )
  })

  it('throws when the results do not match the commands', async () => {
    stubFetch(json({ results: [] }))
    await expect(runCommands('http://x', [deploy])).rejects.toThrow(/0 results for 1 commands/)
  })
})

describe('response checks', () => {
  it('rejects a result it cannot read', async () => {
    stubFetch(json({ results: [{ ok: true, receipt: { status: 1 } }] }))
    await expect(runCommands('http://x', [deploy])).rejects.toThrow('cannot read')
    stubFetch(json({ results: [{ ok: false, error: 'boom' }] }))
    await expect(runCommands('http://x', [deploy])).rejects.toThrow('cannot read')
    stubFetch(json({ results: [null] }))
    await expect(runCommands('http://x', [deploy])).rejects.toThrow('cannot read')
  })

  it.each([
    ['ok is not a boolean', { ok: 'true', receipt: receipt() }],
    ['the receipt has no status string', { ok: true, receipt: { ...receipt(), status: undefined } }],
    ['the receipt events are not a list', { ok: true, receipt: { ...receipt(), events: {} } }],
    ['the receipt is a list', { ok: true, receipt: [] }],
    ['the error has no kind string', { ok: false, error: { kind: 1, message: 'm' } }],
    ['the error has no message string', { ok: false, error: { kind: 'k' } }],
    ['the error is a list', { ok: false, error: [] }],
  ])('rejects a result when %s', async (_name, result) => {
    stubFetch(json({ results: [result] }))
    await expect(runCommands('http://x', [deploy])).rejects.toThrow('cannot read')
  })

  it('accepts a successful and a failed result', async () => {
    const failed = { ok: false, error: { kind: 'k', message: 'm' } }
    stubFetch(json({ results: [{ ok: true, receipt: receipt() }, failed] }))
    await expect(runCommands('http://x', [deploy, deploy])).resolves.toHaveLength(2)
  })

  it('rejects a body that is not an object or not JSON', async () => {
    stubFetch(json(null))
    await expect(runCommands('http://x', [deploy])).rejects.toThrow('0 results')
    stubFetch(new Response('not json', { status: 200 }))
    await expect(runCommands('http://x', [deploy])).rejects.toThrow('not JSON')
  })

  it('rejects a version document with the wrong member types', async () => {
    stubFetch(json({ version: '1', revision: 5, modified: false }))
    await expect(runnerVersion('http://x')).rejects.toThrow('cannot read')
    stubFetch(json({ version: '1', revision: 'r', modified: 'no' }))
    await expect(runnerVersion('http://x')).rejects.toThrow('cannot read')
  })

  it.each([[null], [[]], ['text']])('rejects a version document that is %j', async (body) => {
    stubFetch(json(body))
    await expect(runnerVersion('http://x')).rejects.toThrow('cannot read')
  })
})

describe('result shape', () => {
  const good = () => ({ ok: true, receipt: receipt() })
  const reject = async (result: unknown) => {
    stubFetch(json({ results: [result] }))
    await expect(runCommands('http://x', [deploy])).rejects.toThrow(
      'zeno-exec answered a result this console cannot read'
    )
  }

  it('accepts a complete receipt', async () => {
    stubFetch(json({ results: [good()] }))
    await expect(runCommands('http://x', [deploy])).resolves.toHaveLength(1)
  })

  it('rejects a returnData that is not a string', async () => {
    await reject({ ok: true, receipt: { ...receipt(), returnData: { length: 3 } } })
  })

  it('rejects an event whose data or topics are not strings', async () => {
    const event = receipt().events[0]
    await reject({ ok: true, receipt: { ...receipt(), events: [{ ...event, data: 5 }] } })
    await reject({ ok: true, receipt: { ...receipt(), events: [{ ...event, topics: [7] }] } })
    await reject({ ok: true, receipt: { ...receipt(), events: [{ ...event, topics: 'x' }] } })
  })

  it('rejects an event that is not an object with the unreadable-result message', async () => {
    for (const event of [null, 5, 'x', []]) {
      await reject({ ok: true, receipt: { ...receipt(), events: [event] } })
    }
  })

  it('rejects a gas, abort code, outbox or contract id of the wrong type', async () => {
    await reject({ ok: true, receipt: { ...receipt(), gasUsed: '1' } })
    await reject({ ok: true, receipt: { ...receipt(), abortCode: null } })
    await reject({ ok: true, receipt: { ...receipt(), outbox: {} } })
    await reject({ ok: true, receipt: receipt(), contractId: 5 })
  })
})

describe('timeout', () => {
  /** A fetch whose answer, or whose body when `hangBody`, ends only when the request is aborted. */
  const stubHungFetch = (hangBody: boolean) => {
    const hangUntilAbort = (signal?: AbortSignal | null) =>
      new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) =>
        hangBody
          ? ({ ok: true, json: () => hangUntilAbort(init.signal) } as unknown as Response)
          : hangUntilAbort(init.signal)
      )
    )
  }

  afterEach(() => vi.useRealTimers())

  it('gives up after 30 s and not before when the runner never answers', async () => {
    vi.useFakeTimers()
    stubHungFetch(false)
    let settled = false
    const pending = runnerVersion('http://127.0.0.1:8547')
    const assertion = expect(pending).rejects.toThrow(
      'zeno-exec did not answer within 30 s at http://127.0.0.1:8547'
    )
    void pending.catch(() => (settled = true))
    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
  })

  it('gives up after 30 s when the answer starts but its body never ends', async () => {
    vi.useFakeTimers()
    stubHungFetch(true)
    const pending = runCommands('http://127.0.0.1:8547', [deploy])
    const assertion = expect(pending).rejects.toThrow('zeno-exec did not answer within 30 s')
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it('leaves no timer running after an answer', async () => {
    vi.useFakeTimers()
    stubFetch(json({ version: '1', revision: 'r', modified: false }))
    await runnerVersion('http://x')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('runnerVersion', () => {
  it('reads the version document', async () => {
    const fetchFn = stubFetch(
      json({ version: '1.2.3', revision: 'abcdef0123456789', modified: false })
    )
    expect(await runnerVersion('http://127.0.0.1:8547/')).toEqual({
      version: '1.2.3',
      revision: 'abcdef0123456789',
      modified: false,
    })
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://127.0.0.1:8547/v1/version'
    )
  })

  it('maps a rejected fetch to RunnerUnreachableError', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    await expect(runnerVersion('http://x')).rejects.toBeInstanceOf(RunnerUnreachableError)
  })
})

describe('serveCommand', () => {
  it('omits the flag for the default http localhost origins', () => {
    expect(serveCommand('http://localhost:5173')).toBe('zeno-exec serve')
    expect(serveCommand('http://127.0.0.1:4173')).toBe('zeno-exec serve')
  })

  it('adds --allow-origin for any other origin', () => {
    expect(serveCommand('https://console.example')).toBe(
      'zeno-exec serve --allow-origin https://console.example'
    )
    expect(serveCommand('https://localhost:5173')).toBe(
      'zeno-exec serve --allow-origin https://localhost:5173'
    )
  })

  it('adds --listen for a local runner URL on another port', () => {
    expect(serveCommand('http://localhost:5173', 'http://127.0.0.1:9000')).toBe(
      'zeno-exec serve --listen 127.0.0.1:9000'
    )
    expect(serveCommand('https://console.example', 'http://localhost:9000/')).toBe(
      'zeno-exec serve --allow-origin https://console.example --listen 127.0.0.1:9000'
    )
    expect(serveCommand('http://localhost:5173', 'http://127.0.0.1:8547')).toBe('zeno-exec serve')
    expect(serveCommand('http://localhost:5173', 'https://runner.example:9000')).toBe(
      'zeno-exec serve'
    )
  })

  it('quotes an origin that holds shell characters', () => {
    expect(serveCommand('http://x$(id).localhost:5173')).toBe(
      "zeno-exec serve --allow-origin 'http://x$(id).localhost:5173'"
    )
    expect(serveCommand("http://a'b.example")).toBe(
      "zeno-exec serve --allow-origin 'http://a'\\''b.example'"
    )
    expect(serveCommand('http://[::1]:5173')).toBe(
      "zeno-exec serve --allow-origin 'http://[::1]:5173'"
    )
  })

  it('quotes every hostile origin so a shell reads it as one literal word', () => {
    const hostile = [
      'http://a`id`.example',
      'http://a;rm.example',
      'http://a&b.example',
      'http://a|b.example',
      'http://a!b.example',
      'http://a\\b.example',
      'http://a b.example',
      'http://a\nb.example',
      'http://a$(id)b.example',
      "http://a'$(id)'b.example",
    ]
    for (const origin of hostile) {
      const command = serveCommand(origin)
      const word = command.slice('zeno-exec serve --allow-origin '.length)
      expect(word.startsWith("'") && word.endsWith("'"), origin).toBe(true)
      // Undoing the quoting gives back exactly the origin.
      expect(word.slice(1, -1).replace(/'\\''/g, "'"), origin).toBe(origin)
      // Outside the escaped quotes no unquoted character is left.
      expect(word.slice(1, -1).replace(/'\\''/g, '').includes("'"), origin).toBe(false)
    }
  })

  it.each([
    'http://x$(touch PWNED).localhost:5173',
    'http://x`touch PWNED`.localhost:5173',
    'http://a;touch PWNED.localhost:5173',
    "http://a'b.localhost:5173",
    "http://a'$(touch PWNED)'b.localhost:5173",
    'http://a b.localhost:5173',
    'http://a\nb.localhost:5173',
    'http://a&touch PWNED.localhost:5173',
    'http://a|touch PWNED.localhost:5173',
    'http://a!b.localhost:5173',
    'http://a\\b.localhost:5173',
    'http://a>PWNED.localhost:5173',
    'http://a*.localhost:5173',
    'http://[::1]:5173',
    `http://${'a'.repeat(5000)}.localhost:5173`,
    'https://console.example',
  ])('hands the shell exactly one literal argument for the origin %#', (origin) => {
    const dir = mkdtempSync(join(tmpdir(), 'serve-command-'))
    const bin = mkdtempSync(join(tmpdir(), 'serve-command-bin-'))
    try {
      // Stands in for zeno-exec and prints each argument ended by a NUL.
      writeFileSync(join(bin, 'zeno-exec'), '#!/bin/sh\nfor a in "$@"; do printf \'%s\\0\' "$a"; done\n', {
        mode: 0o755,
      })
      const run = spawnSync('sh', ['-c', serveCommand(origin, 'http://127.0.0.1:9000')], {
        cwd: dir,
        encoding: 'utf8',
        env: { PATH: `${bin}:/usr/bin:/bin` },
      })
      const argv = run.stdout.split('\0').slice(0, -1)
      expect(argv).toEqual(['serve', '--allow-origin', origin, '--listen', '127.0.0.1:9000'])
      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(bin, { recursive: true, force: true })
    }
  })

  it('omits the flag for the null origin, which the runner refuses', () => {
    expect(serveCommand('null')).toBe('zeno-exec serve')
  })
})

describe('toSimulateResult', () => {
  it('keeps the receipt members and fills the chain fields with zeros', () => {
    const r = receipt({ status: 'REVERT', abortCode: 1, returnData: 'ff' })
    const sim = toSimulateResult(r)
    expect(sim.status).toBe('REVERT')
    expect(sim.abortCode).toBe(1)
    expect(sim.returnData).toBe('ff')
    expect(sim.events).toEqual(r.events)
    expect(sim).toMatchObject({
      domainId: 0,
      batchId: 0,
      inputIndex: 0,
      simulated: true,
      verified: false,
      postStateRoot: '',
    })
  })
})
