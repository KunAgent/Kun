import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3 } from 'lucide-react'
import type { Room, RoomPoll } from '@shared/rooms-api'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'
import { RoomPopover } from './RoomPopover'

export function RoomPollCard({ room, poll, onUpdate }: { room: Room; poll: RoomPoll; onUpdate: (poll: RoomPoll) => void }) {
  const { t } = useTranslation('common')
  const [selected, setSelected] = useState(poll.ballots['local-user']?.optionIds ?? [])
  const [members, setMembers] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [, tick] = useState(0)
  const pending = useRef<Record<string, { fingerprint: string; id: string }>>({})
  const ballot = poll.ballots['local-user']?.optionIds
  useEffect(() => { setSelected(ballot ?? []) }, [poll.revision, ballot])
  useEffect(() => {
    if (!poll.closesAt || poll.state !== 'open') return
    const remaining = Date.parse(poll.closesAt) - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(() => tick((value) => value + 1), Math.min(remaining + 25, 2_147_483_647))
    return () => clearTimeout(timer)
  }, [poll.closesAt, poll.state])
  const expired = poll.state === 'expired' || Boolean(poll.closesAt && Date.parse(poll.closesAt) <= Date.now())
  const pollOpen = poll.state === 'open' && !expired
  const open = pollOpen && !room.archivedAt
  const voters = Object.keys(poll.ballots).length
  const request = async (action: 'vote' | 'close' | 'invite' | 'discuss', content: Record<string, unknown> = {}) => {
    const fingerprint = JSON.stringify(content)
    if (pending.current[action]?.fingerprint !== fingerprint) pending.current[action] = { fingerprint, id: roomRequestId() }
    setBusy(true); setError('')
    try {
      const result = await roomsRequest<RoomPoll>(`${roomPath(room.id)}/polls/${encodeURIComponent(poll.pollId)}/${action}`,
        action === 'vote' ? 'PUT' : 'POST', { ...content, clientRequestId: pending.current[action].id })
      if (action === 'vote' || action === 'close') onUpdate(result)
      delete pending.current[action]
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <section className="rooms-poll-card" aria-label={poll.question}>
    <div className="rooms-poll-heading"><BarChart3 size={16} /><strong>{poll.question}</strong><span>{t(pollOpen ? poll.multiple ? 'roomsPollMultiple' : 'roomsPollSingle' : expired ? 'roomsPollExpired' : 'roomsPollClosed')}</span></div>
    <div className="rooms-poll-options">{poll.options.map((option) => {
      const count = Object.values(poll.ballots).filter((vote) => vote.optionIds.includes(option.id)).length
      return <label key={option.id} className="rooms-poll-choice">
        <span className="rooms-poll-fill" style={{ width: `${voters ? count / voters * 100 : 0}%` }} />
        <input type={poll.multiple ? 'checkbox' : 'radio'} name={poll.pollId} checked={selected.includes(option.id)} disabled={!open || busy}
          onChange={() => setSelected((value) => poll.multiple ? value.includes(option.id) ? value.filter((id) => id !== option.id) : [...value, option.id] : [option.id])} />
        <span>{option.label}</span><span className="rooms-poll-count">{count}</span>
      </label>
    })}</div>
    <div className="rooms-poll-meta"><span>{t('roomsPollVoters', { count: voters })}</span>{poll.closesAt ? <time dateTime={poll.closesAt}>{new Date(poll.closesAt).toLocaleString()}</time> : null}</div>
    <div className="rooms-poll-actions">
      {open ? <button type="button" disabled={busy || !selected.length || JSON.stringify([...selected].sort()) === JSON.stringify([...(ballot ?? [])].sort())}
        onClick={() => void request('vote', { optionIds: selected })}>{t(ballot?.length ? 'roomsPollChangeVote' : 'roomsPollVote')}</button> : null}
      {open && ballot?.length ? <button type="button" disabled={busy} onClick={() => void request('vote', { optionIds: [] })}>{t('roomsPollWithdrawVote')}</button> : null}
      {open ? <RoomPopover label={t('roomsPollInvite')} trigger={t('roomsPollInvite')} side="top" disabled={busy}>
        {(close) => <div className="rooms-poll-invite"><p>{t('roomsPollInviteHint')}</p>{room.members.filter((member) => member.enabled && !member.removedAt).map((member) =>
          <label key={member.id}><input type="checkbox" checked={members.includes(member.id)} onChange={(event) => setMembers((value) => event.target.checked ? [...value, member.id] : value.filter((id) => id !== member.id))} />{member.displayName}</label>)}
          <button type="button" disabled={!members.length || busy} onClick={() => { close(); void request('invite', { memberIds: members }) }}>{t('roomsPollInvite')}</button></div>}
      </RoomPopover> : null}
      <button type="button" disabled={busy || Boolean(room.archivedAt)} onClick={() => void request('discuss')}>{t('roomsPollDiscussResults')}</button>
      {open ? <button type="button" disabled={busy} onClick={() => void request('close')}>{t('roomsPollClose')}</button> : null}
    </div>
    {error ? <p role="alert" className="rooms-interaction-error">{error}</p> : null}
  </section>
}
