import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentMemoryCandidate } from '../../../../../kun/src/agents/agent-memory-capture-types'
import { agentPath, useAgentResource } from './agent-client'
import { roomRequestId, roomsRequest } from './rooms-client'
import { RoomMessageBody } from './RoomMessageBody'

type Entry = { candidate: AgentMemoryCandidate; revision: number;
  target?: { content: string; fingerprint: string; shared?: boolean; disabled: boolean } }
export function AgentMemoryCandidates({ agentId, active, onUpdated }: { agentId: string; active: boolean; onUpdated: () => void }) {
  const { t } = useTranslation('common')
  const [cursor, setCursor] = useState<string | undefined>(), [older, setOlder] = useState<Entry[]>([])
  const page = useAgentResource<{ candidates: Entry[]; nextCursor?: string }>(agentPath(agentId) + '/memory-candidates' + (cursor ? '?cursor=' + cursor : ''), active)
  const work = useAgentResource<{ jobs: Array<{ id: string; status: string; attempts: number; error?: string }> }>(agentPath(agentId) + '/memory-work', active)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const pending = useRef<{ hash: string; id: string } | null>(null)
  const entries = [...new Map([...older, ...(page.data?.candidates ?? [])].map((entry) => [entry.candidate.id, entry])).values()]
  const decide = async (entry: Entry, decision: 'allow' | 'skip') => {
    if (busy) return
    const body = { expectedRevision: entry.revision, decision, expectedTargetFingerprint: entry.target?.fingerprint }
    const hash = JSON.stringify([entry.candidate.id, body])
    if (pending.current?.hash !== hash) pending.current = { hash, id: roomRequestId() }
    setBusy(true); setError('')
    try {
      await roomsRequest(agentPath(agentId) + '/memory-candidates/' + encodeURIComponent(entry.candidate.id) + '/decision', 'POST',
        { ...body, clientRequestId: pending.current.id })
      pending.current = null; setOlder([]); setCursor(undefined); page.refresh(); onUpdated()
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <section className="agent-memory-candidates" aria-label={t('agentsMemoryCandidates')}>
    {work.data?.jobs.length ? <p className="rooms-run-note">{t('agentsMemoryPending', {
      count: work.data.jobs.length
    })}</p> : null}
    {work.data?.jobs.filter((job) => job.status === 'deferred' || job.status === 'failed').map((job) =>
      <p key={job.id} className="rooms-run-note">{t('agentsMemoryDeferred')}{job.error ? ' · ' + job.error : ''}</p>)}
    {entries.length ? <h3>{t('agentsMemoryCandidates')}</h3> : null}
    {entries.map((entry) => <article className="agent-memory-entry" key={entry.candidate.id}>
      <p className="rooms-run-note">{t('agentsMemoryConflictHint')}</p>
      {entry.target ? <><strong>{t('agentsMemoryCurrent')}</strong><RoomMessageBody body={entry.target.content} attachmentIds={[]} />
        {entry.target.shared ? <p className="rooms-run-note">{t('agentsMemoryUniversal')}</p> : null}</> : <p>{t('agentsMemoryTargetMissing')}</p>}
      <strong>{t('agentsMemoryProposed')}</strong><RoomMessageBody body={entry.candidate.candidate.content} attachmentIds={[]} />
      <details><summary>{t('agentsMemorySources')}</summary>{entry.candidate.candidate.sources.map((source) =>
        <p key={source.id}>{source.excerpt} <small>{source.locator}</small></p>)}</details>
      <div className="agent-memory-actions">
        <button type="button" disabled={busy || !entry.target || entry.target.disabled} onClick={() => void decide(entry, 'allow')}>{t('agentsMemoryAccept')}</button>
        <button type="button" disabled={busy} onClick={() => void decide(entry, 'skip')}>{t('agentsMemorySkip')}</button>
      </div>
    </article>)}
    {page.data?.nextCursor ? <button type="button" onClick={() => { setOlder(entries); setCursor(page.data!.nextCursor) }}>{t('roomsLoadMore')}</button> : null}
    {error || page.error ? <p role="alert" className="rooms-run-error">{error || page.error}</p> : null}
  </section>
}
