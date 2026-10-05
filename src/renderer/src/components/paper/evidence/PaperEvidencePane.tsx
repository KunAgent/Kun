import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaperEvidence, PaperEvidencePatch } from '@shared/paper/paper-evidence-types'
import { PaperEvidenceImage } from './PaperEvidenceImage'
import { inspectPaperEvidence, paperEvidenceCitation } from '../../../paper/paper-evidence-actions'

export const evidenceInput = 'w-full rounded-md border border-ds-border-muted bg-ds-main px-2 py-1.5 text-xs text-ds-ink'
export const evidenceButton = 'rounded-md border border-ds-border-muted px-2 py-1.5 text-xs text-ds-ink hover:bg-ds-hover disabled:opacity-40'

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
    <p className="text-xs text-ds-muted">{t('paperEvidenceCheckDisclaimer')}</p>
    {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
    <button type="button" className={evidenceButton} disabled={loading} onClick={() => void reload()}>{t('paperEvidenceReload')}</button>
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
  })
  return <article data-testid="paper-evidence-card" className="space-y-2 rounded-lg border border-ds-border-muted bg-ds-card p-3">
    <div className="text-xs font-medium text-ds-ink">{evidence.paperVersion.title}</div>
    <div className="break-words text-[11px] text-ds-muted">{evidence.paperVersion.citeKey} · p.{evidence.anchor.page} · {evidence.paperVersion.arxivVersion ?? t('paperEvidenceVersionUnknown')}</div>
    <div className="break-all text-[10px] text-ds-faint" title={evidence.paperVersion.pdfSha256}>SHA-256: {evidence.paperVersion.pdfSha256.slice(0, 16)}…</div>
    <div className="flex flex-wrap gap-1 text-[11px] text-amber-700 dark:text-amber-300">
      <span>{t(`paperEvidence_${evidence.mechanical.versionBinding}`)}</span><span>·</span>
      <span>{t(`paperEvidence_${evidence.mechanical.quoteMatch}`)}</span>
    </div>
    {evidence.mechanical.textPartial ? <p className="text-[11px] text-amber-700 dark:text-amber-300">{t('paperEvidencePartial')}</p> : null}
    {evidence.imagePath && workspaceRoot ? <PaperEvidenceImage workspaceRoot={workspaceRoot} path={evidence.imagePath} /> : null}
    <div><p className="text-[11px] text-ds-muted">{t('paperEvidenceOriginal')}</p>
      <p className="mt-1 whitespace-pre-wrap break-words rounded bg-ds-subtle p-2 text-xs text-ds-ink">{evidence.originalQuote || t('paperEvidenceImage')}</p>
    </div>
    {(['interpretation', 'conditions', 'question'] as const).map((key) => <label key={key} className="block text-[11px] text-ds-muted">
      {t(`paperEvidence${key[0].toUpperCase()}${key.slice(1)}`)}
      <textarea rows={2} maxLength={16000} className={evidenceInput} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
    </label>)}
    <label className="block text-[11px] text-ds-muted">{t('paperEvidenceClaimKind')}
      <select aria-label={t('paperEvidenceClaimKind')} className={evidenceInput} value={draft.claimKind} onChange={(event) => setDraft({ ...draft, claimKind: event.target.value as PaperEvidence['claimKind'] })}>
        {(['author-reported', 'user-judgment', 'ai-inference'] as const).map((kind) => <option key={kind} value={kind}>{t(`paperEvidence_${kind}`)}</option>)}
      </select>
    </label>
    <label className="block text-[11px] text-ds-muted">{t('paperEvidenceVerification')}
      <select aria-label={t('paperEvidenceVerification')} className={evidenceInput} value={draft.verification} onChange={(event) => setDraft({ ...draft, verification: event.target.value as PaperEvidence['verification'] })}>
        {(['unverified', 'user-verified', 'rejected'] as const).map((kind) => <option key={kind} value={kind}>{t(`paperEvidence_${kind}`)}</option>)}
      </select>
    </label>
    {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
    {notice ? <p role="status" className="text-xs text-ds-muted">{notice}</p> : null}
    <div className="flex flex-wrap gap-1">
      <button type="button" className={evidenceButton} disabled={busy} onClick={() => void save(draft)}>{t('paperEvidenceSaveEdits')}</button>
      <button type="button" className={evidenceButton} disabled={busy || !undo} onClick={() => undo && void save(undo)}>{t('paperEvidenceUndo')}</button>
      <button type="button" className={evidenceButton} disabled={busy} onClick={() => void act(onSource)}>{t('paperEvidenceSource')}</button>
      <button type="button" className={evidenceButton} disabled={busy} onClick={() => void act(async () => { await navigator.clipboard.writeText(paperEvidenceCitation(evidence)); setNotice(t('paperEvidenceCopied')) })}>{t('paperEvidenceCopy')}</button>
    </div>
  </article>
}

function editable(item: PaperEvidence): PaperEvidencePatch {
  return { interpretation: item.interpretation, conditions: item.conditions, question: item.question, claimKind: item.claimKind, verification: item.verification }
}
