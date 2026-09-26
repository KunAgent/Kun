import type { NormalizedThread } from '../../agent/types'
import {
  sidebarThreadActivity,
  type SidebarThreadActivity,
  type SidebarThreadActivityContext
} from '../../components/chat/sidebar-project-selectors'
import type { MobileThreadActivity } from '../screens/MobileHome'

export type MobileThreadActivityKind = Exclude<SidebarThreadActivity, 'read'>

/** i18n key (common namespace) for each non-idle activity kind. */
export const MOBILE_ACTIVITY_I18N_KEY: Record<MobileThreadActivityKind, string> = {
  'awaiting-input': 'attentionStatusAwaitingInput',
  failed: 'attentionStatusFailed',
  unread: 'attentionStatusUnread',
  running: 'attentionStatusRunning',
  scheduled: 'attentionStatusScheduled'
}

/** Worst-first order used when a project row aggregates several threads. */
const ACTIVITY_PRIORITY: MobileThreadActivityKind[] = [
  'awaiting-input', 'running', 'failed', 'unread', 'scheduled'
]

export function mobileThreadActivity(
  thread: NormalizedThread,
  context: SidebarThreadActivityContext,
  t: (key: string) => string
): MobileThreadActivity | null {
  const kind = sidebarThreadActivity(thread, context)
  if (kind === 'read') return null
  return { kind, label: t(MOBILE_ACTIVITY_I18N_KEY[kind]) }
}

export function aggregateThreadActivity(
  threads: readonly NormalizedThread[],
  context: SidebarThreadActivityContext,
  t: (key: string) => string
): MobileThreadActivity | null {
  const kinds = new Set<MobileThreadActivityKind>()
  for (const thread of threads) {
    const kind = sidebarThreadActivity(thread, context)
    if (kind !== 'read') kinds.add(kind)
  }
  const kind = ACTIVITY_PRIORITY.find((candidate) => kinds.has(candidate))
  return kind ? { kind, label: t(MOBILE_ACTIVITY_I18N_KEY[kind]) } : null
}
