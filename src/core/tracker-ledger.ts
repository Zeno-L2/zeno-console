import { Hash, SETTLEMENT_ADDRESS } from 'znn-typescript-sdk'
import { ZenonService } from './zenon-service'
import { createsDomainInput, isRefusedStatus } from './tx-tracker-service'
import type { TrackerLedger } from './tx-tracker-service'

/** The ledger read wired to the live node. */
export function liveLedger(): TrackerLedger {
  const zenonService = ZenonService.getInstance()
  return {
    async getSend(hash) {
      await zenonService.ensureInitialized()
      const block = await zenonService.getZenon().ledger.getAccountBlockByHash(Hash.parse(hash))
      if (!block) return null
      const paired = block.pairedAccountBlock
      return {
        received: paired !== undefined && paired !== null,
        refused: paired && block.toAddress.toString() === SETTLEMENT_ADDRESS.toString() ? isRefusedStatus(paired.data) : false,
        confirmedAt: block.confirmationDetail?.momentumHeight,
        createsInput: createsDomainInput(block.toAddress.toString(), block.data),
      }
    },
  }
}
