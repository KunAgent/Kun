import { create } from 'zustand'
import type { ChatBlock } from '../agent/types'
import type { TurnUsageSummary } from '../hooks/use-turn-usage'

export type MobileMessageActionsPayload = {
  block: ChatBlock
  forkAction?: { busy: boolean; onFork: () => void }
  rollbackAction?: { busy: boolean; onRollback: () => void }
  /** Desktop TurnUsageRow is not rendered on mobile; its data moves into the sheet. */
  turnUsage?: TurnUsageSummary
  turnUsageStale?: boolean
}

type MobileMessageActionsState = {
  payload: MobileMessageActionsPayload | null
  open: (payload: MobileMessageActionsPayload) => void
  close: () => void
}

/**
 * Shared bubbles dispatch their "more" request here; the mobile conversation
 * mounts a single MobileMessageActionsSheet bound to this store. Keeps the
 * sheet out of shared desktop components and avoids prop-drilling a callback
 * through the whole timeline tree.
 */
export const useMobileMessageActionsStore = create<MobileMessageActionsState>((set) => ({
  payload: null,
  open: (payload) => set({ payload }),
  close: () => set({ payload: null })
}))
