import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomRunList } from './RoomRunList'

export function RoomMemberDetails({ room, selectedMemberId, rootRequestId, topics = [], onSelectMember, onRun, onOpenAgent, onAgentDetails }: {
  room: Room; selectedMemberId: string | null; rootRequestId?: string | null
  topics?: Array<{ rootRequestId: string; title: string }>
  onOpenAgent?: (id: string) => void; onAgentDetails?: (id: string) => void
  onSelectMember?: (id: string) => void; onRun?: (id: string) => void
}) {
  const { t } = useTranslation('common')
  const selected = useRef<HTMLElement>(null)
  const [topic, setTopic] = useState(rootRequestId ?? '')
  useEffect(() => setTopic(rootRequestId ?? ''), [rootRequestId, selectedMemberId])
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }) }, [selectedMemberId])
  return <div className="rooms-member-details">
    {room.members.filter((member) => !member.removedAt).map((member) => <article key={member.id}
      ref={member.id === selectedMemberId ? selected : undefined}
      className={`rooms-member-card ${member.id === selectedMemberId ? 'is-selected' : ''}`}>
      <div className="rooms-member-card-heading">
        <RoomAvatar member={member} label={member.displayName} size={38} />
        <div><h3>{member.displayName}</h3><p>{member.agentTitle || t(`rooms${member.role[0].toUpperCase()}${member.role.slice(1)}`)} · {t(member.enabled ? 'roomsEnabled' : 'roomsDisabled')}</p></div>
      </div>
      {member.participantAgentId ? <div className="agent-memory-actions">
        <button type="button" onClick={() => onOpenAgent?.(member.participantAgentId!)}>{t('agentsOpenPrivate')}</button>
        <button type="button" onClick={() => onAgentDetails?.(member.participantAgentId!)}>{t('agentsProfileAndMemory')}</button>
      </div> : null}
      {member.roleNotes ? <p className="rooms-member-notes">{member.roleNotes}</p> : null}
      {member.allowedRepositoryIds?.length ? <p className="rooms-member-repositories">{room.repositories.filter((repo) => member.allowedRepositoryIds.includes(repo.id)).map((repo) => repo.displayName).join(' · ')}</p> : null}
      {onRun && selectedMemberId === member.id ? <>
        <select className="rooms-run-member-select" aria-label={t('roomsRunTopicFilter')} value={topic} onChange={(event) => setTopic(event.target.value)}>
          <option value="">{t('roomsRunAllTopics')}</option>
          {rootRequestId && !topics.some((value) => value.rootRequestId === rootRequestId) ? <option value={rootRequestId}>{t('roomsTopic')} · {rootRequestId}</option> : null}
          {topics.map((value) => <option key={value.rootRequestId} value={value.rootRequestId}>{value.title}</option>)}
        </select>
        <RoomRunList roomId={room.id} memberId={member.id} rootRequestId={topic || undefined} onOpenRun={onRun} />
      </> : onSelectMember ? <button type="button" className="rooms-run-secondary" onClick={() => onSelectMember(member.id)}>{t('roomsRunHistory')}</button> : null}
    </article>)}
  </div>
}
