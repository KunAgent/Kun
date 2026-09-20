export type TurnCompleteNotificationSource = 'main-agent' | 'subagent'

export type TurnCompleteNotificationPayload = {
  roomId?: string
  threadId?: string
  source: TurnCompleteNotificationSource
  title: string
  body: string
}

export type SystemNotificationResult =
  | { ok: true; shown: boolean; reason?: string }
  | { ok: false; message: string }
