import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CoreMemoryRecordJson } from '../../agent/kun-contract'
import { applyMemoryLifecycle, loadMemoryHistory, type MemoryLifecycleAction } from '../../agent/kun-runtime-memory-lifecycle'
import { MemoryEvidence } from './MemoryEvidence'
import { MemoryHistory } from './MemoryHistory'
import { MemoryDestructiveConfirmation } from './MemoryDestructiveConfirmation'
import '../rooms/agents.css'

export function MemoryRecordLifecycle({ record, onChanged }: { record: CoreMemoryRecordJson; onChanged: () => void }) {
  const { t } = useTranslation('common')
  const [confirmation, setConfirmation] = useState<'forget' | 'erase' | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const inFlight = useRef(false)
  const mutate = async (action: MemoryLifecycleAction): Promise<boolean> => {
    if (inFlight.current) return false
    inFlight.current = true; setBusy(true); setError('')
    try { await applyMemoryLifecycle(record, action); setConfirmation(null); onChanged(); return true }
    catch (cause) { setError(String(cause)); return false }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <section className="agent-memory-entry" aria-label={t('memoryHistory')}>
    <p className="rooms-run-note">{t('memoryRevision', { revision: record.revision ?? 1 })}{record.projectIdentity ? ' · ' + record.projectIdentity : ''}</p>
    <MemoryEvidence sources={record.sources} consolidation={record.consolidation} />
    <MemoryHistory content={record.content} history={record.history} busy={busy} loadHistory={() => loadMemoryHistory(record)}
      onRollback={!record.deletedAt && !record.supersededAt ? (targetRevision) => mutate({ action: 'rollback', targetRevision }) : undefined} />
    <details><summary>{t('memoryAdvancedActions')}</summary>
      <p className="rooms-run-note">{t('memoryDisableHint')}</p>
      <div className="agent-memory-actions">
        {!record.deletedAt ? <>
          <button type="button" disabled={busy} onClick={() => void mutate({ action: record.disabledAt ? 'restore' : 'disable' })}>{t(record.disabledAt ? 'agentsRestore' : 'agentsDisable')}</button>
          <button type="button" disabled={busy} onClick={() => setConfirmation('forget')}>{t('agentsForget')}</button>
        </> : null}
        <button type="button" disabled={busy} onClick={() => setConfirmation('erase')}>{t('memoryErase')}</button>
      </div>
    </details>
    {confirmation ? <MemoryDestructiveConfirmation key={confirmation} kind={confirmation} memoryId={record.id} busy={busy}
      onCancel={() => setConfirmation(null)} onConfirm={() => void mutate(confirmation === 'forget' ? { action: 'forget' }
        : { action: 'erase', confirmation: { memoryId: record.id, irreversible: true } })} /> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>
}
