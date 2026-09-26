import { createHash } from 'node:crypto'

/** Retries reuse a thread, but every attempt owns its own public message. */
export function roomDiscussionMessageId(threadId: string, attempt = 0): string {
  const base = 'reply-' + threadId
  if (attempt === 0) return base
  const suffix = '-attempt-' + attempt
  if (base.length + suffix.length <= 128) return base + suffix
  // New messages have explicit originRunId; long thread names need not be reversible.
  return 'reply-' + createHash('sha256').update(threadId).digest('hex') + suffix
}

/** Suffix-like member names are legal: callers must verify every candidate using durable evidence. */
export function roomDiscussionMessageThreads(messageId: string): string[] {
  if (!messageId.startsWith('reply-')) return []
  const raw = messageId.slice('reply-'.length)
  const retried = raw.replace(/-attempt-[1-9]\d*$/, '')
  return [...new Set([raw, retried])]
}

/** Pre-upgrade retries overwrote one unsuffixed message; preserve that recorded history. */
export function roomDiscussionSourceId(discussion: { threadId: string; messageId?: string }): string {
  return discussion.messageId ?? roomDiscussionMessageId(discussion.threadId)
}
