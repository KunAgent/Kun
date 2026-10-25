import type { ActivityRow } from '@shared/activity-row'
import { MAX_APP_BADGE_COUNT } from '@shared/kun-gui-api'
import type { NormalizedThread } from '../agent/types'
import type { AttentionItem } from './attention-items'
import { selectAttentionItems } from './attention-items'
import type { ChatState, CompletionAttentionRegistry } from './chat-store-types'
import { selectBackgroundActivityByThread } from './session-execution-summary'
import { persistUnreadCompletions } from './unread-completions'

/**
 * Everything the attention list needs, derived from chat state plus the ADE
 * activity rows that keep a thread's row marked active.
 */
export type AppBadgeInput = {
  threads: readonly NormalizedThread[]
  unreadThreadIds: CompletionAttentionRegistry
  awaitingUserInputThreadIds: Record<string, true>
  watchTurnCompletion: Record<string, boolean>
  scheduledThreadActivities: Record<string, ChatState['scheduledThreadActivities'][string]>
  activeThreadId: string | null
  busy: boolean
  backgroundActivityByThread: Record<string, 'running' | 'waiting'>
}

export function appBadgeInputFromChatState(
  state: Pick<
    ChatState,
    | 'threads'
    | 'unreadThreadIds'
    | 'awaitingUserInputThreadIds'
    | 'watchTurnCompletion'
    | 'scheduledThreadActivities'
    | 'activeThreadId'
    | 'busy'
  >,
  rows: Record<string, ActivityRow>
): AppBadgeInput {
  return {
    threads: state.threads,
    unreadThreadIds: state.unreadThreadIds,
    awaitingUserInputThreadIds: state.awaitingUserInputThreadIds ?? {},
    watchTurnCompletion: state.watchTurnCompletion ?? {},
    scheduledThreadActivities: state.scheduledThreadActivities ?? {},
    activeThreadId: state.activeThreadId,
    busy: state.busy,
    backgroundActivityByThread: selectBackgroundActivityByThread(rows)
  }
}

export function attentionItemsForBadge(input: AppBadgeInput): AttentionItem[] {
  return selectAttentionItems({
    threads: input.threads,
    activityContext: {
      activeThreadId: input.activeThreadId,
      busy: input.busy,
      watchTurnCompletion: input.watchTurnCompletion,
      unreadThreadIds: input.unreadThreadIds,
      scheduledThreadActivities: input.scheduledThreadActivities,
      awaitingUserInputThreadIds: input.awaitingUserInputThreadIds,
      backgroundActivityByThread: input.backgroundActivityByThread
    }
  })
}

let persistedSource: CompletionAttentionRegistry | null = null
let appliedCount = -1

/**
 * Single app-badge formula: the length of the same "needs you" list the
 * sidebar panel renders. Requests from other surfaces (assistant pings, phone
 * pairing) never add numbers here, because they have no panel row to open.
 * Callers may pass any state snapshot; repeats are cheap no-ops.
 */
export function syncAppBadgeCount(input: AppBadgeInput): number {
  if (input.unreadThreadIds !== persistedSource) {
    persistedSource = input.unreadThreadIds
    persistUnreadCompletions(input.unreadThreadIds)
  }
  const count = Math.min(attentionItemsForBadge(input).length, MAX_APP_BADGE_COUNT)
  if (typeof window === 'undefined') return count
  if (typeof window.kunGui?.setAppBadgeCount !== 'function') return count
  if (count === appliedCount) return count
  appliedCount = count
  void window.kunGui.setAppBadgeCount(count).catch((error: unknown) => {
    appliedCount = -1
    void window.kunGui?.logError?.('app-badge', 'Failed to update app badge', {
      message: error instanceof Error ? error.message : String(error),
      count
    }).catch(() => undefined)
  })
  return count
}

/** Test hook: start each case from a clean de-dupe cache. */
export function clearAppBadgeSyncForTests(): void {
  persistedSource = null
  appliedCount = -1
}
