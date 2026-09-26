import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentHandoff, AgentIdentity, Room, RoomMessage } from '@shared/rooms-api'
import { AgentPicker } from './AgentPicker'
import { useAgentResource } from './agent-client'
import { roomsRequest, roomRequestId } from './rooms-client'
import { RoomMessageBody } from './RoomMessageBody'

type Summary = Pick<AgentHandoff, 'id' | 'sourceRoomId' | 'sourceRootRequestId' | 'pairRoomId' | 'parentHandoffId' |
  'senderAgentId' | 'recipientAgentId' | 'status' | 'runId' | 'phase' | 'attempt' | 'waitingReason' | 'error' | 'createdAt'> &
  { revision: number; recipientName: string }
type Page = { handoffs: Summary[]; nextCursor?: string }
export function AgentHandoffPanel({ room, messages, topics, active, selectedId, onOpenPair, onSource, onRun }: {
  room: Room; messages: RoomMessage[]; topics: Array<{ rootRequestId: string; title: string }>; active: boolean;
  selectedId?: string; onOpenPair: (id: string) => void; onSource: (id: string) => void;
  onRun: (roomId: string, runId: string) => void
}) {
  const { t } = useTranslation('common')
  const pair = room.conversationKind === 'agent_agent'
  const [cursor, setCursor] = useState<string | undefined>(), [older, setOlder] = useState<Summary[]>([])
  const [rootFilter, setRootFilter] = useState('')
  const resource = useAgentResource<Page>('/v1/agent-handoffs?' + (pair ? 'pair_room_id=' : 'source_room_id=') + encodeURIComponent(room.id) +
    (rootFilter ? '&root_request_id=' + encodeURIComponent(rootFilter) : '') + (cursor ? '&cursor=' + cursor : ''), active)
  const [detailId, setDetailId] = useState(selectedId)
  const detail = useAgentResource<{ handoff: AgentHandoff; revision: number }>(detailId ? '/v1/agent-handoffs/' + encodeURIComponent(detailId) : null, active)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const pending = useRef<{ key: string; id: string } | null>(null)
  const entries = [...new Map([...older, ...(resource.data?.handoffs ?? [])].map((value) => [value.id, value])).values()]
  const act = async (entry: Summary, action: 'cancel' | 'retry') => {
    if (busy) return
    const key = entry.id + ':' + entry.revision + ':' + action
    if (pending.current?.key !== key) pending.current = { key, id: roomRequestId() }
    setBusy(true); setError('')
    try {
      await roomsRequest('/v1/agent-handoffs/' + encodeURIComponent(entry.id) + '/' + action, 'POST',
        { clientRequestId: pending.current.id, expectedRevision: entry.revision })
      pending.current = null; resource.refresh(); detail.refresh()
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <section className="agent-handoff-panel" aria-label={t('agentsHandoffs')}>
    <p className="rooms-run-note">{t('agentsHandoffBoundary')}</p>
    {!pair ? <AgentHandoffForm room={room} messages={messages} topics={topics} onCreated={(id) => { setDetailId(id); resource.refresh() }} /> : null}
    <label>{t('roomsRunTopicFilter')}<select aria-label={t('roomsRunTopicFilter')} value={rootFilter} onChange={(e) => {
      setRootFilter(e.target.value); setOlder([]); setCursor(undefined)
    }}><option value="">{t('roomsRunAllTopics')}</option>
      {[...new Set(entries.map((entry) => entry.sourceRootRequestId))].map((id) => <option key={id} value={id}>
        {topics.find((topic) => topic.rootRequestId === id)?.title ?? t('agentsHandoffTopic', { id: id.slice(0, 8) })}
      </option>)}</select></label>
    {entries.map((entry) => <article key={entry.id} className="agent-memory-entry">
      <button type="button" onClick={() => setDetailId(entry.id)}><strong>{entry.recipientName}</strong> · {t('agentsHandoffStatus_' + entry.status)}</button>
      {entry.parentHandoffId ? <p className="rooms-run-note">{t('agentsNestedHandoff')}</p> : null}
      {entry.waitingReason ? <p className="rooms-run-note">{t('agentsHandoffWait_' + entry.waitingReason, { defaultValue: entry.waitingReason })}</p> : null}
      <div className="agent-memory-actions">
        <button type="button" onClick={() => onOpenPair(entry.pairRoomId)}>{t('agentsOpenPair')}</button>
        <button type="button" onClick={() => onSource(entry.sourceRoomId)}>{t('agentsOpenHandoffSource')}</button>
        {entry.runId ? <button type="button" onClick={() => onRun(entry.pairRoomId, entry.runId!)}>{t('roomsViewRun')}</button> : null}
        {['queued', 'running', 'waiting', 'recovery_required'].includes(entry.status) ? <button type="button" disabled={busy} onClick={() => void act(entry, 'cancel')}>{t('agentsCancelHandoff')}</button> : null}
        {entry.phase === 'settled' && ['failed', 'stale', 'cancelled'].includes(entry.status) ? <button type="button" disabled={busy} onClick={() => void act(entry, 'retry')}>{t('agentsRetryHandoff')}</button> : null}
      </div>
      {entry.error ? <p className="rooms-run-error">{entry.error}</p> : null}
    </article>)}
    {detail.data ? <div className="agent-handoff-detail"><h3>{t('agentsHandoffRequest')}</h3>
      <RoomMessageBody body={detail.data.handoff.body} attachmentIds={[]} />
      <details><summary>{t('agentsMemorySources')}</summary>
        {detail.data.handoff.sources.map((source) => <p key={source.id}>{source.author}: {source.body}</p>)}
      </details>
      {detail.data.handoff.result ? <><h3>{t('agentsHandoffResult')}</h3><RoomMessageBody body={detail.data.handoff.result} attachmentIds={[]} /></> : null}
    </div> : null}
    {resource.data?.nextCursor ? <button type="button" onClick={() => { setOlder(entries); setCursor(resource.data!.nextCursor) }}>{t('roomsLoadMore')}</button> : null}
    {resource.data && !entries.length ? <p className="rooms-run-note">{t('agentsNoHandoffs')}</p> : null}
    {error || resource.error || detail.error ? <p role="alert" className="rooms-run-error">{error || resource.error || detail.error}</p> : null}
  </section>
}
function AgentHandoffForm({ room, messages, topics, onCreated }: {
  room: Room; messages: RoomMessage[]; topics: Array<{ rootRequestId: string; title: string }>; onCreated: (id: string) => void
}) {
  const { t } = useTranslation('common')
  const choices = [...new Map([...topics, ...messages.filter((message) => message.authorKind === 'user' && (message.rootRequestId || message.sourceRequestId))
    .map((message) => ({ rootRequestId: message.rootRequestId ?? message.sourceRequestId!, title: message.body.slice(0, 120) }))]
    .map((topic) => [topic.rootRequestId, topic])).values()]
  const [rootId, setRoot] = useState(choices[0]?.rootRequestId ?? '')
  const [senderId, setSender] = useState(room.members.find((member) => member.id === room.defaultMemberId)?.participantAgentId ?? '')
  const [recipient, setRecipient] = useState<AgentIdentity | null>(null), [body, setBody] = useState('')
  const [references, setReferences] = useState<string[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const pending = useRef<{ hash: string; id: string } | null>(null)
  const submit = async () => {
    if (!recipient || !senderId || !rootId || busy) return
    const input = { sourceRoomId: room.id, sourceRootRequestId: rootId, senderAgentId: senderId,
      recipientAgentId: recipient.id, body, sourceMessageIds: references }
    const hash = JSON.stringify(input)
    if (pending.current?.hash !== hash) pending.current = { hash, id: roomRequestId() }
    setBusy(true); setError('')
    try {
      const result = await roomsRequest<{ handoff: AgentHandoff }>('/v1/agent-handoffs', 'POST', { ...input, clientRequestId: pending.current.id })
      pending.current = null; setBody(''); onCreated(result.handoff.id)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <details className="agent-handoff-create"><summary>{t('agentsRequestHelp')}</summary>
    <form className="agent-profile-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit() }}>
      <label>{t('agentsHandoffSourceTopic')}<select required value={rootId} aria-label={t('agentsHandoffSourceTopic')} onChange={(e) => { setRoot(e.target.value); setReferences([]) }}>
        <option value="">{t('agentsChooseTopic')}</option>{choices.map((topic) => <option key={topic.rootRequestId} value={topic.rootRequestId}>{topic.title}</option>)}
      </select></label>
      <label>{t('agentsHandoffSender')}<select value={senderId} aria-label={t('agentsHandoffSender')} onChange={(e) => setSender(e.target.value)}>
        {room.members.filter((member) => member.participantAgentId && member.enabled && !member.removedAt).map((member) =>
          <option key={member.id} value={member.participantAgentId}>{member.displayName}</option>)}
      </select></label>
      <AgentPicker label={recipient?.name ?? t('agentsChooseHelper')} excluded={[senderId]} onSelect={setRecipient} />
      <label>{t('agentsHandoffRequest')}<textarea required maxLength={8000} rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <fieldset><legend>{t('agentsHandoffShareSources')}</legend>
        {messages.filter((message) => message.rootRequestId === rootId && message.status === 'final').slice(-8).map((message) =>
          <label className="agent-checkbox" key={message.id}><input type="checkbox" checked={references.includes(message.id)} onChange={() => setReferences((old) =>
            old.includes(message.id) ? old.filter((id) => id !== message.id) : [...old, message.id])} />{message.authorLabelSnapshot}: {message.body.slice(0, 110)}</label>)}
      </fieldset>
      <button className="rooms-run-primary" type="submit" disabled={busy || !recipient || !rootId || !senderId || !body.trim()}>{t('agentsSendHandoff')}</button>
      {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
    </form>
  </details>
}
