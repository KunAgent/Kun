import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CoreMemoryRecordJson } from '../../agent/kun-contract'
import { loadMemoryHistory } from '../../agent/kun-runtime-memory-lifecycle'
import { getProvider } from '../../agent/registry'
import { MemoryEvidence } from '../memory/MemoryEvidence'
import { MemoryHistory } from '../memory/MemoryHistory'
import { metaInjectedDirectiveIds, metaInjectedDirectiveSummaries, metaInjectedMemorySummaries, useInjectedMemoryRecords } from './injected-memory-lookup'
import '../rooms/agents.css'

export function InjectedMemoryDetails({ meta, memoryIds, onClose }: {
  meta?: Record<string, unknown>; memoryIds: string[]; onClose: () => void
}) {
  const { t } = useTranslation('common')
  const records = useInjectedMemoryRecords()
  const snapshots = new Map(metaInjectedMemorySummaries(meta).map((entry) => [entry.id, entry.content]))
  const directives = metaInjectedDirectiveIds(meta)
  const directiveSnapshots = new Map(metaInjectedDirectiveSummaries(meta).map((entry) => [entry.id, entry.content]))
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => previous?.focus()
  }, [])
  return <div className="memory-used-backdrop" onClick={onClose}><div className="memory-used-dialog" role="dialog" aria-modal="true" aria-label={t('memoryUsedTitle')} ref={panel}
    onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key !== 'Tab') return
      const focusable = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input,summary,[tabindex="0"]')
      if (!focusable?.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
    <header><h2>{t('memoryUsedTitle')}</h2><button type="button" onClick={onClose} aria-label={t('memoryClose')}>×</button></header>
    <p className="rooms-run-note">{t('memoryReferenceBoundary')}</p>
    {directives.length ? <details><summary>{t('toolInjectedDirectives')} ({directives.length})</summary>
      {directives.map((id) => <p key={id}>{directiveSnapshots.get(id) ?? id}</p>)}
    </details> : null}
    {memoryIds.map((id) => <InjectedMemoryDetail key={id} id={id} snapshot={snapshots.get(id)} record={records.get(id)} />)}
  </div></div>
}

export function InjectedMemoryDetail({ id, snapshot, record }: { id: string; snapshot?: string; record?: CoreMemoryRecordJson }) {
  const { t } = useTranslation('common')
  const [current, setCurrent] = useState(record)
  const [editing, setEditing] = useState(false), [content, setContent] = useState(record?.content ?? '')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  useEffect(() => {
    // The lookup is asynchronous. Do not overwrite a draft or a newer locally saved revision.
    if (!record || editing || (current && (record.revision ?? 1) <= (current.revision ?? 1))) return
    setCurrent(record); setContent(record.content)
  }, [record, current, editing])
  const correct = async () => {
    if (!current || !content.trim() || inFlight.current) return
    const provider = getProvider()
    if (!provider.updateMemory) return
    inFlight.current = true; setBusy(true); setNotice('')
    try {
      const updated = await provider.updateMemory(id, { content: content.trim(), expectedRevision: current.revision ?? 1 }, {
        workspace: current.workspace, project: current.project
      })
      setCurrent(updated); setEditing(false); setNotice(t('memoryCorrectionSaved'))
    } catch (error) { setNotice(String(error)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <article data-memory-id={id}>
    <small>{id}</small>
    <h3>{t('memoryUsedSnapshot')}</h3>
    <p className="whitespace-pre-wrap">{snapshot ?? t('memoryEvidenceUnavailable')}</p>
    {current ? <details><summary>{t('memoryCurrentRecord')} · {t('memoryRevision', { revision: current.revision ?? 1 })}</summary>
      <p className="rooms-run-note">{current.scope}{current.project || current.workspace ? ': ' + (current.project ?? current.workspace) : ''}</p>
      <p className="whitespace-pre-wrap">{current.content}</p>
      <MemoryEvidence sources={current.sources} consolidation={current.consolidation} />
      <MemoryHistory key={current.revision} history={current.history} content={current.content} busy={busy} loadHistory={() => loadMemoryHistory(current)} />
      {!current.deletedAt && !current.supersededAt ? <>
        <p className="rooms-run-note">{t('memoryCorrectionHint')}</p>
        {editing ? <textarea aria-label={t('agentsMemoryContent')} rows={4} value={content} onChange={(event) => setContent(event.target.value)} /> : null}
        <div className="agent-memory-actions">
          <button type="button" disabled={busy || (editing && !content.trim())} onClick={() => editing ? void correct() : setEditing(true)}>{t(editing ? 'agentsSave' : 'agentsCorrect')}</button>
          {editing ? <button type="button" disabled={busy} onClick={() => { setEditing(false); setContent(current.content); setNotice('') }}>{t('roomsCancel')}</button> : null}
        </div>
      </> : <p>{t(current.deletedAt ? 'agentsForgotten' : 'agentsMemorySuperseded')}</p>}
    </details> : <p className="rooms-run-note">{t('memoryCurrentUnavailable')}</p>}
    {notice ? <p role="status">{notice}</p> : null}
  </article>
}
