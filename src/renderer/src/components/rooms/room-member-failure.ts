import type { RoomPeerTopicSummary } from '@shared/rooms-api'

type TopicMember = RoomPeerTopicSummary['members'][number]

/**
 * Provider failures arrive as `model request failed with status 403: {json}`.
 * Show the status and the provider's own message instead of the raw body.
 */
export function summarizeRoomMemberError(raw: string): string {
  const status = raw.match(/\bstatus (\d{3})\b/)?.[1]
  const start = raw.indexOf('{')
  let message = ''
  if (start >= 0) {
    try {
      const body = JSON.parse(raw.slice(start)) as { error?: unknown; message?: unknown }
      const value = body.error && typeof body.error === 'object'
        ? (body.error as { message?: unknown }).message
        : body.message ?? body.error
      if (typeof value === 'string') message = value.trim()
    } catch { /* not a JSON body; keep the raw text */ }
  }
  const summary = message ? [status, message].filter(Boolean).join(' · ') : raw.trim()
  return summary.length > 280 ? summary.slice(0, 279) + '…' : summary
}

/**
 * The model a topic member answered with and when its state last changed. A
 * topic keeps the routes frozen when it started, so an old failure names the
 * model it actually used rather than the member's current choice.
 */
export function roomMemberFailureContext(topic: Pick<RoomPeerTopicSummary, 'roomSnapshot'>,
  member: Pick<TopicMember, 'memberId' | 'updatedAt'>): string {
  const frozen = topic.roomSnapshot?.members.find((value) => value.id === member.memberId)
  const model = frozen?.modelRef?.model ?? frozen?.executor?.model
  const at = member.updatedAt ? new Date(member.updatedAt) : undefined
  const time = at && !Number.isNaN(at.getTime())
    ? at.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
  return [model, time].filter(Boolean).join(' · ')
}
