import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CoreMemoryHistoryJson } from '../../agent/kun-contract'
import type { MemoryRecord } from '../../../../../kun/src/contracts/memory'
import { agentPath } from './agent-client'
import { roomsRequest, roomRequestId } from './rooms-client'
import { RoomMessageBody } from './RoomMessageBody'
import { AgentMemorySharing } from './AgentMemorySharing'
import { MemoryEvidence } from '../memory/MemoryEvidence'
import { MemoryHistory } from '../memory/MemoryHistory'
import { MemoryDestructiveConfirmation } from '../memory/MemoryDestructiveConfirmation'

export type AgentMemoryListEntry = { memory: MemoryRecord; fingerprint: string }
export function AgentMemoryEntry({ agentId, entry, onUpdated, onSource, historyOnly = false }: {
  agentId: string; entry: AgentMemoryListEntry; onUpdated: () => void
  onSource?: (roomId: string, messageId?: string) => void; historyOnly?: boolean
}) {
  const { t } = useTranslation('common')
  const { memory, fingerprint } = entry, owner = memory.agentContext!
  const [editing, setEditing] = useState(false), [content, setContent] = useState(memory.content)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [confirmation, setConfirmation] = useState<'forget' | 'erase' | null>(null)
  const pending = useRef<{ hash: string; id: string } | null>(null)
  // Ref locks the same event-loop tick as well as clicks after a React render.
  const inFlight = useRef(false)
  const mutate = async (patch: Record<string, unknown>): Promise<boolean> => {
    if (inFlight.current) return false
    const hash = JSON.stringify(patch)
    if (pending.current?.hash !== hash) pending.current = { hash, id: roomRequestId() }
    inFlight.current = true; setBusy(true); setError('')
    try {
      await roomsRequest(agentPath(agentId) + '/memories/' + encodeURIComponent(memory.id), 'PATCH',
        { ...patch, clientRequestId: pending.current.id, expectedFingerprint: fingerprint })
      pending.current = null; setEditing(false); setSharing(false); setConfirmation(null); onUpdated()
      return true
    } catch (cause) { setError(String(cause)); return false }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <article className="agent-memory-entry" data-memory-id={memory.id}>
    <div className="memory-record-heading"><span>{memory.type}</span><span>{t('memoryRevision', { revision: memory.revision ?? 1 })}</span>
      {memory.disabledAt ? <span>{t('memoryDisabledState')}</span> : null}</div>
    {editing ? <label>{t('agentsMemoryContent')}<textarea aria-label={t('agentsMemoryContent')} value={content} maxLength={4000} rows={5} onChange={(e) => setContent(e.target.value)} /></label>
      : <RoomMessageBody body={memory.content} attachmentIds={[]} collapsible />}
    <p className="rooms-run-note">{t(owner.shared ? 'agentsMemoryUniversal' : owner.sourceTaskId ? 'agentsMemoryTaskScoped' : 'agentsMemoryScoped')} · {t(owner.locked ? 'agentsMemoryLocked' : 'agentsMemoryAutomatic')}</p>
    <details><summary>{t('memoryScopeDetails')}</summary>
      <p>{t('memorySourceConversation')}: {owner.sourceConversationId}</p>
      {owner.sharedConversationIds.map((id) => <p key={id}>{t('memorySharedConversation')}: {id}</p>)}
      {owner.sharedProjectRoots.map((root) => <p key={root}>{t('memoryProject')}: {root}</p>)}
      <p>{t('memoryReferenceBoundary')}</p>
    </details>
    <MemoryEvidence sources={memory.sources} consolidation={memory.consolidation} onSource={onSource} />
    <MemoryHistory history={memory.history} content={memory.content} busy={busy}
      loadHistory={async () => (await roomsRequest<{ history: CoreMemoryHistoryJson[] }>(agentPath(agentId) + '/memories/' + encodeURIComponent(memory.id) + '/history', 'GET')).history}
      onRollback={!memory.deletedAt && !memory.supersededAt ? (revision) => mutate({ rollbackRevision: revision }) : undefined} />
    {memory.supersededAt ? <p className="rooms-run-note">{t('agentsMemorySuperseded')}</p> : null}
    {!historyOnly && !memory.deletedAt && !memory.supersededAt ? <div className="agent-memory-actions">
      <button type="button" disabled={busy || (editing && !content.trim())} onClick={() => editing ? void mutate({ content: content.trim() }) : setEditing(true)}>{t(editing ? 'agentsSave' : 'agentsCorrect')}</button>
      {editing ? <button type="button" disabled={busy} onClick={() => { setContent(memory.content); setEditing(false); setError(''); pending.current = null }}>{t('roomsCancel')}</button> : null}
      <button type="button" disabled={busy} onClick={() => void mutate({ locked: !owner.locked })}>{t(owner.locked ? 'agentsUnlock' : 'agentsLock')}</button>
      <button type="button" disabled={busy} title={t('memoryDisableHint')} onClick={() => void mutate({ disabled: !memory.disabledAt })}>{t(memory.disabledAt ? 'agentsRestore' : 'agentsDisable')}</button>
      <button type="button" disabled={busy} aria-expanded={sharing} onClick={() => setSharing(!sharing)}>{t('agentsShareMemory')}</button>
      <button type="button" disabled={busy} onClick={() => { setConfirmation('forget'); setError('') }}>{t('agentsForget')}</button>
    </div> : memory.deletedAt ? <p className="rooms-run-note">{t('agentsForgotten')}</p> : null}
    {sharing ? <AgentMemorySharing agentId={agentId} memory={memory} busy={busy} onSave={mutate} /> : null}
    <details className="memory-danger"><summary>{t('memoryAdvancedActions')}</summary>
      <p className="rooms-run-note">{t('memoryDisableHint')}</p>
      <button type="button" disabled={busy} onClick={() => { setConfirmation('erase'); setError('') }}>{t('memoryErase')}</button>
    </details>
    {confirmation ? <MemoryDestructiveConfirmation key={confirmation} kind={confirmation} memoryId={memory.id} busy={busy}
      onCancel={() => { setConfirmation(null); pending.current = null }} onConfirm={() => void mutate(confirmation === 'forget' ? { forget: true }
        : { erase: true, eraseConfirmation: { memoryId: memory.id, irreversible: true } })} /> : null}
    {error ? <p role="alert" className="rooms-run-error">{error} <button type="button" disabled={busy} onClick={onUpdated}>{t('memoryReload')}</button></p> : null}
  </article>
}
