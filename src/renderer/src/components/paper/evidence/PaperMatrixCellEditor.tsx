import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ArrowUpRight, Link2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperEvidence, PaperMatrixCell, PaperMatrixPatch } from '@shared/paper/paper-evidence-types'
import { inspectPaperEvidence } from '../../../paper/paper-evidence-actions'
import { evidenceButton, evidenceInput, evidencePrimaryButton } from './PaperEvidencePane'

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
  const dialog = useRef<HTMLElement>(null)
  const previousFocus = useRef(typeof document === 'undefined' ? null : document.activeElement)
  useEffect(() => {
    const previous = previousFocus.current
    return () => { if (typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
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
  const notReported = draft.status === 'not-reported'
  const canSave = notReported || (draft.value.trim() && draft.evidenceIds.length && (draft.comparability === 'unknown' || draft.comparabilityReason.trim()))
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (!lock.current) onClose() }
    if (event.key === 'Tab' && dialog.current) {
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label={t('paperMatrixEdit')} className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-panel">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ds-border-muted px-5 py-4">
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-ds-faint">{t('paperMatrixEdit')}</p>
          <h2 className="mt-1 text-base font-semibold text-ds-ink">{t(`paperMatrixAxis_${cell.axis}`)}</h2>
          <p className="mt-1 truncate text-[11px] text-ds-muted" title={choices[0]?.paperVersion.title ?? cell.unitDir}>{choices[0]?.paperVersion.title ?? cell.unitDir}</p>
        </div>
        <button type="button" className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40" title={t('close')} disabled={busy} onClick={onClose}><X size={16} /><span className="sr-only">{t('close')}</span></button>
      </header>
      <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-4">
        <div className="space-y-2.5">
          <label className="flex items-center gap-2 text-xs text-ds-muted"><input autoFocus={notReported} type="checkbox" className="accent-[var(--ds-accent)]" disabled={busy} checked={notReported} onChange={(event) => setDraft({ ...draft, status: event.target.checked ? 'not-reported' : 'reported' })} />{t('paperMatrixUnknown')}</label>
          <label className="block space-y-1.5 text-[11px] font-medium text-ds-muted"><span>{t('paperMatrixValue')}</span><textarea autoFocus={!notReported} rows={3} maxLength={16000} className={evidenceInput} disabled={busy || notReported} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ds-muted"><Link2 size={13} />{t('paperMatrixEvidence')}<span className="ml-1 font-normal tabular-nums text-ds-faint">{draft.evidenceIds.length}</span></legend>
          {!choices.length ? <p className="rounded-lg border border-dashed border-ds-border-muted p-4 text-xs leading-relaxed text-ds-muted">{t('paperEvidenceEmpty')}</p> : null}
          {choices.map((item) => <div key={item.id} className={`rounded-xl border p-3 transition ${draft.evidenceIds.includes(item.id) && !notReported ? 'border-accent-tint/30 bg-accent-tint/5' : 'border-ds-border-muted bg-ds-main'}`}>
            <label className="flex items-start gap-2.5">
              <input type="checkbox" className="mt-1 accent-[var(--ds-accent)]" disabled={busy || notReported} checked={!notReported && draft.evidenceIds.includes(item.id)} onChange={(event) => setDraft({ ...draft, evidenceIds: event.target.checked ? [...draft.evidenceIds, item.id] : draft.evidenceIds.filter((id) => id !== item.id) })} />
              <span className="min-w-0 flex-1">
                <span className="mb-1.5 flex flex-wrap gap-1.5 text-[10px] text-ds-faint"><span>p.{item.anchor.page}</span><span>·</span><span>{item.paperVersion.citeKey}</span><span>·</span><span>{item.paperVersion.arxivVersion ?? t('paperEvidenceVersionUnknown')}</span></span>
                <span className="block whitespace-pre-wrap break-words font-serif text-sm leading-relaxed text-ds-ink">{item.originalQuote || t('paperEvidenceImage')}</span>
                <span className="mt-2 block text-[10px] leading-relaxed text-ds-muted">{t('paperEvidenceVerification')}: {t(`paperEvidence_${item.verification}`)}</span>
                <span className="mt-1 block text-[10px] leading-relaxed text-ds-faint">{t('paperEvidenceSourceChecks')}: {t(`paperEvidence_${item.mechanical.versionBinding}`)}</span>
              </span>
            </label>
            <div className="mt-2 flex justify-end"><button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40" disabled={busy} onClick={() => void act(() => inspectPaperEvidence(workspaceRoot, item))}>{t('paperEvidenceSource')}<ArrowUpRight size={12} /></button></div>
          </div>)}
        </fieldset>
        <div className="space-y-3 border-t border-ds-border-muted pt-4">
          <label className="block space-y-1.5 text-[11px] font-medium text-ds-muted"><span>{t('paperMatrixComparability')}</span><select aria-label={t('paperMatrixComparability')} className={evidenceInput} disabled={busy || notReported} value={draft.comparability} onChange={(event) => setDraft({ ...draft, comparability: event.target.value as PaperMatrixCell['comparability'] })}>
            {(['unknown', 'comparable', 'not-comparable'] as const).map((value) => <option key={value} value={value}>{t(`paperMatrix_${value}`)}</option>)}
          </select></label>
          <label className="block space-y-1.5 text-[11px] font-medium text-ds-muted"><span>{t('paperMatrixReason')}</span><textarea rows={2} maxLength={16000} className={evidenceInput} disabled={busy || notReported} value={draft.comparabilityReason} onChange={(event) => setDraft({ ...draft, comparabilityReason: event.target.value })} /></label>
        </div>
        {error ? <p role="alert" className="rounded-lg bg-ds-danger-soft px-3 py-2 text-xs text-ds-danger">{error}</p> : null}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-ds-border-muted px-5 py-3">
        <button type="button" className={evidenceButton} disabled={busy} onClick={onClose}>{t('cancel')}</button>
        <button type="button" className={evidencePrimaryButton} disabled={busy || !canSave} onClick={save}>{t('paperEvidenceSaveEdits')}</button>
      </footer>
    </section>
  </div>
}
