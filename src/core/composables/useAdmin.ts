import { computed, ref } from 'vue'
import { useSettings } from './useSettings'
import { useSettlement } from './useSettlement'
import { evaluateProposal } from '../admin-actions'
import type { AdminAction, ProposalState } from '../admin-actions'
import { isAdminAddress } from '../admin-gate'
import { AdminSendError, AdminService, createAdminService } from '../admin-service'
import type { PauseRequest, SavedProposal } from '../admin-service'
import { useWalletProvider } from './useWalletProvider'

const isSending = ref(false)
const error = ref<string | null>(null)
const lastHash = ref<string | null>(null)
/** True when the last failed send is one the console knows Settlement refused. */
const lastRefused = ref(false)

let service: AdminService | null = null

/** Replaces the live service. Tests use it. */
export function setAdminService(next: AdminService | null) {
  service = next
}

function adminService(): AdminService {
  if (!service) service = createAdminService()
  return service
}

export interface Evaluation {
  /** Why the typed values do not parse, or null. */
  problem: string | null
  key: string | null
  hash: string | null
  state: ProposalState | null
}

/** The administrator's area: the gate, the proposals and the sends. */
export function useAdmin() {
  const wallet = useWalletProvider()
  const { settings } = useSettings()
  const settlement = useSettlement()

  const isAdmin = computed(() => isAdminAddress(wallet.address.value, settings.value.adminAddress))

  /** Parses the typed values and matches them to the challenge pending under their key. */
  function evaluate(action: AdminAction, texts: Record<string, string>): Evaluation {
    try {
      const { hashed } = adminService().parse(action, texts)
      return {
        problem: null,
        key: hashed.key,
        hash: hashed.hash,
        state: evaluateProposal(hashed, settlement.challenges.value, settlement.frontierHeight.value),
      }
    } catch (err) {
      return { problem: err instanceof Error ? err.message : 'The values are not valid.', key: null, hash: null, state: null }
    }
  }

  async function run(send: () => Promise<string>) {
    error.value = null
    lastHash.value = null
    lastRefused.value = false
    if (!isAdmin.value) {
      error.value = 'Only the network administrator can send this.'
      return
    }
    isSending.value = true
    try {
      lastHash.value = await send()
    } catch (err) {
      if (err instanceof AdminSendError && err.sendHash) lastHash.value = err.sendHash
      lastRefused.value = err instanceof AdminSendError && err.refused
      error.value = err instanceof Error ? err.message : 'The send failed.'
    } finally {
      isSending.value = false
    }
    // The change shows once its momentum confirms, so the board is read again without blocking the form.
    void settlement.loadOverview()
  }

  const send = (action: AdminAction, texts: Record<string, string>) => run(() => adminService().send(action, texts, settings.value.adminAddress.trim()))
  const pause = (request: PauseRequest) => run(() => adminService().pause(request, settings.value.adminAddress.trim()))
  const saved = (key: string): Promise<SavedProposal | null> => adminService().saved(key)

  return { isAdmin, isSending, error, lastHash, lastRefused, challenges: settlement.challenges, frontierHeight: settlement.frontierHeight, evaluate, send, pause, saved, loadOverview: settlement.loadOverview }
}
