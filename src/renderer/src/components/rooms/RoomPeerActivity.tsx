import { useTranslation } from 'react-i18next'
import { ChevronRight, MessageCircle, Square } from 'lucide-react'
import type { Room, RoomPeerTopicSummary } from '@shared/rooms-api'
import { roomButtonClass } from './RoomSettings'
import { roomsClient } from './rooms-client'
import { useRoomMutation } from './useRoomResource'
import { RoomAvatar } from './RoomAvatar'

export function continueRoomTopic(roomId: string, rootRequestId: string): void {
  window.dispatchEvent(
    new CustomEvent('kun-room-continue-topic', {
      detail: { roomId, rootRequestId }
    })
  )
}

export function RoomPeerSummary({
  topics,
  loading,
  onOpen,
  onTasks,
  taskCounts
}: {
  topics: RoomPeerTopicSummary[]
  loading: boolean
  onOpen: () => void
  onTasks?: () => void
  taskCounts?: { runningCount?: number; attentionCount?: number }
}) {
  const { t } = useTranslation('common')
  const blockedMember = (member: RoomPeerTopicSummary['members'][number]) =>
    ['failed', 'recovery_required'].includes(member.state) ||
    [
      'member_unavailable',
      'member_budget_exhausted',
      'preparation_failed',
      'response_failed'
    ].includes(member.waitingReason ?? '')
  const activeMembers = topics
    .filter((topic) => topic.status === 'active')
    .flatMap((topic) => topic.members)
    .filter((member) => !blockedMember(member))
  const running = activeMembers.filter((member) =>
    ['responding', 'triaging'].includes(member.state)
  ).length
  const pending = activeMembers.reduce(
    (sum, member) => sum + member.pendingCount,
    0
  )
  const stopping = topics.filter((topic) => topic.status === 'stopping').length
  const blocked = topics
    .filter((topic) => ['active', 'idle'].includes(topic.status))
    .flatMap((topic) => topic.members)
    .filter(blockedMember).length
  const paused = topics.filter((topic) =>
    ['paused', 'stopped'].includes(topic.status)
  ).length
  const summary =
    [
      running || pending ? t('roomsPeerSummary', { running, pending }) : '',
      stopping ? t('roomsPeerStoppingSummary', { count: stopping }) : '',
      blocked ? t('roomsPeerBlockedSummary', { count: blocked }) : ''
    ]
      .filter(Boolean)
      .join(' · ') ||
    (paused
      ? t('roomsPeerPausedSummary', { count: paused })
      : t('roomsPeerQuiet'))
  return (
    <div className="rooms-activity-summary">
      <button
        className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left hover:text-ds-ink"
        onClick={onOpen}
        aria-label={t('roomsDiscussionActivity')}
      >
        <MessageCircle size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {loading ? t('roomsLoading') : summary}
        </span>
        <ChevronRight size={13} aria-hidden="true" />
      </button>
      {onTasks ? (
        <button className="shrink-0 py-2 text-accent" onClick={onTasks}>
          {t('roomsTasks')}
          {(taskCounts?.runningCount ?? 0) > 0
            ? ` · ${taskCounts?.runningCount} ${t('roomsState_running')}`
            : ''}
          {taskCounts?.attentionCount
            ? ` · ${taskCounts.attentionCount} ${t('roomsAttention')}`
            : ''}
        </button>
      ) : null}
    </div>
  )
}

export function RoomPeerActivity({
  room,
  topics,
  loading,
  error,
  nextCursor,
  moreBusy,
  loadMore,
  onUpdated,
  onContinue
}: {
  room: Room
  topics: RoomPeerTopicSummary[]
  loading: boolean
  error: string
  nextCursor: string | null
  moreBusy: boolean
  loadMore: () => Promise<void>
  onUpdated: () => Promise<void>
  onContinue: (rootRequestId: string) => void
}) {
  const { t } = useTranslation('common')
  const mutation = useRoomMutation(onUpdated)
  const memberName = (id: string) =>
    room.members.find((member) => member.id === id)?.displayName ?? id
  return (
    <section
      aria-label={t('roomsDiscussionActivity')}
      className="space-y-3 p-4"
    >
      <p className="text-xs text-ds-muted">{t('roomsDiscussionBoundary')}</p>
      {!topics.length ? (
        <p className="py-4 text-sm text-ds-muted">
          {t(loading ? 'roomsLoading' : 'roomsNoTopics')}
        </p>
      ) : null}
      {topics.map((topic) => (
        <article
          key={topic.rootRequestId}
          className="rooms-topic-card"
        >
          <h3 className="break-words text-sm font-medium text-ds-ink">
            {topic.title}
          </h3>
          <p className="text-xs text-ds-muted">
            {t(`roomsPeerStatus_${topic.status}`)}
          </p>
          {topic.pauseReason ? (
            <p className="break-words text-xs text-amber-600">
              {t(`roomsPeerReason_${topic.pauseReason}`, {
                defaultValue: topic.pauseReason
              })}
            </p>
          ) : null}
          {topic.members.filter((member) => member.error || ['failed', 'recovery_required'].includes(member.state)).map((member) => (
            <p key={member.memberId} className="rooms-topic-attention">
              <strong>{memberName(member.memberId)}</strong> · {member.error || t(`roomsPeerMember_${member.state}`)}
            </p>
          ))}
          <details className="rooms-topic-disclosure">
            <summary>{t('roomsTopicDetails')}</summary>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-ds-muted">{t('roomsResponsesRemaining')}</dt>
              <dd className="mt-1 text-ds-ink">
                {Math.max(0, 32 - topic.responseCount)} / 32
              </dd>
            </div>
            <div>
              <dt className="text-ds-muted">{t('roomsTriageRemaining')}</dt>
              <dd className="mt-1 text-ds-ink">
                {Math.max(0, 128 - topic.triageCount)} / 128
              </dd>
            </div>
          </dl>
          <ul className="space-y-2">
            {topic.members.map((member) => (
              <li
                key={member.memberId}
                className="rounded-lg bg-ds-sidebar p-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-2 break-words font-medium text-ds-ink">
                    <RoomAvatar member={room.members.find((value) => value.id === member.memberId)} id={member.memberId} label={memberName(member.memberId)} size={24} />
                    {memberName(member.memberId)}
                  </span>
                  <span className="text-ds-muted">
                    {t('roomsMemberResponsesRemaining', {
                      count: Math.max(0, 8 - member.responseCount)
                    })}
                  </span>
                </div>
                <p className="mt-1 text-ds-muted">
                  {t(`roomsPeerMember_${member.state}`)}
                  {member.pendingCount
                    ? ` · ${t('roomsPeerPending', { count: member.pendingCount })}`
                    : ''}
                </p>
                {member.invitedByMemberId ? (
                  <p className="mt-1 text-accent">
                    {t('roomsPeerInvitedBy', {
                      member: memberName(member.invitedByMemberId)
                    })}
                  </p>
                ) : null}
                {member.waitingReason ? (
                  <p className="mt-1 break-words text-ds-muted">
                    {t(`roomsPeerReason_${member.waitingReason}`, {
                      defaultValue: member.waitingReason
                    })}
                  </p>
                ) : null}
                {member.error ? (
                  <p className="mt-1 break-words text-red-500">
                    {member.error}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          </details>
          <div className="rooms-topic-actions">
            <button
              className={roomButtonClass}
              disabled={Boolean(room.archivedAt)}
              onClick={() => onContinue(topic.rootRequestId)}
            >
              {t('roomsContinueTopic')}
            </button>
            {['active', 'idle', 'paused'].includes(topic.status) ? (
              <button
                className={`${roomButtonClass} flex items-center gap-1`}
                disabled={mutation.busy || Boolean(room.archivedAt)}
                onClick={() =>
                  void mutation.run(
                    `${topic.rootRequestId}:${topic.revision}:stop`,
                    (id) => roomsClient.stopTopic(topic, id)
                  )
                }
              >
                <Square size={12} />
                {t('roomsStopDiscussion')}
              </button>
            ) : null}
          </div>
        </article>
      ))}
      {nextCursor ? (
        <button
          className={roomButtonClass}
          disabled={moreBusy}
          onClick={() => void loadMore()}
        >
          {t('roomsLoadMore')}
        </button>
      ) : null}
      {error || mutation.error ? (
        <p role="alert" className="text-xs text-red-500">
          {error || mutation.error}
        </p>
      ) : null}
    </section>
  )
}
