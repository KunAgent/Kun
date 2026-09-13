import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'

export function RoomMemberDetails({ room, selectedMemberId }: { room: Room; selectedMemberId: string | null }) {
  const { t } = useTranslation('common')
  const selected = useRef<HTMLElement>(null)
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }) }, [selectedMemberId])
  return <div className="rooms-member-details">
    {room.members.filter((member) => !member.removedAt).map((member) => <article key={member.id}
      ref={member.id === selectedMemberId ? selected : undefined}
      className={`rooms-member-card ${member.id === selectedMemberId ? 'is-selected' : ''}`}>
      <div className="rooms-member-card-heading">
        <RoomAvatar member={member} label={member.displayName} size={38} />
        <div><h3>{member.displayName}</h3><p>{t(`rooms${member.role[0].toUpperCase()}${member.role.slice(1)}`)} · {t(member.enabled ? 'roomsEnabled' : 'roomsDisabled')}</p></div>
      </div>
      {member.roleNotes ? <p className="rooms-member-notes">{member.roleNotes}</p> : null}
      {member.allowedRepositoryIds?.length ? <p className="rooms-member-repositories">{room.repositories.filter((repo) => member.allowedRepositoryIds.includes(repo.id)).map((repo) => repo.displayName).join(' · ')}</p> : null}
    </article>)}
  </div>
}
