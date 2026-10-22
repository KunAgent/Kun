import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, HandMetal, Loader2, Lock, Paperclip, Undo2, Users, X } from 'lucide-react'
import { getProvider } from '../../agent/registry'
import { formatRuntimeError } from '../../lib/format-runtime-error'
import { createClientTurnRequestId } from '../../store/chat-store-thread-actions-support'
import type { WorkerRowData } from './worker-row-data'
import { sendWorkerLocalInput } from './worker-local-input'
import { uploadWorkerLocalAttachment } from './worker-local-attachment'
import { EMPTY_WORKER_DRAFT, type WorkerDraft } from './worker-view-store'
import { WorkerQuestionCard } from './WorkerParts'

/**
 * Worker tab composer. Sending takes the worker over from the manager
 * first (the host acknowledges control before admission); an open question
 * docks on top and the composer then answers it without taking over.
 */
export function WorkerComposer({
  row,
  draft,
  updateDraft,
  answerBusy,
  onAnswer,
  onRefreshTeam,
  onSent
}: {
  row: WorkerRowData
  draft: WorkerDraft
  updateDraft: (update: (current: WorkerDraft) => WorkerDraft) => void
  answerBusy: boolean
  onAnswer: (questionId: string, answer: string) => void
  onRefreshTeam: () => Promise<void>
  onSent: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const workerId = row.workerId
  const [controlOverride, setControlOverride] = useState<'manager' | 'user' | null>(null)
  const [actionBusy, setActionBusy] = useState<'send' | 'control' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{ status: 'queued' | 'sent'; position?: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const actionBusyRef = useRef(false)

  useEffect(() => setControlOverride(null), [workerId, row.control])

  const control = controlOverride ?? row.control
  const question = row.openQuestion
  const available = row.state === 'active' && !row.child
  const hasInput = Boolean(draft.text.trim() || (!question && draft.attachments.length))
  const canSend = available && !actionBusy && !uploading && hasInput && !(question && answerBusy)

  if (!available) {
    return (
      <div className="shrink-0 px-3 pb-3" data-worker-local-composer={workerId} data-worker-composer-locked>
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-ds-border px-3 py-3 text-[12px] text-ds-faint">
          <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {row.child ? t('workerTab.childReadOnly') : t('workerTab.releasedReadOnly')}
        </div>
      </div>
    )
  }

  const controlWorker = async (action: 'take-over' | 'hand-back'): Promise<void> => {
    if (actionBusyRef.current) return
    const provider = getProvider()
    if (!provider.controlTeamWorker) {
      setActionError(t('workerInput.controlError'))
      return
    }
    actionBusyRef.current = true
    setActionBusy('control')
    setActionError(null)
    try {
      await provider.controlTeamWorker(workerId, action)
      setControlOverride(action === 'take-over' ? 'user' : 'manager')
      await onRefreshTeam()
    } catch (cause) {
      setActionError(formatRuntimeError(cause))
    } finally {
      actionBusyRef.current = false
      setActionBusy(null)
    }
  }

  const sendDraft = async (): Promise<void> => {
    if (actionBusyRef.current) return
    const text = draft.text.trim()
    if (question) {
      if (!text || answerBusy) return
      onAnswer(question.questionId, text)
      updateDraft((current) => ({ ...current, text: '', requestId: null }))
      return
    }
    const attachmentIds = draft.attachments.map((attachment) => attachment.id.trim()).filter(Boolean)
    if (!text && attachmentIds.length === 0) return
    const clientRequestId = draft.requestId ?? createClientTurnRequestId()
    updateDraft((current) => ({ ...current, requestId: clientRequestId }))
    actionBusyRef.current = true
    setActionBusy('send')
    setActionError(null)
    setReceipt(null)
    try {
      const admission = await sendWorkerLocalInput({
        provider: getProvider(),
        workerId,
        text,
        attachmentIds,
        clientRequestId,
        onControlAcquired: () => {
          setControlOverride('user')
          void onRefreshTeam()
        }
      })
      updateDraft((current) =>
        current.text === draft.text &&
        current.attachments.map((attachment) => attachment.id).join('|') === attachmentIds.join('|')
          ? EMPTY_WORKER_DRAFT
          : current
      )
      setReceipt({
        status: admission.status === 'queued' ? 'queued' : 'sent',
        ...(admission.queuedPosition !== undefined ? { position: admission.queuedPosition + 1 } : {})
      })
      onSent()
      await onRefreshTeam()
    } catch (cause) {
      setActionError(formatRuntimeError(cause))
    } finally {
      actionBusyRef.current = false
      setActionBusy(null)
    }
  }

  const uploadFiles = async (files: FileList | null): Promise<void> => {
    if (!files?.length || uploading) return
    setUploading(true)
    setActionError(null)
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadWorkerLocalAttachment(file, workerId)
        updateDraft((current) => ({ ...current, attachments: [...current.attachments, attachment], requestId: null }))
      }
    } catch (cause) {
      setActionError(formatRuntimeError(cause))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const sendLabel = actionBusy === 'send'
    ? t('workerInput.sending')
    : question
      ? t('workersQuestion.answer')
      : control === 'manager'
        ? t('workerInput.takeOverAndSend')
        : row.bucket === 'working'
          ? t('workerInput.queue')
          : t('workerInput.send')
  const status = actionError
    ? { text: actionError, danger: true }
    : receipt
      ? { text: receipt.status === 'queued' ? t('workerInput.queued', { position: receipt.position ?? 1 }) : t('workerInput.sent'), danger: false }
      : question
        ? null
        : control === 'manager'
          ? { text: t('workerComposer.takeOverHint'), danger: false }
          : null

  return (
    <div className="shrink-0 px-3 pb-3" data-worker-local-composer={workerId}>
      <div
        className="ds-worker-composer overflow-hidden rounded-[14px] border border-ds-border bg-ds-card shadow-[0_1px_2px_rgba(32,36,45,0.05),0_3px_10px_rgba(32,36,45,0.05)]"
        data-question={question ? true : undefined}
      >
        {question ? (
          <WorkerQuestionCard question={question} busy={answerBusy} onAnswer={onAnswer} variant="header" workerLabel={row.label} />
        ) : null}
        <div className="flex flex-col gap-1.5 pb-2 pl-3 pr-2 pt-2.5">
          {!question && draft.attachments.length ? (
            <div className="flex flex-wrap gap-1">
              {draft.attachments.map((attachment) => (
                <span key={attachment.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-ds-subtle px-1.5 py-0.5 text-[11px] text-ds-muted">
                  <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="max-w-32 truncate">{attachment.name ?? attachment.id}</span>
                  <button
                    type="button"
                    onClick={() => updateDraft((current) => ({ ...current, attachments: current.attachments.filter((item) => item.id !== attachment.id), requestId: null }))}
                    aria-label={t('workerInput.removeAttachment')}
                    className="rounded hover:text-ds-ink"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            value={draft.text}
            onChange={(event) => updateDraft((current) => ({ ...current, text: event.target.value, requestId: null }))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void sendDraft()
              }
            }}
            rows={2}
            aria-label={question ? t('workersQuestion.answerPlaceholder') : t('workerInput.placeholder', { name: row.label })}
            placeholder={question ? t('workersQuestion.answerPlaceholder') : t('workerInput.placeholder', { name: row.label })}
            className="w-full resize-none bg-transparent text-[13px] leading-[1.55] text-ds-ink outline-none placeholder:text-ds-faint"
            data-worker-draft={workerId}
          />
          <div className="flex min-w-0 items-center gap-1.5">
            {!question ? (
              <>
                <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.xml" className="hidden" onChange={(event) => void uploadFiles(event.currentTarget.files)} />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={t('workerInput.upload')}
                  title={t('workerInput.upload')}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Paperclip className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
                </button>
                <button
                  type="button"
                  disabled={Boolean(actionBusy)}
                  onClick={() => void controlWorker(control === 'manager' ? 'take-over' : 'hand-back')}
                  title={control === 'manager' ? t('workerComposer.takeOverTitle') : t('workerComposer.handBackTitle')}
                  className="ds-worker-control-chip inline-flex h-6 min-w-0 items-center gap-[5px] rounded-full bg-ds-subtle px-2.5 text-[11.5px] font-medium text-ds-muted transition hover:text-ds-ink disabled:opacity-50"
                  data-control={control}
                  data-worker-control-action
                >
                  {control === 'manager'
                    ? <Users className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                    : <Undo2 className="h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden />}
                  <span className="truncate">{control === 'manager' ? t('workerComposer.managed') : t('workerComposer.handBack')}</span>
                </button>
              </>
            ) : (
              <span className="min-w-0 truncate px-1 text-[11.5px] text-ds-faint">{t('workersQuestion.answerHint')}</span>
            )}
            <span className="flex-1" />
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void sendDraft()}
              className={`inline-flex h-[30px] shrink-0 items-center gap-[5px] rounded-[9px] px-3 text-[12.5px] font-semibold text-white transition hover:opacity-90 disabled:opacity-45 ${
                question ? 'ds-worker-answer-button' : 'bg-accent'
              }`}
              data-worker-send={workerId}
            >
              {actionBusy === 'send'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                : control === 'manager' && !question
                  ? <HandMetal className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                  : <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />}
              {sendLabel}
            </button>
          </div>
        </div>
      </div>
      {status ? (
        <p
          role={status.danger ? 'alert' : undefined}
          className={`mt-1.5 truncate px-1 text-[11px] ${status.danger ? 'text-ds-status-danger' : 'text-ds-faint'}`}
          title={status.text}
        >
          {status.text}
        </p>
      ) : null}
    </div>
  )
}
