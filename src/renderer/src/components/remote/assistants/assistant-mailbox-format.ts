import type { AssistantKind, AssistantTaskStatus } from '@shared/assistant-mailbox'

const KIND_KEYS: Record<AssistantKind, string> = {
  cue: 'assistantMailboxKindCue',
  grok_bot: 'assistantMailboxKindGrokBot',
  muse: 'assistantMailboxKindMuse',
  dots: 'assistantMailboxKindDots',
  other: 'assistantMailboxKindOther'
}

const STATUS_KEYS: Record<AssistantTaskStatus, string> = {
  sent: 'assistantMailboxStatusSent',
  received: 'assistantMailboxStatusReceived',
  working: 'assistantMailboxStatusWorking',
  done: 'assistantMailboxStatusDone',
  blocked: 'assistantMailboxStatusBlocked',
  failed: 'assistantMailboxStatusFailed',
  cancelled: 'assistantMailboxStatusCancelled'
}

/** Short names used inside prompts and default assistant names. */
const KIND_SHORT: Record<AssistantKind, string> = { cue: 'Cue', grok_bot: 'Grok Bot', muse: 'Muse', dots: 'dots', other: 'Assistant' }

export const assistantKindKey = (kind: AssistantKind): string => KIND_KEYS[kind]
export const assistantStatusKey = (status: AssistantTaskStatus): string => STATUS_KEYS[status]
export const assistantKindShortName = (kind: AssistantKind): string => KIND_SHORT[kind]

export function assistantStatusTone(status: AssistantTaskStatus): string {
  if (status === 'done') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  if (status === 'blocked') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  if (status === 'failed') return 'bg-ds-danger-soft text-ds-danger'
  if (status === 'cancelled') return 'bg-ds-subtle text-ds-faint'
  return 'bg-accent-soft text-accent'
}

export const isOpenAssistantTask = (status: AssistantTaskStatus): boolean =>
  !['done', 'failed', 'cancelled'].includes(status)

/** "5 minutes ago" / "in 20 minutes" in the interface language. */
export function relativeTime(iso: string, language: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000)
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['day', 86_400], ['hour', 3600], ['minute', 60]]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(seconds, 'second')
}

/** An assistant that checked in within its usual schedule (20 minutes, with slack). */
export function recentlySeen(lastSeenAt: string | null, now = Date.now()): boolean {
  return Boolean(lastSeenAt) && now - Date.parse(lastSeenAt!) < 45 * 60_000
}

/** First line of a task when it has no title. */
export function taskHeadline(title: string, body: string): string {
  if (title.trim()) return title.trim()
  const line = body.trim().split('\n')[0] ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}
