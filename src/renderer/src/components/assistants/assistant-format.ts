import type { AssistantTaskStatus } from '@shared/assistant-mailbox'

type RowStatus = AssistantTaskStatus | 'enrolling'

const STATUS_KEYS: Record<RowStatus, string> = {
  sent: 'assistantMailboxStatusSent',
  received: 'assistantMailboxStatusReceived',
  working: 'assistantMailboxStatusWorking',
  done: 'assistantMailboxStatusDone',
  blocked: 'assistantMailboxStatusBlocked',
  failed: 'assistantMailboxStatusFailed',
  cancelled: 'assistantMailboxStatusCancelled',
  enrolling: 'assistantStatusEnrolling'
}

export const assistantStatusKey = (status: RowStatus): string => STATUS_KEYS[status]

/** One coloured word per status; no tinted chips in lists. */
export function assistantStatusTone(status: RowStatus): string {
  if (status === 'done') return 'text-emerald-600 dark:text-emerald-400'
  if (status === 'blocked') return 'text-amber-700 dark:text-amber-400'
  if (status === 'failed') return 'text-ds-danger'
  if (status === 'received' || status === 'working') return 'text-blue-600 dark:text-blue-400'
  return 'text-ds-muted'
}

export const isOpenAssistantTask = (status: AssistantTaskStatus): boolean => !['done', 'failed', 'cancelled'].includes(status)

/** "5 minutes ago" / "in 20 minutes" in the interface language. */
export function relativeTime(iso: string, language: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000)
  const format = new Intl.RelativeTimeFormat(language || 'en', { numeric: 'auto' })
  for (const [unit, size] of [['day', 86_400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(seconds, 'second')
}

/** Checked in within its usual schedule (every 20 minutes, with slack). */
export const recentlySeen = (lastSeenAt: string | null, now = Date.now()): boolean =>
  Boolean(lastSeenAt) && now - Date.parse(lastSeenAt!) < 45 * 60_000

/** First line of a task when it has no title. */
export function taskHeadline(title: string, body: string): string {
  if (title.trim()) return title.trim()
  const line = body.trim().split('\n')[0] ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}
