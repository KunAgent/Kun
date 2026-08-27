import { useMemo } from 'react'
import { useChatStore } from '../../store/chat-store'
import type { ClawImChannelV1 } from '@shared/app-settings'
import type { NormalizedThread } from '../../agent/types'
import type { AppRoute } from '../../store/chat-store-types'

/**
 * Snapshot of chat-store fields that `MessageTimeline` needs. Co-locates
 * the (many) `useChatStore` selectors in one place so adding a new field
 * to the timeline only touches this hook + the consuming component.
 */
export type TimelineStores = {
  route: AppRoute
  workspaceRoot: string
  chooseWorkspace: () => Promise<string | null>
  clawChannels: ClawImChannelV1[]
  activeClawChannel: ClawImChannelV1 | null
  busy: boolean
  busyUnconfirmed: boolean
  threadHasMoreHistory: boolean
  threadHistoryLoading: boolean
  loadEarlierThreadHistory: () => Promise<boolean>
  currentTurnId: string | null
  currentTurnUserId: string | null
  turnStartedAtByUserId: Record<string, number>
  turnDurationByUserId: Record<string, number>
  turnReasoningFirstAtByUserId: Record<string, number>
  turnReasoningLastAtByUserId: Record<string, number>
  activeThread: NormalizedThread | null
}

export function useTimelineStores(activeThreadId: string | null): TimelineStores {
  const route = useChatStore((s) => s.route)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const busy = useChatStore((s) => s.busy)
  const busyUnconfirmed = useChatStore((s) => s.busyUnconfirmed)
  const threadHasMoreHistory = useChatStore((s) => s.threadHasMoreHistory)
  const threadHistoryLoading = useChatStore((s) => s.threadHistoryLoading)
  const loadEarlierThreadHistory = useChatStore((s) => s.loadEarlierThreadHistory)
  const currentTurnId = useChatStore((s) => s.currentTurnId)
  const currentTurnUserId = useChatStore((s) => s.currentTurnUserId)
  const turnStartedAtByUserId = useChatStore((s) => s.turnStartedAtByUserId)
  const turnDurationByUserId = useChatStore((s) => s.turnDurationByUserId)
  const turnReasoningFirstAtByUserId = useChatStore((s) => s.turnReasoningFirstAtByUserId)
  const turnReasoningLastAtByUserId = useChatStore((s) => s.turnReasoningLastAtByUserId)
  const activeThread = useChatStore((s) =>
    activeThreadId ? s.threads.find((thread) => thread.id === activeThreadId) ?? null : null
  )
  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? null,
    [activeClawChannelId, clawChannels]
  )

  return {
    route,
    workspaceRoot,
    chooseWorkspace,
    clawChannels,
    activeClawChannel,
    busy,
    busyUnconfirmed,
    threadHasMoreHistory,
    threadHistoryLoading,
    loadEarlierThreadHistory,
    currentTurnId,
    currentTurnUserId,
    turnStartedAtByUserId,
    turnDurationByUserId,
    turnReasoningFirstAtByUserId,
    turnReasoningLastAtByUserId,
    activeThread
  }
}
