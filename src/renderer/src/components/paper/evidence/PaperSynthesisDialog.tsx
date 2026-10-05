import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { createPaperTurnContext, PAPER_CONTEXT_MAX_CHARS, type PaperTurnContext } from '@shared/paper/paper-turn-context'
import type { PaperReadingRequest } from '../../../paper/paper-reading-request'
import { paperEvidenceCitation } from '../../../paper/paper-evidence-actions'
import { useChatStore } from '../../../store/chat-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { evidenceButton, evidencePrimaryButton } from './PaperEvidencePane'

export function PaperSynthesisDialog({ request, onClose }: { request: PaperReadingRequest; onClose: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const [sources, setSources] = useState<PaperTurnContext['sources'] | null>(null)
  const [limits, setLimits] = useState<string[]>([])
  const [error, setError] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const alive = useRef(true)
  const activeRequest = useRef(request)
  activeRequest.current = request
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const providerId = useChatStore((state) => state.composerProviderId)
  const model = useChatStore((state) => state.composerModel)
  useEffect(() => {
    let active = true
    setSources(null)
    setLimits([])
    setError('')
    setEnabled(false)
    void (async () => {
      const papers = request.papers ?? []
      if (papers.length < 1 || papers.length > 12) throw new Error('Choose 1–12 papers for a bounded synthesis request.')
      const evidence = await window.kunGui.paperEvidenceRead({ workspaceRoot: request.workspaceRoot })
      if (!evidence.ok) throw new Error(evidence.message)
      const next: PaperTurnContext['sources'] = []
      const warnings: string[] = []
      for (const paper of papers) {
        const material = await window.kunGui.paperEvidenceMaterial({ workspaceRoot: request.workspaceRoot, unitDir: paper.unitDir })
        if (!active) return
        if (!material.ok) throw new Error(`${paper.meta.title}: ${material.message}`)
        if (!material.sourceText.trim()) throw new Error(`${paper.meta.title}: no readable material`)
        if (material.abstractOnly || material.textPartial) warnings.push(paper.meta.title)
        const cards = evidence.items.filter((item) => item.unitDir === paper.unitDir)
        next.push({
          paperId: material.paperVersion?.canonicalId ?? paper.meta.arxivId ?? paper.meta.doi ?? paper.unitDir,
          title: paper.meta.title,
          locator: material.abstractOnly ? 'abstract only' : 'PDF page markers',
          sourceVersion: material.paperVersion?.pdfSha256,
          text: `${material.sourceText}\n\nUser-saved evidence (manual judgments are not program-certified):\n${cards.map(paperEvidenceCitation).join('\n\n')}`
        })
      }
      if (active) { setSources(next); setLimits(warnings) }
    })().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [request])
  const total = sources?.reduce((sum, source) => sum + source.text.length, 0) ?? 0
  const send = async (): Promise<void> => {
    if (lock.current || !sources || !enabled) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const paperContext = createPaperTurnContext({ version: 1, scope: 'multi-paper', privacy: 'model-provider', purpose: request.synthesis ?? 'compare', providerId, model, maxModelRequests: 1, sources })
      if (useWriteWorkspaceStore.getState().workspaceRoot !== request.workspaceRoot) throw new Error('The active library changed. Reopen the request.')
      const threadId = await useChatStore.getState().ensureWriteThreadForWorkspace(request.workspaceRoot, '')
      if (!alive.current || activeRequest.current !== request) return
      if (!threadId || useWriteWorkspaceStore.getState().workspaceRoot !== request.workspaceRoot) throw new Error('The active library changed. Reopen the request.')
      const task = request.synthesis === 'related-work'
        ? 'Draft Related Work grouped by research theme. Link every important statement to the supplied paper locator and evidence ID when available. Reuse stable citation keys supplied by evidence; otherwise explicitly identify the paper without inventing a BibTeX key.'
        : 'Compare these papers using task, method, dataset version and split, model size, training resources, metric, experimental conditions, code and limitations. Each cell must cite its source, or say not reported. Distinguish comparable from not directly comparable evaluations with reasons. Do not rank incomparable numbers.'
      const sent = await useChatStore.getState().sendMessage(`${task}\n\nThis is a read-only draft in chat. Use only supplied material. Do not change existing notes or matrices. Preserve original units, symbols, qualifiers and negation. Distinguish author-reported facts, user judgments and AI inferences. A quote match is not semantic verification. ${limits.length ? `Limited material for: ${limits.join('; ')}. Label these limitations clearly.` : ''}`, 'agent', { agentSurface: 'write', expectedThreadId: threadId, paperContext, waitForRuntimeAdmission: true })
      if (!sent) throw new Error(useChatStore.getState().error || 'Synthesis request was not admitted.')
      useWriteWorkspaceStore.getState().setAssistantOpen(true)
      if (alive.current && activeRequest.current === request) onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose() }}>
    <section role="dialog" aria-modal="true" aria-label={t('paperReadingScope')} className="max-h-[90vh] w-full max-w-2xl space-y-5 overflow-auto rounded-2xl border border-ds-border bg-ds-card p-6 shadow-2xl">
      <header className="flex items-center gap-3 border-b border-ds-border-muted pb-4"><h2 className="flex-1 text-base font-semibold text-ds-ink">{t(request.synthesis === 'related-work' ? 'writePaperRelatedWork' : 'writePaperCompare')}</h2><button type="button" className={evidenceButton} disabled={busy} onClick={onClose}>{t('close')}</button></header>
      <p className="text-xs text-ds-muted">{t('paperMatrixNoRank')}</p>
      <ul className="divide-y divide-ds-border-muted rounded-xl border border-ds-border-muted bg-ds-subtle/40 px-4 text-sm leading-relaxed text-ds-ink">{(request.papers ?? []).map((paper) => <li key={paper.unitDir} className="py-3">{paper.meta.title}{limits.includes(paper.meta.title) ? <span className="block text-amber-700 dark:text-amber-300">{t('paperEvidencePartial')}</span> : null}</li>)}</ul>
      <p className="text-xs text-ds-muted">{t('paperReadingScope')}: {total} / {PAPER_CONTEXT_MAX_CHARS} chars</p>
      {total > PAPER_CONTEXT_MAX_CHARS ? <p role="alert" className="text-xs text-red-500">Choose fewer papers; the selected material exceeds the bounded context. Nothing is silently truncated.</p> : null}
      {!providerId || !model || model === 'auto' ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('paperReadingFixedModel')}</p> : null}
      {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
      <label className="flex items-center gap-2 text-xs text-ds-ink"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />{t('paperReadingProvider')}: {providerId || '—'} / {model || '—'}</label>
      <p className="text-xs text-ds-muted">{t('paperReadingDisclosure')}</p>
      <button type="button" className={`${evidencePrimaryButton} px-4 py-2.5`} disabled={busy || !sources || !enabled || total > PAPER_CONTEXT_MAX_CHARS || !providerId || !model || model === 'auto'} onClick={() => void send()}>{t('paperReadingStart')}</button>
    </section>
  </div>
}
