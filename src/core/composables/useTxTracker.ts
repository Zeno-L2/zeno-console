import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { ZenonService } from '../zenon-service'
import { useNetwork } from './useNetwork'
import { GatewayService } from '../gateway-service'
import { liveLedger } from '../tracker-ledger'
import { TxTrackerService } from '../tx-tracker-service'
import type { TrackState } from '../tx-tracker-service'

/** The tracker wired to the live node and gateway. */
export function createTxTracker(): TxTrackerService {
  return new TxTrackerService({
    ledger: liveLedger(),
    gateway: GatewayService.getInstance(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollIntervalMs: 5000,
  })
}

let factory: () => TxTrackerService = createTxTracker

/** Replaces the live tracker. Tests use it. */
export function setTrackerFactory(next: (() => TxTrackerService) | null) {
  factory = next ?? createTxTracker
}

/** Follows one send. Stops when the component unmounts. */
export function useTxTracker(tracker: TxTrackerService = factory()) {
  const state = shallowRef<TrackState | null>(null)
  let stop: (() => void) | null = null
  let tracked: string | null = null
  let node = ''

  function track(sendHash: string) {
    stop?.()
    state.value = null
    tracked = sendHash
    node = ZenonService.getInstance().getNodeUrl()
    if (!/^[0-9a-fA-F]{64}$/.test(sendHash)) return
    stop = tracker.follow(sendHash.toLowerCase(), (next) => {
      state.value = next
    })
  }

  function untrack() {
    stop?.()
    stop = null
    tracked = null
  }

  // A settled page stops polling, so a node change re-runs the check. The
  // watch keys on isChecking because the node URL swaps after currentNode
  // changes and reverts when the connect fails.
  watch(useNetwork().isChecking, (checking) => {
    if (!checking && tracked && ZenonService.getInstance().getNodeUrl() !== node) track(tracked)
  })

  onBeforeUnmount(untrack)

  return { state, track, untrack }
}
