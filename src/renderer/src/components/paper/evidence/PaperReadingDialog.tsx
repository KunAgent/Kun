import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaperEvidenceMaterialResult } from '@shared/paper/paper-evidence-types'
import { createPaperTurnContext, PAPER_CONTEXT_MAX_CHARS } from '@shared/paper/paper-turn-context'
import { useChatStore } from '../../../store/chat-store'
import { useWriteWorkspaceStore, writeJoinPath } from '../../../write/write-workspace-store'
import { paperReadingQuestion, type PaperReadingPurpose, type PaperReadingRequest, usePaperReadingRequest } from '../../../paper/paper-reading-request'
import { evidenceButton, evidenceInput } from './PaperEvidencePane'
import { PaperSynthesisDialog } from './PaperSynthesisDialog'

export function PaperReadingDialogHost(): ReactElement | null {
  const request = usePaperReadingRequest((state) => state.request)
  const revision = usePaperReadingRequest((state) => state.revision)
  const close = (): void => { if (usePaperReadingRequest.getState().revision === revision) usePaperReadingRequest.getState().close() }
  if (request?.synthesis) return <PaperSynthesisDialog key={revision} request={request} onClose={close} />
  return request ? <PaperReadingDialog key={revision} request={request} onClose={close} /> : null
}

export function PaperReadingDialog({ request, onClose }: { request: PaperReadingRequest; onClose: () => void }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [materialResult, setMaterial] = useState<{ scope: string; value: PaperEvidenceMaterialResult } | null>(null)
  const scope = `${request.workspaceRoot}\0${request.unitDir}`
  const material = materialResult?.scope === scope ? materialResult.value : null
  const [purpose, setPurpose] = useState<PaperReadingPurpose>('quick-screen')
  const [background, setBackground] = useState('')
  const [goal, setGoal] = useState('')
  const [question, setQuestion] = useState(request.question ?? '')
  const [privacy, setPrivacy] = useState<'model-provider' | 'local-only'>('local-only')
  const [error, setError] = useState('')
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
    setMaterial(null)
    setError('')
    setPrivacy('local-only')
    void window.kunGui.paperEvidenceMaterial({ workspaceRoot: request.workspaceRoot, unitDir: request.unitDir }).then((result) => { if (active) setMaterial({ scope, value: result }) }).catch((cause) => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [request.workspaceRoot, request.unitDir, scope])
  const fullText = request.selection?.text ?? (material?.ok ? material.sourceText : request.meta.abstract ?? '')
  const tooLong = fullText.length > PAPER_CONTEXT_MAX_CHARS
  const limited = !request.selection && (!material?.ok || material.abstractOnly || material.textPartial || tooLong)
  const insufficient = !request.selection && purpose !== 'quick-screen' && limited
  const staleSelection = Boolean(request.selection && (!request.selection.pdfSha256 || !material?.ok || material.paperVersion?.pdfSha256 !== request.selection.pdfSha256))
  const sourceText = fullText.slice(0, PAPER_CONTEXT_MAX_CHARS)
  const start = async (): Promise<void> => {
    if (lock.current || privacy !== 'model-provider' || insufficient || staleSelection || !sourceText.trim()) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (useWriteWorkspaceStore.getState().workspaceRoot !== request.workspaceRoot) throw new Error('The active library changed. Reopen the reading request.')
      const context = createPaperTurnContext({
        version: 1, scope: request.selection ? 'selected-passage' : 'current-paper', privacy, purpose,
        providerId, model, maxModelRequests: 1,
        sources: [{
          paperId: material?.ok && material.paperVersion ? material.paperVersion.canonicalId : request.meta.arxivId || request.meta.doi || request.unitDir,
          title: request.meta.title,
          locator: request.selection ? `selected passage starting on page ${request.selection.page}` : material?.ok && !material.abstractOnly ? 'PDF extraction with page markers' : 'abstract / metadata only',
          sourceVersion: request.selection ? request.selection.pdfSha256 : (material?.ok ? material.paperVersion?.pdfSha256 : undefined),
          text: sourceText
        }]
      })
      const chat = useChatStore.getState()
      const threadId = await chat.ensureWriteThreadForWorkspace(request.workspaceRoot, writeJoinPath(request.workspaceRoot, request.unitDir))
      if (!alive.current || activeRequest.current !== request) return
      if (!threadId || useWriteWorkspaceStore.getState().workspaceRoot !== request.workspaceRoot) throw new Error('The paper conversation is no longer available.')
      useWriteWorkspaceStore.getState().setAssistantOpen(true)
      const sent = await useChatStore.getState().sendMessage(`${paperReadingQuestion(purpose, { background, goal, question, limited })}\n\nInterface language: ${i18n.language}`, 'agent', {
        agentSurface: 'write', expectedThreadId: threadId, paperContext: context, waitForRuntimeAdmission: true
      })
      if (!sent) throw new Error(useChatStore.getState().error || 'Reading request was not admitted. No saved evidence was changed.')
      if (alive.current && activeRequest.current === request) onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose() }}>
    <section role="dialog" aria-modal="true" aria-label={t('paperReadingTitle')} data-testid="paper-reading-dialog" className="max-h-[90vh] w-full max-w-xl space-y-3 overflow-auto rounded-xl border border-ds-border bg-ds-card p-4 shadow-xl">
      <header className="flex items-center gap-3"><h2 className="flex-1 text-sm font-semibold text-ds-ink">{t('paperReadingTitle')}</h2><button type="button" className={evidenceButton} disabled={busy} onClick={onClose}>{t('close')}</button></header>
      <p className="text-sm text-ds-ink">{request.meta.title}</p>
      <label className="block text-xs text-ds-muted">{t('paperReadingOpen')}<select aria-label={t('paperReadingOpen')} className={evidenceInput} value={purpose} onChange={(event) => setPurpose(event.target.value as PaperReadingPurpose)}>
        {(['quick-screen', 'method-deep-read', 'reproduction-prep', 'review-critique'] as const).map((value) => <option key={value} value={value}>{t(`paperReading_${value}`)}</option>)}
      </select></label>
      <div className="rounded-lg border border-ds-border-muted bg-ds-subtle p-3 text-xs text-ds-muted">
        <p className="font-medium text-ds-ink">{t('paperReadingMaterial')}</p>
        {!material ? <p>{t('loading')}</p> : !material.ok ? <p>{material.message}</p> : <>
          <p>{material.abstractOnly ? t('paperReadingAbstractOnly') : t('paperReadingPages', { extracted: material.extractedPages.length, total: material.pageCount })}</p>
          {material.missingTextPages.length ? <p>{t('paperReadingMissingPages', { pages: material.missingTextPages.join(', ') })}</p> : null}
          {material.textPartial ? <p>{t('paperEvidencePartial')}</p> : null}
          <p>{t('paperReadingFigures', { status: material.figuresStatus, ...material.figureConfidence })}</p>
          <p>{t('paperReadingFiguresUnbound')}</p>
          <p>{material.paperVersion?.arxivVersion ?? t('paperEvidenceVersionUnknown')}</p>
          {material.paperVersion ? <p className="break-all">SHA-256: {material.paperVersion.pdfSha256}</p> : null}
        </>}
        <p className="mt-1">{t('paperReadingScope')}: {request.selection ? `p.${request.selection.page}` : request.unitDir} · {sourceText.length} / {fullText.length} chars</p>
        {tooLong ? <p className="text-amber-700 dark:text-amber-300">{t('paperEvidencePartial')} · {PAPER_CONTEXT_MAX_CHARS} chars</p> : null}
      </div>
      <label className="block text-xs text-ds-muted">{t('paperReadingBackground')}<input maxLength={2000} className={evidenceInput} value={background} onChange={(event) => setBackground(event.target.value)} /></label>
      <label className="block text-xs text-ds-muted">{t('paperReadingGoal')}<input maxLength={2000} className={evidenceInput} value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
      <label className="block text-xs text-ds-muted">{t('paperEvidenceQuestion')}<textarea rows={2} maxLength={4000} className={evidenceInput} value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
      <fieldset className="space-y-2 rounded-lg border border-ds-border-muted p-3">
        <label className="flex items-center gap-2 text-xs text-ds-ink"><input type="radio" name="paper-privacy" value="local-only" checked={privacy === 'local-only'} onChange={() => setPrivacy('local-only')} />{t('paperReadingLocal')}</label>
        <label className="flex items-center gap-2 text-xs text-ds-ink"><input type="radio" name="paper-privacy" value="model-provider" checked={privacy === 'model-provider'} onChange={() => setPrivacy('model-provider')} />{t('paperReadingProvider')}: {providerId || '—'} / {model || '—'}</label>
        <p className="text-xs text-ds-muted">{t(privacy === 'local-only' ? 'paperReadingNoLocalModel' : 'paperReadingDisclosure')}</p>
      </fieldset>
      {staleSelection && material ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('paperReadingStaleSelection')}</p> : null}
      {insufficient ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('paperReadingInsufficient')}</p> : null}
      {!providerId || !model || model === 'auto' ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('paperReadingFixedModel')}</p> : null}
      {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
      <button type="button" className={evidenceButton} disabled={busy || !material || privacy !== 'model-provider' || insufficient || staleSelection || !sourceText.trim() || !providerId || !model || model === 'auto'} onClick={() => void start()}>{t('paperReadingStart')}</button>
    </section>
  </div>
}
