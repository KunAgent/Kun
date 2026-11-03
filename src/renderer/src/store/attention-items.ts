import type { NormalizedThread } from '../agent/types'
import {
  sidebarThreadActivity,
  type SidebarThreadActivity,
  type SidebarThreadActivityContext
} from '../components/chat/sidebar-project-selectors'

/** The three row states that mean "this needs the user's eyes". */
export type AttentionItemKind = 'awaiting-input' | 'failed' | 'unread'

export type AttentionItem = {
  threadId: string
  kind: AttentionItemKind
  title: string
  updatedAt: string
}

const KIND_ORDER: Record<AttentionItemKind, number> = {
  'awaiting-input': 0,
  failed: 1,
  unread: 2
}

const KIND_BY_ACTIVITY: Partial<Record<SidebarThreadActivity, AttentionItemKind>> = {
  'awaiting-input': 'awaiting-input',
  failed: 'failed',
  unread: 'unread'
}

/**
 * The single list behind both the sidebar "needs you" panel and the app badge.
 * A badge number can therefore always be opened from a matching panel row.
 *
 * Rows the sidebar shows as `running` or `scheduled` are deliberately excluded:
 * they are live work, not unread results. The classifier already applies the
 * visibility rule for the open thread's completion attention, so a pending
 * question on the open thread still surfaces here while its unread reply does
 * not.
 */
export function selectAttentionItems(input: {
  threads: readonly NormalizedThread[]
  activityContext: SidebarThreadActivityContext
}): AttentionItem[] {
  const seen = new Set<string>()
  const items: AttentionItem[] = []
  for (const thread of input.threads) {
    const threadId = thread.id.trim()
    if (!threadId || seen.has(threadId)) continue
    seen.add(threadId)
    if (thread.archived === true) continue
    const kind = KIND_BY_ACTIVITY[sidebarThreadActivity(thread, input.activityContext)]
    if (!kind) continue
    items.push({
      threadId,
      kind,
      title: thread.title?.trim() ?? '',
      updatedAt: thread.updatedAt ?? ''
    })
  }
  return items.sort(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  )
}

export function attentionItemCount(items: readonly AttentionItem[]): number {
  return items.length
}
