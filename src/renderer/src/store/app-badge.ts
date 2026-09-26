import type { ActivityRow } from '@shared/activity-row'
import { MAX_APP_BADGE_COUNT } from '@shared/kun-gui-api'
import { selectNeedsYouCount } from './activity-selectors'
import {
  persistUnreadCompletions,
  unreadCompletionCount
} from './unread-completions'
import type { CompletionAttentionRegistry } from './chat-store-types'

/**
 * Single app-badge formula (12 §notifications): ordinary unread turn
 * completions plus ADE "needs you" activity rows. Both call sites funnel
 * here so whichever store changed last still writes the same total.
 */
export function syncAppBadgeCount(
  unread: CompletionAttentionRegistry,
  rows: Record<string, ActivityRow>
): void {
  const normalized = persistUnreadCompletions(unread)
  const count = Math.min(
    unreadCompletionCount(normalized) + selectNeedsYouCount(rows),
    MAX_APP_BADGE_COUNT
  )
  if (typeof window === 'undefined') return
  if (typeof window.kunGui?.setAppBadgeCount !== 'function') return
  void window.kunGui.setAppBadgeCount(count).catch((error: unknown) => {
    void window.kunGui?.logError?.('app-badge', 'Failed to update app badge', {
      message: error instanceof Error ? error.message : String(error),
      count
    }).catch(() => undefined)
  })
}
