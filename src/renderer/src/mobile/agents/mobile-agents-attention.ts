import type { ActivityRow } from '@shared/activity-row'
import type { PendingApprovalItem } from '@shared/ade-approvals'
import type { AdeQuestionRecord, AdeTeamOverview } from '@shared/ade-teams'

/**
 * Mobile "needs your attention" items (P3-19): every activity row whose
 * `waitingReason` blocks work becomes one actionable entry. Approvals and
 * worker questions resolve inline; user-input and terminal prompts open
 * the owning conversation.
 */
export type MobileAttentionItem =
  | { kind: 'approval'; unitId: string; row: ActivityRow; approval: PendingApprovalItem }
  | { kind: 'question'; unitId: string; row: ActivityRow; question: AdeQuestionRecord }
  | { kind: 'wait'; unitId: string; row: ActivityRow; reason: 'approval' | 'user_input' | 'question' | 'terminal_prompt' }

/** Manager thread id that owns a worker row (parent thread or team id). */
export function managerThreadOf(row: ActivityRow): string | null {
  return row.parentThreadId ?? row.teamId ?? null
}

export function openQuestionForWorker(
  overview: AdeTeamOverview | null | undefined,
  workerId: string
): AdeQuestionRecord | null {
  return overview?.questions.find((q) => q.state === 'open' && q.workerId === workerId) ?? null
}

export function buildAttentionItems(input: {
  rows: ActivityRow[]
  /** threadId → pending approvals fetched from GET /v1/approvals. */
  approvals: Record<string, PendingApprovalItem[]>
  /** managerThreadId → team overview (null = not a manager / not found). */
  overviews: Record<string, AdeTeamOverview | null>
}): MobileAttentionItem[] {
  const items: MobileAttentionItem[] = []
  for (const row of input.rows) {
    if (row.visibility === 'archived' || !row.waitingReason) continue
    if (row.waitingReason === 'approval') {
      const pending = input.approvals[row.threadId]
      if (pending === undefined || pending.length === 0) {
        // Still loading or resolved between snapshot and fetch — the row
        // stays tappable and the conversation view shows the live state.
        items.push({ kind: 'wait', unitId: row.unitId, row, reason: 'approval' })
        continue
      }
      for (const approval of pending) {
        items.push({ kind: 'approval', unitId: `${row.unitId}:${approval.approvalId}`, row, approval })
      }
      continue
    }
    if (row.waitingReason === 'question') {
      const manager = managerThreadOf(row)
      const overview = manager ? input.overviews[manager] : undefined
      const question = overview === undefined ? null : openQuestionForWorker(overview, row.threadId)
      items.push(question
        ? { kind: 'question', unitId: `${row.unitId}:${question.questionId}`, row, question }
        : { kind: 'wait', unitId: row.unitId, row, reason: 'question' })
      continue
    }
    items.push({ kind: 'wait', unitId: row.unitId, row, reason: row.waitingReason })
  }
  items.sort((a, b) => Date.parse(b.row.updatedAt) - Date.parse(a.row.updatedAt))
  return items
}
