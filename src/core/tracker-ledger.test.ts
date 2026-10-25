import { describe, expect, it, vi } from 'vitest'
import { LedgerApi, PILLAR_ADDRESS } from 'znn-typescript-sdk'
import applied from '../../test/fixtures/settlement-send-applied.json'
import refused from '../../test/fixtures/settlement-send-refused.json'
import { AdminService } from './admin-service'
import { liveLedger } from './tracker-ledger'
import { TxTrackerService } from './tx-tracker-service'

/** A ledger API that answers from a node response recorded for one send. */
const recording = (recorded: { result: unknown }) => {
  const ledger = new LedgerApi()
  ledger.setClient({ sendRequest: async () => recorded.result } as never)
  return ledger
}

const useLedger = async (recorded: { result: unknown }) => {
  const { ZenonService } = await import('./zenon-service')
  vi.spyOn(ZenonService, 'getInstance').mockReturnValue({
    ensureInitialized: async () => undefined,
    getZenon: () => ({ ledger: recording(recorded) }),
  } as never)
}

describe('liveLedger on recorded pause sends', () => {
  it('reads the send Settlement refused as received and refused', async () => {
    await useLedger(refused)
    const read = await liveLedger().getSend(refused.result.hash)
    expect(read).toMatchObject({ received: true, refused: true })
  })

  it('does not read a send to another account as refused', async () => {
    const other = { result: { ...refused.result, toAddress: PILLAR_ADDRESS.toString() } }
    await useLedger(other)
    const read = await liveLedger().getSend(refused.result.hash)
    expect(read).toMatchObject({ received: true, refused: false })
  })

  it('reads the send Settlement applied as received and not refused', async () => {
    await useLedger(applied)
    const read = await liveLedger().getSend(applied.result.hash)
    expect(read).toMatchObject({ received: true, refused: false })
  })
})

describe('AdminService on recorded pause sends', () => {
  const send = async (recorded: { result: unknown }) => {
    await useLedger(recorded)
    const service = new AdminService({
      writer: {} as never,
      wallet: {} as never,
      reads: {} as never,
      ledger: liveLedger(),
      storage: {} as never,
      now: () => 0,
      sleep: async () => undefined,
    })
    return (service as unknown as { confirmReceived(hash: string): Promise<void> }).confirmReceived(
      (recorded.result as { hash: string }).hash,
    )
  }

  it('throws for the refused send', async () => {
    await expect(send(refused)).rejects.toThrow('Settlement refused this send')
  })

  it('resolves for the applied send', async () => {
    await expect(send(applied)).resolves.toBeUndefined()
  })
})

describe('TxTrackerService on recorded pause sends', () => {
  const snapshot = async (recorded: { result: unknown }) => {
    await useLedger(recorded)
    const tracker = new TxTrackerService({
      ledger: liveLedger(),
      gateway: { client: async () => Promise.reject(new Error('no gateway')) },
      sleep: async () => undefined,
      pollIntervalMs: 1,
    })
    return tracker.snapshot((recorded.result as { hash: string }).hash)
  }

  it('ends the refused send with the refusal error', async () => {
    const state = await snapshot(refused)
    expect(state).toMatchObject({ stage: 'received', refused: true, error: 'Settlement refused this send. It had no effect.' })
  })

  it('leaves the applied send at Received without a refusal', async () => {
    const state = await snapshot(applied)
    expect(state.refused).toBeUndefined()
    expect(state.stage).toBe('received')
  })
})
