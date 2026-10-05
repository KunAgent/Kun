import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ArrowUpRight, ChevronRight, Copy, Pencil, RefreshCw, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperEvidence, PaperEvidencePatch } from '@shared/paper/paper-evidence-types'
import { PaperEvidenceImage } from './PaperEvidenceImage'
import { inspectPaperEvidence, paperEvidenceCitation } from '../../../paper/paper-evidence-actions'

export const evidenceInput = 'w-full rounded-lg border border-ds-border-muted bg-ds-main px-3 py-2 text-xs leading-relaxed text-ds-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-tint/10 disabled:cursor-not-allowed disabled:opacity-50'
export const evidenceButton = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-xs font-medium text-ds-ink transition hover:bg-ds-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40'
export const evidencePrimaryButton = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-xs font-medium text-control-foreground transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40'

export function PaperEvidencePane({ workspaceRoot, unitDir }: { workspaceRoot: string; unitDir?: string }): ReactElement {
  const { t } = useTranslation('common')
  const [items, setItems] = useState<PaperEvidence[]>([])
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  const scope = `${workspaceRoot}\0${unitDir ?? ''}`
  const activeScope = useRef(scope)
  activeScope.current = scope
  const reload = async (): Promise<void> => {
    const token = ++generation.current
    setLoading(true)
    try {
      const result = await window.kunGui.paperEvidenceRead({ workspaceRoot, unitDir })
      if (token !== generation.current) return
      if (!result.ok) throw new Error(result.message)
      setItems(result.items)
      setRevision(result.revision)
      setError('')
    } catch (cause) {
      if (token === generation.current) setError(String(cause instanceof Error ? cause.message : cause))
    } finally {
      if (token === generation.current) setLoading(false)
    }
  }
  useEffect(() => {
    void reload()
    return () => { generation.current += 1 }
    // A scope change must abandon outstanding reads from the previous paper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot, unitDir])
  return <section data-testid="paper-evidence-pane" className="space-y-3">
    <div className="flex items-start gap-3 px-1">
      <p className="flex-1 text-[11px] leading-relaxed text-ds-muted">{t('paperEvidenceCheckDisclaimer')}</p>
      <button type="button" className="shrink-0 rounded-md p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40" title={t('paperEvidenceReload')} aria-label={t('paperEvidenceReload')} disabled={loading} onClick={() => void reload()}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
    </div>
    {error ? <p role="alert" className="text-xs text-ds-danger">{error}</p> : null}
    {loading ? <p className="text-xs text-ds-muted">{t('loading')}</p> : null}
    {!loading && !items.length ? <p className="text-xs text-ds-muted">{t('paperEvidenceEmpty')}</p> : null}
    {items.map((item) => <PaperEvidenceCard key={item.id} evidence={item} workspaceRoot={workspaceRoot} onSave={async (patch) => {
      const result = await window.kunGui.paperEvidenceUpdate({ workspaceRoot, evidenceId: item.id, expectedRevision: revision, patch })
      if (!result.ok) throw new Error(result.message)
      if (activeScope.current !== scope) return
      setRevision(result.revision)
      setItems(unitDir ? result.items.filter((entry) => entry.unitDir === unitDir) : result.items)
    }} onSource={() => inspectPaperEvidence(workspaceRoot, item)} />)}
  </section>
}

export function PaperEvidenceCard({ evidence, workspaceRoot, onSave, onSource }: {
  evidence: PaperEvidence
  workspaceRoot?: string
  onSave: (patch: PaperEvidencePatch) => Promise<void>
  onSource: () => Promise<void>
}): ReactElement {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState<PaperEvidencePatch>(() => editable(evidence))
  const [saved, setSaved] = useState<PaperEvidencePatch>(() => editable(evidence))
  const [undo, setUndo] = useState<PaperEvidencePatch | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    setDraft(editable(evidence))
    setSaved(editable(evidence))
    // Reloading one changed card must not discard drafts in unrelated cards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence.id, evidence.updatedAt])
  const act = async (action: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const save = (next: PaperEvidencePatch): Promise<void> => act(async () => {
    await onSave(next)
    setUndo(saved)
    setSaved(next)
    setDraft(next)
    setEditing(false)
  })
  const sourceWarning = evidence.mechanical.versionBinding !== 'bound' || evidence.mechanical.quoteMatch === 'not-found' || evidence.mechanical.textPartial
  const verificationTone = saved.verification === 'user-verified' ? 'bg-ds-success-soft text-ds-success' : saved.verification === 'rejected' ? 'bg-ds-danger-soft text-ds-danger' : 'bg-ds-subtle text-ds-muted'
  return <article data-testid="paper-evidence-card" className="overflow-hidden rounded-xl border border-ds-border-muted bg-ds-card shadow-sm">
    <div className="space-y-4 p-4">
      <header className="space-y-2">
        <h3 className="break-words text-[13px] font-semibold leading-snug text-ds-ink">{evidence.paperVersion.title}</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-ds-muted">
          <span className="max-w-full truncate rounded-md bg-ds-subtle px-1.5 py-0.5" title={evidence.paperVersion.citeKey}>{evidence.paperVersion.citeKey}</span>
          <span className="rounded-md bg-ds-subtle px-1.5 py-0.5">p.{evidence.anchor.page}</span>
          <span className="rounded-md bg-ds-subtle px-1.5 py-0.5">{evidence.paperVersion.arxivVersion ?? t('paperEvidenceVersionUnknown')}</span>
        </div>
      </header>
      <div>
        <p className="mb-2 text-[10px] font-medium tracking-wide text-ds-faint">{t('paperEvidenceOriginal')}</p>
        {evidence.imagePath && workspaceRoot ? <PaperEvidenceImage workspaceRoot={workspaceRoot} path={evidence.imagePath} /> : null}
        <blockquote className="border-l-2 border-accent-tint/40 pl-3 font-serif text-[15px] leading-7 text-ds-ink">
          <p className="whitespace-pre-wrap break-words">{evidence.originalQuote || t('paperEvidenceImage')}</p>
        </blockquote>
      </div>
      <details className="group text-[10px] text-ds-muted">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 rounded-md focus-visible:outline focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
          <span className="font-medium">{t('paperEvidenceSourceChecks')}</span>
          <span aria-hidden="true" className="text-ds-faint">·</span>
          <span className={sourceWarning ? 'text-amber-700 dark:text-amber-300' : ''}>{t(`paperEvidence_${evidence.mechanical.quoteMatch}`)}</span>
          {evidence.mechanical.versionBinding !== 'bound' ? <span className="text-amber-700 dark:text-amber-300">{t(`paperEvidence_${evidence.mechanical.versionBinding}`)}</span> : null}
          {evidence.mechanical.textPartial ? <span className="text-amber-700 dark:text-amber-300">{t('paperEvidencePartial')}</span> : null}
        </summary>
        <div className="mt-2 space-y-1.5 rounded-lg bg-ds-subtle p-2.5 leading-relaxed">
          <p className={evidence.mechanical.versionBinding !== 'bound' ? 'text-amber-700 dark:text-amber-300' : ''}>{t(`paperEvidence_${evidence.mechanical.versionBinding}`)}</p>
          <p className="break-all font-mono text-[9px] text-ds-faint" title={evidence.paperVersion.pdfSha256}>SHA-256: {evidence.paperVersion.pdfSha256}</p>
        </div>
      </details>
    </div>
    <div className="space-y-3 border-t border-ds-border-muted px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[10px] font-medium text-ds-muted">{t('paperEvidenceVerification')}</p>
          <span data-testid="paper-evidence-semantic-status" className={`inline-flex rounded-md px-2 py-1 text-[10px] leading-snug ${verificationTone}`}>{t(`paperEvidence_${saved.verification}`)}</span>
        </div>
        {!editing ? <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink" disabled={busy} onClick={() => setEditing(true)}><Pencil size={12} />{t('paperEvidenceEdit')}</button> : null}
      </div>
      {editing ? <div className="space-y-3" data-testid="paper-evidence-editor">
        {(['interpretation', 'conditions', 'question'] as const).map((key) => <label key={key} className="block space-y-1.5 text-[11px] text-ds-muted">
          <span>{t(`paperEvidence${key[0].toUpperCase()}${key.slice(1)}`)}</span>
          <textarea autoFocus={key === 'interpretation'} rows={key === 'interpretation' ? 3 : 2} maxLength={16000} className={evidenceInput} disabled={busy} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
        </label>)}
        <label className="block space-y-1.5 text-[11px] text-ds-muted"><span>{t('paperEvidenceClaimKind')}</span>
          <select aria-label={t('paperEvidenceClaimKind')} className={evidenceInput} disabled={busy} value={draft.claimKind} onChange={(event) => setDraft({ ...draft, claimKind: event.target.value as PaperEvidence['claimKind'] })}>
            {(['author-reported', 'user-judgment', 'ai-inference'] as const).map((kind) => <option key={kind} value={kind}>{t(`paperEvidence_${kind}`)}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5 text-[11px] text-ds-muted"><span>{t('paperEvidenceVerification')}</span>
          <select aria-label={t('paperEvidenceVerification')} className={evidenceInput} disabled={busy} value={draft.verification} onChange={(event) => setDraft({ ...draft, verification: event.target.value as PaperEvidence['verification'] })}>
            {(['unverified', 'user-verified', 'rejected'] as const).map((kind) => <option key={kind} value={kind}>{t(`paperEvidence_${kind}`)}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={evidenceButton} disabled={busy} onClick={() => { setDraft(saved); setEditing(false); setError('') }}>{t('cancel')}</button>
          <button type="button" className={evidencePrimaryButton} disabled={busy} onClick={() => void save(draft)}>{t('paperEvidenceSaveEdits')}</button>
        </div>
      </div> : <div className="space-y-3">
        <p className="text-[10px] text-ds-faint">{t(`paperEvidence_${saved.claimKind}`)}</p>
        {(['interpretation', 'conditions', 'question'] as const).map((key) => saved[key]?.trim() ? <div key={key}>
          <p className="mb-1 text-[10px] font-medium text-ds-muted">{t(`paperEvidence${key[0].toUpperCase()}${key.slice(1)}`)}</p>
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-ds-ink">{saved[key]}</p>
        </div> : null)}
      </div>}
      {error ? <p role="alert" className="text-xs text-ds-danger">{error}</p> : null}
      {notice ? <p role="status" className="text-[11px] text-ds-muted">{notice}</p> : null}
    </div>
    <footer className="flex flex-wrap items-center gap-1 border-t border-ds-border-muted px-3 py-2">
      <button type="button" className="mr-auto inline-flex min-h-7 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40" disabled={busy} onClick={() => void act(onSource)}>{t('paperEvidenceSource')}<ArrowUpRight size={13} /></button>
      <button type="button" className="rounded-md p-1.5 text-ds-muted transition hover:bg-ds-hover disabled:opacity-30" title={t('paperEvidenceUndo')} disabled={busy || !undo} onClick={() => undo && void save(undo)}><Undo2 size={14} /><span className="sr-only">{t('paperEvidenceUndo')}</span></button>
      <button type="button" className="rounded-md p-1.5 text-ds-muted transition hover:bg-ds-hover disabled:opacity-30" title={t('paperEvidenceCopy')} disabled={busy} onClick={() => void act(async () => { await navigator.clipboard.writeText(paperEvidenceCitation(evidence)); setNotice(t('paperEvidenceCopied')) })}><Copy size={14} /><span className="sr-only">{t('paperEvidenceCopy')}</span></button>
    </footer>
  </article>
}

function editable(item: PaperEvidence): PaperEvidencePatch {
  return { interpretation: item.interpretation, conditions: item.conditions, question: item.question, claimKind: item.claimKind, verification: item.verification }
}
