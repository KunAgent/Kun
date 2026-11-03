import type { ChatBlock, ToolBlock } from '../../agent/types'
import type { TaskSuggestionTaskView, TaskSuggestionView } from '@shared/task-suggestions'

export function isTaskSuggestionBlock(block: ChatBlock): block is ToolBlock & { meta: Record<string, unknown> & { taskSuggestionId: string } } {
  return block.kind === 'tool' && typeof block.meta?.taskSuggestionId === 'string'
}

/** What one row shows; `waiting` is a running row whose session needs the user. */
export type TaskRowPhase = TaskSuggestionTaskView['state'] | 'waiting'

export function taskRowPhase(task: TaskSuggestionTaskView, awaitingThreadIds: Readonly<Record<string, true>>): TaskRowPhase {
  if (task.state === 'running' && task.threadId && awaitingThreadIds[task.threadId]) return 'waiting'
  return task.state
}

export type TaskCardCounts = {
  total: number
  suggested: number
  started: number
  live: number
  done: number
  failed: number
  startFailed: number
  ignored: number
}

export function taskCardCounts(card: TaskSuggestionView): TaskCardCounts {
  const count = (states: readonly TaskSuggestionTaskView['state'][]) =>
    card.tasks.filter((task) => states.includes(task.state)).length
  return {
    total: card.tasks.length,
    suggested: count(['suggested']),
    started: count(['starting', 'running', 'done', 'failed', 'cancelled']),
    live: count(['starting', 'running']),
    done: count(['done']),
    failed: count(['failed', 'cancelled']),
    startFailed: count(['start_failed']),
    ignored: count(['ignored', 'here'])
  }
}

/** Remaining no-response time of a countdown card, or null. */
export function taskCardCountdown(card: TaskSuggestionView, nowMs: number): { remainingMs: number; fraction: number } | null {
  if (card.state !== 'countdown' || !card.deadline) return null
  const end = Date.parse(card.deadline)
  const start = Date.parse(card.updatedAt)
  const remainingMs = Math.max(0, end - nowMs)
  const span = Math.max(1, end - start)
  return { remainingMs, fraction: Math.min(1, remainingMs / span) }
}

export function formatClock(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Rows the card may still edit or start from: suggested, or failed to start. */
export const taskRowEditable = (task: TaskSuggestionTaskView): boolean =>
  task.state === 'suggested' || task.state === 'start_failed'

export type BriefLabels = { goal: string; scope: string; done: string }

/** Plain-text brief for "continue here" and "copy brief". */
export function taskBriefPlainText(task: TaskSuggestionTaskView, labels: BriefLabels): string {
  const lines = [task.title]
  if (task.area) lines.push(task.area)
  lines.push('', `${labels.goal}:`, task.brief.goal)
  if (task.brief.scope.length) lines.push('', `${labels.scope}:`, ...task.brief.scope.map((entry) => `- ${entry}`))
  if (task.brief.done.length) lines.push('', `${labels.done}:`, ...task.brief.done.map((entry) => `- ${entry}`))
  return lines.join('\n')
}

/** Settled task results not yet dismissed in the suggesting conversation. */
export function pendingTaskReports(cards: readonly TaskSuggestionView[]): { card: TaskSuggestionView; task: TaskSuggestionTaskView; index: number }[] {
  return cards.flatMap((card) => card.tasks.flatMap((task, index) =>
    task.result && !task.reportAcknowledged && (task.state === 'done' || task.state === 'failed' || task.state === 'cancelled')
      ? [{ card, task, index }] : []))
    .sort((left, right) => (left.task.settledAt ?? '').localeCompare(right.task.settledAt ?? ''))
}

/** Edits a brief from the editor's three text areas; list fields take one entry per line. */
export function briefFromDraft(draft: { goal: string; scope: string; done: string }): TaskSuggestionTaskView['brief'] | null {
  const goal = draft.goal.trim()
  if (!goal) return null
  const lines = (text: string) => text.split('\n').map((line) => line.replace(/^[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 12)
  return { goal, scope: lines(draft.scope), done: lines(draft.done) }
}

export function minutesSince(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null
  const started = Date.parse(iso)
  return Number.isFinite(started) ? Math.max(0, Math.floor((nowMs - started) / 60_000)) : null
}
