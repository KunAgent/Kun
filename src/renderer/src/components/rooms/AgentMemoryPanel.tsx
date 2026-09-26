import { AgentMemoryCandidates } from './AgentMemoryCandidates'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MemoryRecord } from '../../../../../kun/src/contracts/memory'
import type { Room } from '@shared/rooms-api'
import { agentPath, useAgentResource } from './agent-client'
import { roomsRequest, roomRequestId } from './rooms-client'
import { RoomMessageBody } from './RoomMessageBody'

type Entry = { memory: MemoryRecord; fingerprint: string }
type Page = { memories: Entry[]; nextCursor?: string; available: boolean }
export function AgentMemoryPanel({ agentId, active, onSource }: {
  agentId: string; active: boolean; onSource: (roomId: string, messageId?: string) => void
}) {
  const { t } = useTranslation('common')
  const [includeDeleted, setDeleted] = useState(false), [cursor, setCursor] = useState<string | undefined>()
  const state = useAgentResource<Page>(agentPath(agentId) + '/memories?include_deleted=' + includeDeleted +
    (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), active)
  const [older, setOlder] = useState<Entry[]>([])
  useEffect(() => { setOlder([]); setCursor(undefined) }, [agentId, includeDeleted])
  const current = state.data?.memories ?? []
  const entries = [...new Map([...older, ...current].map((entry) => [entry.memory.id, entry])).values()]
  return <section className="agent-memory-panel" aria-label={t('agentsMemory')}>
    <p className="rooms-run-note">{t('agentsMemoryBoundary')}</p>
    <AgentMemoryCandidates agentId={agentId} active={active} onUpdated={() => { setOlder([]); setCursor(undefined); state.refresh() }} />
    <label className="agent-checkbox"><input type="checkbox" checked={includeDeleted} onChange={(e) => setDeleted(e.target.checked)} />{t('agentsShowForgotten')}</label>
    {state.data && !state.data.available ? <p className="rooms-run-note">{t('agentsMemoryDisabled')}</p> : null}
    {entries.map((entry) => <AgentMemoryEntry key={entry.memory.id + ':' + entry.fingerprint} agentId={agentId}
      entry={entry} onSource={onSource} onUpdated={() => { setOlder([]); setCursor(undefined); state.refresh() }} />)}
    {state.data?.nextCursor ? <button type="button" className="rooms-run-secondary" onClick={() => {
      setOlder(entries); setCursor(state.data!.nextCursor)
    }}>{t('roomsLoadMore')}</button> : null}
    {state.data && !entries.length ? <p className="rooms-run-note">{t('agentsMemoryEmpty')}</p> : null}
    {state.error ? <p role="alert" className="rooms-run-error">{state.error}</p> : null}
  </section>
}
function AgentMemoryEntry({ agentId, entry, onUpdated, onSource }: {
  agentId: string; entry: Entry; onUpdated: () => void; onSource: (roomId: string, messageId?: string) => void
}) {
  const { t } = useTranslation('common')
  const { memory, fingerprint } = entry, owner = memory.agentContext!
  const [editing, setEditing] = useState(false), [content, setContent] = useState(memory.content)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const pending = useRef<{ hash: string; id: string } | null>(null)
  const mutate = async (patch: Record<string, unknown>) => {
    if (busy) return
    const hash = JSON.stringify(patch)
    if (pending.current?.hash !== hash) pending.current = { hash, id: roomRequestId() }
    setBusy(true); setError('')
    try {
      await roomsRequest(agentPath(agentId) + '/memories/' + encodeURIComponent(memory.id), 'PATCH',
        { ...patch, clientRequestId: pending.current.id, expectedFingerprint: fingerprint })
      pending.current = null; onUpdated()
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <article className="agent-memory-entry">
    {editing ? <textarea aria-label={t('agentsMemoryContent')} value={content} maxLength={4000} rows={5} onChange={(e) => setContent(e.target.value)} />
      : <RoomMessageBody body={memory.content} attachmentIds={[]} />}
    <p className="rooms-run-note">{t(owner.shared ? 'agentsMemoryUniversal' : owner.sourceTaskId ? 'agentsMemoryTaskScoped' : 'agentsMemoryScoped')} · {t(owner.locked ? 'agentsMemoryLocked' : 'agentsMemoryAutomatic')}</p>
    <details><summary>{t('agentsMemorySources')}</summary>
      {memory.sources.map((source) => {
        const match = source.locator?.match(/^room:([A-Za-z0-9_-]+)\/message:([A-Za-z0-9_-]+)$/)
        return <div key={source.id}><p>{source.excerpt}</p>{match ? <button type="button" onClick={() => onSource(match[1], match[2])}>{t('agentsOpenSource')}</button> : <span>{source.locator}</span>}</div>
      })}
    </details>
    {memory.supersededAt ? <p className="rooms-run-note">{t('agentsMemorySuperseded')}</p> : null}
    {!memory.deletedAt ? <div className="agent-memory-actions">
      <button type="button" disabled={busy} onClick={() => editing ? void mutate({ content }) : setEditing(true)}>{t(editing ? 'agentsSave' : 'agentsCorrect')}</button>
      <button type="button" disabled={busy} onClick={() => void mutate({ locked: !owner.locked })}>{t(owner.locked ? 'agentsUnlock' : 'agentsLock')}</button>
      <button type="button" disabled={busy} onClick={() => void mutate({ disabled: !memory.disabledAt })}>{t(memory.disabledAt ? 'agentsRestore' : 'agentsDisable')}</button>
      <button type="button" disabled={busy} onClick={() => setSharing(!sharing)}>{t('agentsShareMemory')}</button>
      <button type="button" disabled={busy} onClick={() => void mutate({ forget: true })}>{t('agentsForget')}</button>
    </div> : <p className="rooms-run-note">{t('agentsForgotten')}</p>}
    {sharing ? <AgentMemorySharing agentId={agentId} memory={memory} busy={busy} onSave={mutate} /> : null}
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
  </article>
}
function AgentMemorySharing({ agentId, memory, busy, onSave }: {
  agentId: string; memory: MemoryRecord; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const { t } = useTranslation('common'), owner = memory.agentContext!
  const [shared, setShared] = useState(owner.shared)
  const [ids, setIds] = useState(owner.sharedConversationIds), [projects, setProjects] = useState(owner.sharedProjectRoots)
  const [cursor, setCursor] = useState<string | undefined>(), [older, setOlder] = useState<Room[]>([])
  const state = useAgentResource<{ conversations: Room[]; nextCursor?: string }>(agentPath(agentId) + '/conversations' +
    (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''))
  const conversations = [...new Map([...older, ...(state.data?.conversations ?? [])].map((room) => [room.id, room])).values()]
  const repositories = [...new Map(conversations.flatMap((room) => room.repositories).map((repo) => [repo.canonicalRoot, repo])).values()]
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
  return <fieldset className="agent-memory-sharing"><legend>{t('agentsShareMemory')}</legend>
    <p className="rooms-run-note">{t('agentsShareMemoryHint')}</p>
    {memory.type === 'preference' ? <label className="agent-checkbox"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />{t('agentsMemoryUniversal')}</label> : null}
    {conversations.map((room) => <label className="agent-checkbox" key={room.id}><input type="checkbox" checked={ids.includes(room.id)} onChange={() => setIds(toggle(ids, room.id))} />{room.name}</label>)}
    {repositories.map((repo) => <label className="agent-checkbox" key={repo.canonicalRoot}><input type="checkbox" checked={projects.includes(repo.canonicalRoot)} onChange={() => setProjects(toggle(projects, repo.canonicalRoot))} />{t('agentsProjectMemory', { name: repo.displayName })}</label>)}
    {state.data?.nextCursor ? <button type="button" onClick={() => { setOlder(conversations); setCursor(state.data!.nextCursor) }}>{t('roomsLoadMore')}</button> : null}
    <button type="button" disabled={busy} onClick={() => void onSave({ shared, sharedConversationIds: ids, sharedProjectRoots: projects })}>{t('agentsSave')}</button>
  </fieldset>
}
