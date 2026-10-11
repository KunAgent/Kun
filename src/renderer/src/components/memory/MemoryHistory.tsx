import { MemoryEvidence } from './MemoryEvidence'
import { diffLines } from 'diff'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CoreMemoryHistoryJson } from '../../agent/kun-contract'
import '../rooms/rooms-runs.css'

export function MemoryHistory({ history = [], content, busy, onRollback, loadHistory }: {
  history?: CoreMemoryHistoryJson[]; content: string; busy: boolean; onRollback?: (revision: number) => Promise<boolean>
  loadHistory?: () => Promise<CoreMemoryHistoryJson[]>
}) {
  const { t } = useTranslation('common')
  const [selected, setSelected] = useState<number | null>(null)
  const [versions, setVersions] = useState(history), [loaded, setLoaded] = useState(history.length > 0)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const inFlight = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const load = async () => {
    if (!loadHistory || loaded || inFlight.current) return
    inFlight.current = true; setLoading(true); setError('')
    try {
      const result = await loadHistory()
      if (alive.current) { setVersions(result); setLoaded(true) }
    } catch (cause) { if (alive.current) setError(String(cause)) }
    finally { inFlight.current = false; if (alive.current) setLoading(false) }
  }
  return <details className="memory-history" onToggle={(event) => { if (event.currentTarget.open) void load() }}><summary>{t('memoryHistory')}{loaded ? ` (${versions.length})` : ''}</summary>
    <p className="rooms-run-note">{t('memoryHistoryHint')}</p>
    {loading ? <p role="status">{t('roomsLoading')}</p> : null}
    {error ? <p role="alert">{error} <button type="button" onClick={() => void load()}>{t('memoryReload')}</button></p> : null}
    {versions.slice().reverse().map((entry) => <section key={entry.revision} className="memory-history-version">
      <button type="button" aria-expanded={selected === entry.revision} onClick={() => setSelected(selected === entry.revision ? null : entry.revision)}>
        {t('memoryRevision', { revision: entry.revision })} · {t('memoryOperation_' + entry.operation)} · {new Date(entry.changedAt).toLocaleString()}
      </button>
      {selected === entry.revision ? <div>
        <p className="rooms-run-note">{t('memoryDiffHint')}</p>
        <pre className="memory-diff">{diffLines(content, entry.snapshot.content).map((part, index) => <span key={index}
          className={part.added ? 'memory-diff-added' : part.removed ? 'memory-diff-removed' : undefined}>{part.added ? '+ ' : part.removed ? '- ' : '  '}{part.value}</span>)}</pre>
        <p className="rooms-run-note">{t('memoryRevisionDetails', { type: entry.snapshot.type ?? 'fact', authority: entry.snapshot.authority ?? 'reference', sources: entry.snapshot.sources?.length ?? 0 })}</p>
        <details><summary>{t('memoryVersionMetadata')}</summary>
          <p>{t('memoryVersionTags')}: {entry.snapshot.tags?.join(', ') || '—'}</p>
          <p>{t('memoryVersionConfidence')}: {entry.snapshot.confidence ?? 1} · {t('memoryVersionImportance')}: {entry.snapshot.importance ?? .5}</p>
          {entry.snapshot.observedAt ? <p>{t('memoryVersionObserved')}: {entry.snapshot.observedAt}</p> : null}
          {entry.snapshot.expiresAt ? <p>{t('memoryVersionExpires')}: {entry.snapshot.expiresAt}</p> : null}
          {entry.snapshot.disabledAt ? <p>{t('memoryDisabledState')}: {entry.snapshot.disabledAt}</p> : null}
          <MemoryEvidence sources={entry.snapshot.sources} consolidation={entry.snapshot.consolidation} />
        </details>
        {onRollback ? <button type="button" disabled={busy} onClick={async () => { if (await onRollback(entry.revision)) setSelected(null) }}>{t('memoryRollback')}</button> : null}
      </div> : null}
    </section>)}
    {!loading && !error && (loaded || !loadHistory) && !versions.length ? <p className="rooms-run-note">{t('memoryHistoryEmpty')}</p> : null}
  </details>
}
