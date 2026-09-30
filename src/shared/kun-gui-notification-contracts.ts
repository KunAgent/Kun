export type TurnCompleteNotificationSource = 'main-agent' | 'subagent'

/** ADE activity-transition categories (docs/ade/12 §notifications, impl P1-23). */
export type AdeActivityNotificationCategory = 'waiting' | 'failed' | 'done' | 'stalled'

export type TurnCompleteNotificationPayload = {
  /** Stable delivery identity; Main persists successful/suppressed receipts. */
  dedupeKey?: string
  roomId?: string
  threadId?: string
  source: TurnCompleteNotificationSource
  /** Present on ADE activity-driven notifications; absent on legacy payloads. */
  category?: AdeActivityNotificationCategory
  title: string
  body: string
}

export type SystemNotificationResult =
  | { ok: true; shown: boolean; reason?: string }
  | { ok: false; message: string }
