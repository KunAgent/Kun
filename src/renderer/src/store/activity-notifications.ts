import type { ActivityRow } from '@shared/activity-row'
import type { AdeActivityNotificationCategory } from '@shared/kun-gui-notification-contracts'
import i18n from '../i18n'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useActivityStore } from './activity-store'
import { syncAppBadgeCount } from './app-badge'
import { useChatStore } from './chat-store'
import type { ChatState } from './chat-store-types'

export const ADE_NOTIFICATION_DEDUPE_LIMIT = 500

/**
 * Row transition → notification category (06 §3 states + the stalled flag).
 * A stalled flip wins over a state label so a still-"working" but stuck unit
 * surfaces once.
 */
export function activityNotificationCategory(
  row: Pick<ActivityRow, 'state' | 'stalled'>,
  prev: Pick<ActivityRow, 'state' | 'stalled'> | undefined
): AdeActivityNotificationCategory | null {
  if (row.stalled && !prev?.stalled) return 'stalled'
  if (prev && row.state === prev.state) return null
  if (row.state === 'waiting') return 'waiting'
  if (row.state === 'failed') return 'failed'
  if (row.state === 'done') return 'done'
  return null
}

/** Dedupe key per spec: unit + category (+ row.stateSince epoch). */
export function activityNotificationDedupeKey(
  row: Pick<ActivityRow, 'unitId' | 'stateSince'>,
  category: AdeActivityNotificationCategory
): string {
  return `${row.unitId}:${category}:${row.stateSince}`
}

/**
 * The unit's thread is already on screen and focused — the composer/timeline
 * surface it, so a desktop notification would only repeat what the user sees.
 */
export function activityRowCurrentlyVisible(
  row: Pick<ActivityRow, 'threadId'>,
  state: Pick<ChatState, 'activeThreadId' | 'sideConversations'>,
  doc: Pick<Document, 'visibilityState'> & { hasFocus(): boolean }
): boolean {
  if (doc.visibilityState !== 'visible' || !doc.hasFocus()) return false
  return (
    state.activeThreadId === row.threadId ||
    Boolean(state.sideConversations?.[row.threadId])
  )
}

export type ActivityNotificationDeps = {
  getChatState(): Pick<ChatState, 'activeThreadId' | 'sideConversations'>
  notify(payload: {
    threadId?: string
    source: 'main-agent' | 'subagent'
    category: AdeActivityNotificationCategory
    title: string
    body: string
  }): void
  notificationsEnabled(category: AdeActivityNotificationCategory): Promise<boolean>
}

const notifiedTransitionKeys = new Set<string>()

function rememberTransitionKey(key: string): boolean {
  if (notifiedTransitionKeys.has(key)) return false
  notifiedTransitionKeys.add(key)
  while (notifiedTransitionKeys.size > ADE_NOTIFICATION_DEDUPE_LIMIT) {
    const oldest = notifiedTransitionKeys.values().next().value
    if (oldest === undefined) break
    notifiedTransitionKeys.delete(oldest)
  }
  return true
}

/** Test seam: clears the once-per-transition registry. */
export function resetActivityNotificationDedupe(): void {
  notifiedTransitionKeys.clear()
}

async function maybeNotifyTransition(
  row: ActivityRow,
  prev: ActivityRow | undefined,
  deps: ActivityNotificationDeps
): Promise<void> {
  const category = activityNotificationCategory(row, prev)
  if (!category) return
  // Consume the key before any gate: a transition the user watched live (or
  // chose to silence) must not fire later just because the row lingers.
  if (!rememberTransitionKey(activityNotificationDedupeKey(row, category))) return
  const doc = typeof document === 'undefined' ? undefined : document
  if (doc && activityRowCurrentlyVisible(row, deps.getChatState(), doc)) return
  if (!(await deps.notificationsEnabled(category))) return
  deps.notify({
    threadId: row.threadId,
    source: row.kind === 'worker' ? 'subagent' : 'main-agent',
    category,
    title: i18n.t(`common:adeNotify.${category}Title`),
    body: i18n.t(`common:adeNotify.${category}Body`, { title: row.title })
  })
}

function defaultDeps(): ActivityNotificationDeps {
  return {
    getChatState: () => useChatStore.getState(),
    notify: (payload) => {
      if (typeof window.kunGui?.showTurnCompleteNotification !== 'function') return
      void window.kunGui.showTurnCompleteNotification(payload).then((result) => {
        if (result.ok || typeof window.kunGui?.logError !== 'function') return
        void window.kunGui.logError('notification', 'ADE activity notification failed', {
          message: result.message,
          threadId: payload.threadId
        }).catch(() => undefined)
      }).catch((error: unknown) => {
        void window.kunGui?.logError?.('notification', 'ADE activity notification failed', {
          message: error instanceof Error ? error.message : String(error),
          threadId: payload.threadId
        }).catch(() => undefined)
      })
    },
    notificationsEnabled: async (category) => {
      try {
        const settings = await rendererRuntimeClient.getSettings()
        return settings.agents.kun.ade.notifications[category] !== false
      } catch {
        return true
      }
    }
  }
}

let unsubscribe: (() => void) | null = null

/**
 * Subscribe to ActivityStore row changes and emit OS notifications on
 * transitions to waiting/failed/done/stalled (12 §notifications). Badge count
 * is synced on every change so the Dock number always reads needs-you +
 * unread. Idempotent: a second start is a no-op.
 */
export function startActivityNotifications(deps: ActivityNotificationDeps = defaultDeps()): void {
  if (unsubscribe) return
  let prevRows = useActivityStore.getState().rows
  unsubscribe = useActivityStore.subscribe((state) => {
    const nextRows = state.rows
    if (nextRows === prevRows) return
    for (const row of Object.values(nextRows)) {
      const prev = prevRows[row.unitId]
      if (row !== prev) void maybeNotifyTransition(row, prev, deps)
    }
    prevRows = nextRows
    syncAppBadgeCount(useChatStore.getState().unreadThreadIds, nextRows)
  })
}

export function stopActivityNotifications(): void {
  unsubscribe?.()
  unsubscribe = null
}
