import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomMember } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomMemberModelSelect } from './RoomMemberModelSelect'
import { RoomRunList } from './RoomRunList'
import { roomsClient, type RoomPresetCatalog } from './rooms-client'

export function roomAllowsMemberModelOverride(room: Pick<Room, 'conversationKind'>) {
  return !room.conversationKind || room.conversationKind === 'group'
}

export function RoomMemberDetails({ room, selectedMemberId, rootRequestId, topics = [], onSelectMember, onRun, onOpenAgent, onAgentDetails, onUpdated }: {
  room: Room; selectedMemberId: string | null; rootRequestId?: string | null
  topics?: Array<{ rootRequestId: string; title: string }>
  onOpenAgent?: (id: string) => void; onAgentDetails?: (id: string) => void
  onSelectMember?: (id: string) => void; onRun?: (id: string) => void
  onUpdated?: () => void
}) {
  const { t } = useTranslation('common')
  const selected = useRef<HTMLElement>(null)
  const [topic, setTopic] = useState(rootRequestId ?? '')
  const [catalog, setCatalog] = useState<RoomPresetCatalog>({ presets: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setTopic(rootRequestId ?? ''), [rootRequestId, selectedMemberId])
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }) }, [selectedMemberId])
  useEffect(() => {
    let active = true
    void roomsClient.presets().then((value) => { if (active) setCatalog(value) }).catch(() => undefined)
    return () => { active = false }
  }, [room.id, room.revision])
  const saveModel = async (member: RoomMember, modelRef: RoomMember['modelRef']) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await roomsClient.update(room, {
        members: room.members.map((item) =>
          item.id === member.id ? { ...item, modelRef, revision: item.revision + 1 } : item)
      })
      onUpdated?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      onUpdated?.()
    } finally { setBusy(false) }
  }
  const canEditModel = roomAllowsMemberModelOverride(room)
  return <div className="rooms-member-details">
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
    {room.members.filter((member) => !member.removedAt).map((member) => <article key={member.id}
      ref={member.id === selectedMemberId ? selected : undefined}
      className={`rooms-member-card ${member.id === selectedMemberId ? 'is-selected' : ''}`}>
      <div className="rooms-member-card-heading">
        <RoomAvatar member={member} label={member.displayName} size={38} />
        <div><h3>{member.displayName}</h3><p>{member.agentTitle || t(`rooms${member.role[0].toUpperCase()}${member.role.slice(1)}`)} · {t(member.enabled ? 'roomsEnabled' : 'roomsDisabled')}</p></div>
      </div>
      {canEditModel ? <>
        <RoomMemberModelSelect member={member} catalog={catalog} disabled={busy}
          className="rooms-member-model" selectClassName="rooms-member-model-select"
          onChange={(modelRef) => void saveModel(member, modelRef)} />
        {member.modelRef ? <p className="rooms-member-model-hint">{t('roomsRoomModelOnly')}</p> : null}
      </> : null}
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
