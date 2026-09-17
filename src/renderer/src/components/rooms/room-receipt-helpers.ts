import type { RoomPeerTopicSummary } from '@shared/rooms-api'

type TopicMember = RoomPeerTopicSummary['members'][number]

/** Members that will not pick up work on their own (mirrors RoomPeerSummary). */
export function roomPeerMemberBlocked(member: TopicMember): boolean {
  return (
    ['failed', 'recovery_required'].includes(member.state) ||
    [
      'member_unavailable',
      'member_budget_exhausted',
      'preparation_failed',
      'response_failed'
    ].includes(member.waitingReason ?? '')
  )
}

/**
 * Members of the currently active topics that are visibly working on a
 * response (responding or deciding whether to join).
 */
export function roomRespondingMemberIds(
  topics: RoomPeerTopicSummary[]
): string[] {
  return topics
    .filter((topic) => topic.status === 'active')
    .flatMap((topic) => topic.members)
    .filter(
      (member) =>
        !roomPeerMemberBlocked(member) &&
        ['responding', 'triaging'].includes(member.state)
    )
    .map((member) => member.memberId)
}

/**
 * Members that have the user's message in their inbox (pending events) but
 * have not started responding yet — the "delivered, waiting for X" state.
 */
export function roomWaitingMemberIds(
  topics: RoomPeerTopicSummary[]
): string[] {
  return topics
    .filter((topic) => topic.status === 'active')
    .flatMap((topic) => topic.members)
    .filter(
      (member) =>
        !roomPeerMemberBlocked(member) &&
        !['responding', 'triaging'].includes(member.state) &&
        (member.pendingCount > 0 || member.state === 'pending')
    )
    .map((member) => member.memberId)
}
