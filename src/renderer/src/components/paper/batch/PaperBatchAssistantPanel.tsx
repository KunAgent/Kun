import { useEffect, type ReactElement } from 'react'
import { BookOpen, Check, FileText, Loader2, Play, RotateCcw, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../../store/chat-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { normalizePath } from '../../../write/write-workspace-store-helpers'
import { usePaperBatchStore, PAPER_BATCH_MAX_PAPERS, paperBatchActive } from '../../../paper/paper-batch-store'
import { cancelPaperBatch, openPaperBatchArticle, openPaperBatchConversation, paperBatchLimited, preparePaperBatch, startPaperBatch } from '../../../paper/paper-batch-actions'
import type { PaperReadingPurpose } from '../../../paper/paper-reading-request'
import { PAPER_CONTEXT_MAX_CHARS } from '@shared/paper/paper-turn-context'

const control = 'w-full rounded-lg border border-ds-border-muted bg-ds-main px-3 py-2 text-xs text-ds-ink outline-none focus:border-accent'
const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-ds-border-muted px-3 py-2 text-xs text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-40'

/** One persistent host in the Work assistant; staging alone never submits. */
export function PaperBatchAssistantPanel({ providerId, model }: { providerId: string; model: string }): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const batch = usePaperBatchStore((state) => state.batch)
  const workspaceRoot = useWriteWorkspaceStore((state) => state.workspaceRoot)
  const busy = useChatStore((state) => state.busy)
  const runtimeConnection = useChatStore((state) => state.runtimeConnection)
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const currentTurnId = useChatStore((state) => state.currentTurnId)
  const id = batch?.id
  const itemCount = batch?.items.length ?? 0
  useEffect(() => { if (id) void preparePaperBatch(id) }, [id, itemCount])
  // Consent is for the model shown, not a later composer selection.
  useEffect(() => {
    const current = usePaperBatchStore.getState().batch
    if (current?.phase === 'setup') usePaperBatchStore.getState().update(current.id, { consent: false })
  }, [providerId, model])
  if (!batch) return null
  const active = paperBatchActive(batch)
  const setup = batch.phase === 'setup'
  const sameWorkspace = normalizePath(workspaceRoot) === normalizePath(batch.workspaceRoot)
  const provider = batch.providerId ?? providerId
  const selectedModel = batch.model ?? model
  const completed = batch.items.filter((item) => item.status === 'completed').length
  const remaining = batch.items.filter((item) => item.status !== 'completed').length
  const saveErrors = batch.items.some((item) => item.status === 'completed' && item.error)
  const ready = itemCount > 0 && itemCount <= PAPER_BATCH_MAX_PAPERS && batch.items.every((item) =>
    item.materialState === 'ready' && (batch.purpose === 'quick-screen' || !paperBatchLimited(item)))
  const update = (patch: Parameters<ReturnType<typeof usePaperBatchStore.getState>['update']>[1]): void =>
    usePaperBatchStore.getState().update(batch.id, { ...patch, consent: false })
  const resumesOwnedTurn = batch.threadId === activeThreadId && batch.items.some((item) => item.turnId && item.turnId === currentTurnId)
  const otherBusy = busy && !resumesOwnedTurn
  const canStart = runtimeConnection === 'ready' && !otherBusy && !active && sameWorkspace && ready && batch.consent && provider && selectedModel && selectedModel.toLowerCase() !== 'auto' && (remaining > 0 || saveErrors)
  return <section aria-label={t('paperBatchTitle')} data-testid="paper-batch-assistant" style={{ maxHeight: 'calc(100% - 1.5rem)' }} className="paper-batch-assistant mx-3 my-3 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-ds-border-muted">
    <header className="flex shrink-0 items-start gap-2.5 border-b border-ds-border-muted px-4 py-3">
      <BookOpen size={17} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-ds-ink">{t('paperBatchTitle')}</h3>
        <p className="mt-1 truncate text-xs text-ds-muted" title={`${batch.sourceLabel}\n${batch.workspaceRoot}`}>{batch.sourceLabel} · {t('paperBatchCount', { count: itemCount })}</p>
      </div>
      <button type="button" className="rounded-md p-1 text-ds-muted hover:bg-ds-hover disabled:opacity-30" aria-label={t('close')} disabled={active} onClick={() => usePaperBatchStore.getState().close()}><X size={15} /></button>
    </header>
    <div data-paper-batch-scroll className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
      {setup ? <p className="text-xs leading-relaxed text-ds-muted">{t('paperBatchSetupHint')}</p> : null}
      <ol className="paper-batch-sources max-h-44 space-y-1 overflow-y-auto rounded-lg border border-ds-border-muted p-2" aria-label={t('paperBatchSelected')}>
        {batch.items.map((item, index) => <li key={item.entry.unitDir} className="flex items-start gap-2 rounded-md p-1.5 text-xs">
          <span className="mt-0.5 w-4 shrink-0 text-ds-faint">{item.status === 'completed' ? <Check size={13} className="text-emerald-600" /> : item.status === 'running' || item.materialState === 'loading' ? <Loader2 size={13} className="animate-spin" /> : index + 1}</span>
          <div className="min-w-0 flex-1"><p className="break-words font-medium leading-relaxed text-ds-ink">{item.entry.meta.title || item.entry.unitDir}</p>
            <p className="mt-0.5 truncate text-[10px] text-ds-faint" title={item.entry.unitDir}>{item.entry.group || t('paperBatchLibraryRoot')} · {item.entry.meta.year || '—'}</p>
            <p className="mt-0.5 text-[10px] text-ds-muted">{t(`paperBatchStatus_${setup ? item.materialState : item.status}`)}{item.material ? ` · ${Math.min(item.material.sourceText.length, PAPER_CONTEXT_MAX_CHARS).toLocaleString()} ${t('paperBatchChars')}` : ''}</p>
            {item.material && paperBatchLimited(item) ? <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">{t('paperBatchLimited')}</p> : null}
            {item.outputPath ? <button type="button" disabled={!sameWorkspace} onClick={() => void openPaperBatchArticle(item.entry.unitDir)} className="mt-0.5 break-all text-left text-[10px] text-accent underline-offset-2 hover:underline disabled:opacity-40">{t('paperBatchSaved')}: {item.outputPath}</button> : null}
            {item.error ? <p role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-300">{item.error}</p> : null}
          </div>
          {setup ? <button type="button" className="shrink-0 rounded p-1 text-ds-muted hover:bg-ds-hover" aria-label={t('paperBatchRemove', { title: item.entry.meta.title })} onClick={() => usePaperBatchStore.getState().remove(item.entry.unitDir)}><X size={13} /></button> : null}
        </li>)}
      </ol>
      {itemCount > PAPER_BATCH_MAX_PAPERS ? <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{t('paperBatchLimit', { max: PAPER_BATCH_MAX_PAPERS })}</p> : null}
      {!itemCount ? <p className="text-xs text-ds-muted">{t('paperBatchEmpty')}</p> : null}
      {setup ? <>
        <label className="block space-y-1 text-xs text-ds-muted"><span>{t('paperBatchPurpose')}</span><select aria-label={t('paperBatchPurpose')} className={control} value={batch.purpose} onChange={(event) => update({ purpose: event.target.value as PaperReadingPurpose })}>
          {(['quick-screen', 'method-deep-read', 'reproduction-prep', 'review-critique'] as const).map((purpose) => <option key={purpose} value={purpose}>{t(`paperReading_${purpose}`)}</option>)}
        </select></label>
        <label className="block space-y-1 text-xs text-ds-muted"><span>{t('paperBatchQuestion')}</span><textarea className={control} rows={2} maxLength={4000} value={batch.question} onChange={(event) => update({ question: event.target.value })} placeholder={t('paperBatchQuestionPlaceholder')} /></label>
        <label className="block space-y-1 text-xs text-ds-muted"><span>{t('paperBatchDestination')}</span><select aria-label={t('paperBatchDestination')} className={control} value={batch.destination} onChange={(event) => update({ destination: event.target.value as 'conversation' | 'paper-files' })}>
          <option value="conversation">{t('paperBatchConversation')}</option><option value="paper-files">{t('paperBatchFiles')}</option>
        </select></label>
        {batch.destination === 'paper-files' ? <p className="text-[11px] leading-relaxed text-ds-muted">{t('paperBatchFilesHint')}</p> : null}
        {batch.items.some((item) => item.materialState === 'error') ? <button type="button" className={button} onClick={() => {
          for (const item of batch.items) if (item.materialState === 'error') usePaperBatchStore.getState().updateItem(batch.id, item.entry.unitDir, { materialState: 'waiting', error: undefined })
          update({ consent: false })
          void preparePaperBatch(batch.id)
        }}><RotateCcw size={12} />{t('paperBatchReload')}</button> : null}
      </> : <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-ds-muted" role="status"><span>{t(`paperBatchPhase_${batch.phase}`)}</span><span>{completed} / {itemCount}</span></div>
        <progress className="h-1.5 w-full accent-[var(--ds-accent)]" aria-label={t('paperBatchProgress')} max={Math.max(itemCount, 1)} value={completed} />
        <p className="text-[11px] text-ds-muted">{t(`paperReading_${batch.purpose}`)} · {t(batch.destination === 'paper-files' ? 'paperBatchFiles' : 'paperBatchConversation')}</p>
      </div>}
      <div data-testid="paper-batch-model" className="paper-batch-model-summary space-y-1.5 p-3 text-[11px] leading-relaxed text-ds-muted">
        <p className="break-words font-medium text-ds-ink">{t('paperBatchModel')}: {provider || '—'} / {selectedModel || '—'}</p>
        <p>{t('paperBatchCost', { count: remaining, max: PAPER_CONTEXT_MAX_CHARS.toLocaleString() })}</p>
        <p>{t('paperBatchPriceUnknown')}</p>
      </div>
      {!provider || !selectedModel || selectedModel.toLowerCase() === 'auto' ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('paperReadingFixedModel')}</p> : null}
      {batch.purpose !== 'quick-screen' && batch.items.some(paperBatchLimited) ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('paperReadingInsufficient')}</p> : null}
      {!active && runtimeConnection !== 'ready' ? <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{t('paperBatchRuntimeUnavailable')}</p> : null}
      {!active && otherBusy ? <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{t('paperBatchOtherBusy')}</p> : null}
      {!sameWorkspace ? <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{t('paperBatchWrongLibrary')}</p> : null}
      {batch.error ? <p role="alert" className="text-xs text-red-600 dark:text-red-300">{batch.error}</p> : null}
      {!active && (remaining > 0 || saveErrors) ? <label className="flex items-start gap-2 text-xs leading-relaxed text-ds-ink"><input type="checkbox" className="mt-0.5" checked={batch.consent} onChange={(event) => usePaperBatchStore.getState().update(batch.id, { consent: event.target.checked })} />{t('paperBatchConsent')}</label> : null}
    </div>
    <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-ds-border-muted px-4 py-3">
      {batch.threadId ? <button type="button" className={button} disabled={!sameWorkspace} onClick={() => void openPaperBatchConversation()}><FileText size={13} />{t('paperBatchResults')}</button> : null}
      {active ? <button type="button" className={button} disabled={batch.cancelRequested} onClick={cancelPaperBatch}><Square size={12} />{t(batch.cancelRequested ? 'paperBatchCanceling' : 'paperBatchCancel')}</button>
        : remaining > 0 || saveErrors ? <button type="button" data-testid="paper-batch-start" className={`${button} paper-batch-start`} disabled={!canStart} onClick={() => void startPaperBatch({ providerId: provider, model: selectedModel, language: i18n.language })}><Play size={13} />{t(setup ? 'paperBatchStart' : 'paperBatchRetry')}</button> : null}
    </footer>
  </section>
}
