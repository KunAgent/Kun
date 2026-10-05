import { useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaperEvidence, PaperMatrixCell, PaperMatrixPatch } from '@shared/paper/paper-evidence-types'
import { inspectPaperEvidence } from '../../../paper/paper-evidence-actions'
import { evidenceButton, evidenceInput } from './PaperEvidencePane'

export function PaperMatrixCellEditor({ workspaceRoot, cell, evidence, onSave, onClose }: {
  workspaceRoot: string
  cell: PaperMatrixCell
  evidence: PaperEvidence[]
  onSave: (patch: PaperMatrixPatch) => Promise<void>
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState(cell)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const choices = evidence.filter((item) => item.unitDir === cell.unitDir)
  const act = async (action: () => Promise<void>): Promise<void> => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  const save = (): void => {
    void act(async () => {
      const { updatedAt: _updatedAt, ...patch } = draft
      if (patch.status === 'not-reported') { patch.value = ''; patch.evidenceIds = []; patch.comparability = 'unknown'; patch.comparabilityReason = '' }
      await onSave({ cells: [patch] })
      onClose()
    })
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose() }}>
    <section role="dialog" aria-modal="true" aria-label={t('paperMatrixEdit')} className="max-h-[90vh] w-full max-w-xl space-y-3 overflow-auto rounded-xl border border-ds-border bg-ds-card p-4 shadow-xl">
      <header className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-ds-ink">{t('paperMatrixEdit')} · {t(`paperMatrixAxis_${cell.axis}`)}</h2><button type="button" className={evidenceButton} disabled={busy} onClick={onClose}>{t('close')}</button></header>
      <label className="flex items-center gap-2 text-xs text-ds-muted"><input type="checkbox" checked={draft.status === 'not-reported'} onChange={(event) => setDraft({ ...draft, status: event.target.checked ? 'not-reported' : 'reported' })} />{t('paperMatrixUnknown')}</label>
      <label className="block text-xs text-ds-muted">{t('paperMatrixValue')}<textarea autoFocus rows={3} maxLength={16000} className={evidenceInput} disabled={draft.status === 'not-reported'} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>
      <fieldset className="space-y-2 rounded-lg border border-ds-border-muted p-2" disabled={draft.status === 'not-reported'}><legend className="px-1 text-xs text-ds-muted">{t('paperMatrixEvidence')}</legend>
        {!choices.length ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('paperEvidenceEmpty')}</p> : null}
        {choices.map((item) => <div key={item.id} className="rounded bg-ds-subtle p-2 text-xs">
          <label className="flex items-start gap-2"><input type="checkbox" checked={draft.evidenceIds.includes(item.id)} onChange={(event) => setDraft({ ...draft, evidenceIds: event.target.checked ? [...draft.evidenceIds, item.id] : draft.evidenceIds.filter((id) => id !== item.id) })} /><span className="min-w-0 break-words text-ds-ink">p.{item.anchor.page} · {item.originalQuote || t('paperEvidenceImage')}<span className="mt-1 block text-ds-muted">{t(`paperEvidence_${item.verification}`)} · {t(`paperEvidence_${item.mechanical.versionBinding}`)}</span></span></label>
          <button type="button" className="mt-1 text-xs text-accent" disabled={busy} onClick={() => void act(() => inspectPaperEvidence(workspaceRoot, item))}>{t('paperEvidenceSource')}</button>
        </div>)}
      </fieldset>
      <label className="block text-xs text-ds-muted">{t('paperMatrixComparability')}<select aria-label={t('paperMatrixComparability')} className={evidenceInput} disabled={draft.status === 'not-reported'} value={draft.comparability} onChange={(event) => setDraft({ ...draft, comparability: event.target.value as PaperMatrixCell['comparability'] })}>
        {(['unknown', 'comparable', 'not-comparable'] as const).map((value) => <option key={value} value={value}>{t(`paperMatrix_${value}`)}</option>)}
      </select></label>
      <label className="block text-xs text-ds-muted">{t('paperMatrixReason')}<textarea rows={2} maxLength={16000} className={evidenceInput} disabled={draft.status === 'not-reported'} value={draft.comparabilityReason} onChange={(event) => setDraft({ ...draft, comparabilityReason: event.target.value })} /></label>
      {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
      <button type="button" className={evidenceButton} disabled={busy || (draft.status === 'reported' && (!draft.value.trim() || !draft.evidenceIds.length)) || (draft.comparability !== 'unknown' && !draft.comparabilityReason.trim())} onClick={save}>{t('paperEvidenceSaveEdits')}</button>
    </section>
  </div>
}
