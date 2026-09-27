import type { TFunction } from 'i18next'
import type { AgentDirectActivity, Room } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import './rooms-experience.css'

type DirectData = Pick<AgentDirectActivity, 'active' | 'approvals' | 'userInputs'> | null | undefined

export function directActivityLabelKey(data: DirectData, awaiting: boolean): string | null {
  const active = data?.active
  if (!active) return awaiting ? 'directQueued' : null
  if (data.approvals.length) return 'roomsState_needs_approval'
  if (data.userInputs.length) return 'roomsState_needs_input'
  if (active.status === 'pending') return 'directQueued'
  if (active.status === 'recovery_required') return 'directReconciling'
  if (active.status === 'stopping') return 'directStopping'
  if (active.steer) return 'directSteered'
  return 'directResponding'
}

export function groupActivity(room: Room, typingIds: string[], waitingIds: string[], awaiting: boolean, t: TFunction):
  { memberId?: string; label: string } | null {
  const name = (id: string) => room.members.find((member) => member.id === id)?.displayName ?? id
  if (typingIds.length) {
    const names = typingIds.slice(0, 2).map(name).join(t('roomsTyping_sep'))
    const more = typingIds.length > 2 ? t('roomsTyping_and') + t('roomsTyping_nMore', { count: typingIds.length - 2 }) : ''
    return { memberId: typingIds[0], label: names + more + t('roomsTyping_is') }
  }
  if (!awaiting) return null
  if (waitingIds.length) return { memberId: waitingIds[0], label: t('roomsReceipt_waiting', {
    name: waitingIds.slice(0, 2).map(name).join(t('roomsTyping_sep')), count: waitingIds.length }) }
  return { label: t('roomsReceipt_fallback') }
}

/** Transient IM row, separate from persisted RoomMessage records. */
export function RoomAgentActivity({ room, memberId, label }: { room: Room; memberId?: string; label: string }) {
  const member = room.members.find((item) => item.id === memberId)
    ?? room.members.find((item) => !item.removedAt && item.participantAgentId) ?? room.members[0]
  return <div className="rooms-agent-activity rooms-message-row rooms-message-member">
    <RoomAvatar member={member} id={member?.id ?? 'agent'} label={member?.displayName ?? ''} />
    <div className="rooms-message-content">
      <div className="rooms-agent-activity-body" role="status" aria-live="polite">
        <span className="rooms-typing-dots" aria-hidden="true">
          <span className="rooms-typing-dot" /><span className="rooms-typing-dot" /><span className="rooms-typing-dot" />
        </span>
        <span>{label}</span>
      </div>
    </div>
  </div>
}
