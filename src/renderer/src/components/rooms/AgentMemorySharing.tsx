import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MemoryRecord } from '../../../../../kun/src/contracts/memory'
import type { Room } from '@shared/rooms-api'
import { agentPath, useAgentResource } from './agent-client'

export function AgentMemorySharing({ agentId, memory, busy, onSave }: {
  agentId: string; memory: MemoryRecord; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<boolean>
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
