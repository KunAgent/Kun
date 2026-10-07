import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Layers, Shield, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../../store/chat-store'
import type { PaperReadingPurpose } from '../../../paper/paper-reading-request'
import {
  paperSessionIds,
  startPaperBatchInterpret,
  usePaperBatchInterpret,
  type PaperBatchPaper
} from '../../../paper/paper-batch-interpret'
import { openPaperSession } from '../../../paper/paper-session-open'
import { evidenceInput, evidencePrimaryButton } from '../evidence/PaperEvidencePane'

const PURPOSES: readonly PaperReadingPurpose[] = ['quick-screen', 'method-deep-read', 'reproduction-prep', 'review-critique']
const LISTED = 8

export function PaperBatchInterpretDialogHost(): ReactElement | null {
  const request = usePaperBatchInterpret((state) => state.request)
  const close = usePaperBatchInterpret((state) => state.closeDialog)
  if (!request) return null
  return <PaperBatchInterpretDialog workspaceRoot={request.workspaceRoot} papers={request.papers} onClose={close} />
}

/**
 * Confirmation for a batch: the reading purpose, whether papers that were
 * already read are skipped, and one explicit provider disclosure. Each paper
 * then gets its own session, interpreted in the background.
 */
export function PaperBatchInterpretDialog({ workspaceRoot, papers, onClose }: {
  workspaceRoot: string
  papers: PaperBatchPaper[]
  onClose: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [purpose, setPurpose] = useState<PaperReadingPurpose>('quick-screen')
  const [skipExisting, setSkipExisting] = useState(true)
  const [consent, setConsent] = useState(false)
  const providerId = useChatStore((state) => state.composerProviderId)
  const model = useChatStore((state) => state.composerModel)
  const running = usePaperBatchInterpret((state) => Boolean(state.job?.running))
  const alreadyRead = useMemo(
    () => papers.filter((paper) => paperSessionIds(workspaceRoot, paper.unitDir).length > 0).length,
    [papers, workspaceRoot]
  )
  const queued = skipExisting ? papers.length - alreadyRead : papers.length
  const fixedModel = Boolean(providerId && model && model.toLowerCase() !== 'auto')
  const canStart = consent && fixedModel && queued > 0 && !running

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const start = (): void => {
    if (!canStart) return
    void startPaperBatchInterpret({
      workspaceRoot,
      papers,
      purpose,
      skipExisting,
      providerId,
      model,
      language: i18n.language,
      t,
      onOpenSession: (threadId, unitDir) => void openPaperSession(workspaceRoot, threadId, unitDir)
    })
  }

  return (
    <div className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={t('paperBatchTitle', { count: papers.length })}
        data-testid="paper-batch-dialog" onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card text-ds-ink shadow-2xl">
        <header className="flex items-start gap-3 border-b border-ds-border-muted px-6 py-5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-tint/10 text-accent">
            <Layers size={18} strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight">{t('paperBatchTitle', { count: papers.length })}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ds-muted">{t('paperBatchSubtitle')}</p>
          </div>
          <button type="button" aria-label={t('close')} onClick={onClose}
            className="rounded-lg p-2 text-ds-muted transition hover:bg-ds-subtle hover:text-ds-ink">
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <label className="block text-xs text-ds-muted">{t('paperReadingOpen')}
            <select aria-label={t('paperReadingOpen')} className={evidenceInput} value={purpose}
              onChange={(event) => setPurpose(event.target.value as PaperReadingPurpose)}>
              {PURPOSES.map((value) => <option key={value} value={value}>{t(`paperReading_${value}`)}</option>)}
            </select>
          </label>
          {purpose !== 'quick-screen' ? (
            <p className="text-xs leading-relaxed text-ds-muted">{t('paperBatchDeepHint')}</p>
          ) : null}
          <ul className="space-y-1 rounded-xl border border-ds-border-muted bg-ds-subtle/50 px-3 py-2.5 text-[12.5px]">
            {papers.slice(0, LISTED).map((paper) => {
              const read = paperSessionIds(workspaceRoot, paper.unitDir).length > 0
              return (
                <li key={paper.unitDir} className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={paper.meta.title}>{paper.meta.title}</span>
                  {read ? <span className="shrink-0 text-[11px] text-ds-faint">{t('paperBatchAlreadyRead')}</span> : null}
                </li>
              )
            })}
            {papers.length > LISTED ? (
              <li className="text-[11.5px] text-ds-faint">{t('paperBatchMore', { count: papers.length - LISTED })}</li>
            ) : null}
          </ul>
          {alreadyRead > 0 ? (
            <label className="flex items-center gap-2 text-[12.5px] text-ds-ink">
              <input type="checkbox" checked={skipExisting} onChange={(event) => setSkipExisting(event.target.checked)} />
              {t('paperBatchSkipExisting', { count: alreadyRead })}
            </label>
          ) : null}
          <fieldset className="space-y-2 rounded-xl border border-ds-border-muted p-4">
            <legend className="px-1 text-xs font-medium text-ds-muted">
              <span className="inline-flex items-center gap-1.5"><Shield size={13} />{t('paperReadingScope')}</span>
            </legend>
            <p className="text-xs leading-relaxed text-ds-muted">
              {t('paperBatchDisclosure', { provider: providerId || '—', model: model || '—', count: queued })}
            </p>
            <label className="flex items-center gap-2 text-[12.5px] text-ds-ink">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}
                data-testid="paper-batch-consent" />
              {t('paperBatchConsent')}
            </label>
          </fieldset>
          {!fixedModel ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('paperReadingFixedModel')}</p> : null}
          {running ? <p className="text-xs text-amber-700 dark:text-amber-300">{t('paperBatchBusy')}</p> : null}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-ds-border-muted bg-ds-subtle/40 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink">
            {t('writeEntryDialogCancel')}
          </button>
          <button type="button" data-testid="paper-batch-start" className={`${evidencePrimaryButton} px-4 py-2.5`}
            disabled={!canStart} onClick={start}>
            {t('paperBatchStart', { count: queued })}
          </button>
        </footer>
      </section>
    </div>
  )
}
