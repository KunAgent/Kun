import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, GitCompare, Loader2, Paperclip, RefreshCw, Send, Square, X } from 'lucide-react'
import type { AttachmentReference } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { formatRuntimeError } from '../../lib/format-runtime-error'
import { createClientTurnRequestId } from '../../store/chat-store-thread-actions-support'
import { groupTurns, stableTurnKey } from '../chat/message-timeline-turns'
import { ConversationTurn } from '../chat/MessageTimeline'
import { TimelineFilePreviewWorkspaceProvider } from '../chat/timeline-file-preview-workspace'
import { InjectedMemoryLookupProvider } from '../chat/injected-memory-lookup'
import { AgentIcon } from '../agent-icon'
import type { WorkerRowData } from './worker-row-data'
import { sendWorkerLocalInput } from './worker-local-input'
import { uploadWorkerLocalAttachment } from './worker-local-attachment'
import { useWorkerTranscript } from './use-worker-transcript'

export type WorkerDraft = {
  text: string
  attachments: AttachmentReference[]
  /** Reused if admission was uncertain, so a retry cannot duplicate the turn. */
  requestId: string | null
}

export const EMPTY_WORKER_DRAFT: WorkerDraft = { text: '', attachments: [], requestId: null }

/** Explicitly scoped, read-only worker conversation inside the Workers panel. */
export function WorkerInspector({
  row,
  draft,
  updateDraft,
  onRefreshTeam,
  onClose,
  onFullOpen,
  scrollPositions
}: {
  row: WorkerRowData
  draft: WorkerDraft
  updateDraft: (workerId: string, update: (current: WorkerDraft) => WorkerDraft) => void
  onRefreshTeam: () => Promise<void>
  onClose: () => void
  onFullOpen: (workerId: string) => void
  scrollPositions: Map<string, number>
}): ReactElement {
  const { t } = useTranslation('common')
  const [visibleTurnCount, setVisibleTurnCount] = useState(3)
  const [controlOverride, setControlOverride] = useState<'manager' | 'user' | null>(null)
  const [actionBusy, setActionBusy] = useState<'send' | 'control' | 'stop' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{ status: 'queued' | 'sent'; position?: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const actionBusyRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const workerId = row.workerId
  const { detail, loading, error, loadingOlder, loadOlder, refresh } =
    useWorkerTranscript(workerId, row.activityRow?.updatedAt)

  useEffect(() => setControlOverride(null), [workerId, row.control])

  const control = controlOverride ?? row.control
  const available = row.state === 'active'
  const canSend = available && !actionBusy && !uploading &&
    Boolean(draft.text.trim() || draft.attachments.length)

  const controlWorker = async (action: 'take-over' | 'hand-back' | 'stop'): Promise<void> => {
    if (actionBusyRef.current) return
    const provider = getProvider()
    if (!provider.controlTeamWorker) {
      setActionError(t('workerInput.controlError', { defaultValue: 'Could not confirm worker control.' }))
      return
    }
    actionBusyRef.current = true
    setActionBusy(action === 'stop' ? 'stop' : 'control')
    setActionError(null)
    try {
      await provider.controlTeamWorker(workerId, action)
      if (action !== 'stop') setControlOverride(action === 'take-over' ? 'user' : 'manager')
      await onRefreshTeam()
      refresh()
    } catch (cause) {
      setActionError(formatRuntimeError(cause))
    } finally {
      actionBusyRef.current = false
      setActionBusy(null)
    }
  }

  const sendDraft = async (): Promise<void> => {
    if (actionBusyRef.current || !available) return
    const text = draft.text.trim()
    const attachmentIds = draft.attachments.map((attachment) => attachment.id.trim()).filter(Boolean)
    if (!text && attachmentIds.length === 0) return
    const clientRequestId = draft.requestId ?? createClientTurnRequestId()
    updateDraft(workerId, (current) => ({ ...current, requestId: clientRequestId }))
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
      updateDraft(workerId, (current) =>
        current.text === draft.text &&
        current.attachments.map((attachment) => attachment.id).join('|') === attachmentIds.join('|')
          ? EMPTY_WORKER_DRAFT
          : current
      )
      setReceipt({
        status: admission.status === 'queued' ? 'queued' : 'sent',
        ...(admission.queuedPosition !== undefined ? { position: admission.queuedPosition + 1 } : {})
      })
      refresh()
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
        updateDraft(workerId, (current) => ({
          ...current,
          attachments: [...current.attachments, attachment],
          requestId: null
        }))
      }
    } catch (cause) {
      setActionError(formatRuntimeError(cause))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = scrollPositions.get(workerId) ?? 0
    return () => {
      if (viewport) scrollPositions.set(workerId, viewport.scrollTop)
    }
  }, [workerId, scrollPositions])

  const allTurns = useMemo(() => detail ? groupTurns(detail.blocks) : [], [detail])
  const turns = allTurns.slice(-visibleTurnCount)
  const workspaceRoot = row.activityRow?.workspace.path ?? ''
  const liveReasoning = detail?.liveProjection?.reasoning?.text ?? ''
  const liveAssistant = detail?.liveProjection?.assistant?.text ?? ''
  const hasLive = Boolean(liveReasoning || liveAssistant)
  const visibleTurns = turns.length === 0 && hasLive ? [{ blocks: [] }] : turns

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-ds-border bg-ds-sidebar" data-worker-inspector={workerId}>
      <div className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted px-3 py-2">
        <AgentIcon harnessId={row.harnessId ?? 'unknown'} size={16} className="text-ds-muted" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-ds-ink">{row.label}</div>
          <div className="truncate text-[10.5px] text-ds-faint">
            {row.dispatchTitle ?? row.role ?? row.harnessId ?? ''}
          </div>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          aria-label={t('reviewRefresh')}
          className="rounded-md p-1 text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => onFullOpen(workerId)}
          aria-label={t('subagentOpenSession')}
          title={t('subagentOpenSession')}
          data-worker-full-open={workerId}
          className="rounded-md p-1 text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="rounded-md p-1 text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[11px] text-ds-muted">
        <span>{control === 'manager'
          ? t('workerBannerManaged', { label: row.label })
          : t('workerBannerUserControl', { label: row.label })}</span>
        {row.diffStats ? (
          <span className="inline-flex items-center gap-1" data-worker-preview-diff>
            <GitCompare className="h-3 w-3" strokeWidth={1.7} />
            {row.diffStats.changedFiles} · +{row.diffStats.insertions} −{row.diffStats.deletions}
          </span>
        ) : null}
      </div>
      <div
        ref={viewportRef}
        onScroll={(event) => scrollPositions.set(workerId, event.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-6 pt-2"
        data-worker-preview-timeline
        data-worker-preview-seq={detail?.latestSeq}
      >
        {loading && !detail ? (
          <div className="flex items-center gap-2 text-[12px] text-ds-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
            {t('workersLoading')}
          </div>
        ) : null}
        {detail && (allTurns.length > visibleTurnCount || detail.hasMoreHistory) ? (
          <button type="button" disabled={loadingOlder} onClick={() => {
            setVisibleTurnCount((count) => count + 10)
            if (visibleTurnCount >= allTurns.length) void loadOlder()
          }} className="mb-2 w-full rounded-md py-1 text-xs text-ds-muted hover:bg-ds-hover disabled:opacity-50">
            {loadingOlder ? t('workersLoading') : t('workerLoadEarlier')}
          </button>
        ) : null}
        {error ? <p role="alert" className="text-[12px] text-ds-status-danger">{error}</p> : null}
        {detail && visibleTurns.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-ds-faint">{t('sidePanelEmpty')}</p>
        ) : null}
        {detail ? (
          <TimelineFilePreviewWorkspaceProvider workspaceRoot={workspaceRoot} threadId={workerId}>
            <InjectedMemoryLookupProvider workspaceRoot={workspaceRoot}>
              <div className="flex flex-col gap-5">
                {visibleTurns.map((turn, index) => (
                  <ConversationTurn
                    key={stableTurnKey(turn, index)}
                    turn={turn}
                    threadId={workerId}
                    isProcessing={index === visibleTurns.length - 1 && hasLive}
                    liveReasoning={index === visibleTurns.length - 1 ? liveReasoning : ''}
                    live={index === visibleTurns.length - 1 ? liveAssistant : ''}
                    filePreviewWorkspaceRoot={workspaceRoot}
                    viewportRef={viewportRef}
                    compactCards
                    allowMainThreadActions={false}
                    allowRecoveryContinue={false}
                  />
                ))}
              </div>
            </InjectedMemoryLookupProvider>
          </TimelineFilePreviewWorkspaceProvider>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-ds-border-muted px-3 py-2" data-worker-local-composer={workerId}>
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[10.5px] text-ds-faint">
          <span>{t('workerInput.receiver', { name: row.label, defaultValue: `To: ${row.label}` })}</span>
          {available ? (
            <span className="inline-flex items-center gap-1">
              <button type="button" disabled={Boolean(actionBusy)} onClick={() => void controlWorker(control === 'manager' ? 'take-over' : 'hand-back')} className="rounded px-1.5 py-0.5 hover:bg-ds-hover disabled:opacity-50" data-worker-control-action>
                {control === 'manager' ? t('workerBannerTakeOver') : t('workerBannerHandBack')}
              </button>
              <button type="button" disabled={Boolean(actionBusy)} onClick={() => void controlWorker('stop')} className="rounded p-1 hover:bg-ds-hover disabled:opacity-50" aria-label={t('workersStop')} data-worker-stop-action>
                <Square className="h-3 w-3" strokeWidth={1.7} />
              </button>
            </span>
          ) : null}
        </div>
        {draft.attachments.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {draft.attachments.map((attachment) => (
              <span key={attachment.id} className="inline-flex max-w-full items-center gap-1 rounded bg-ds-hover px-1.5 py-0.5 text-[10.5px] text-ds-muted">
                <Paperclip className="h-3 w-3 shrink-0" />
                <span className="max-w-32 truncate">{attachment.name ?? attachment.id}</span>
                <button type="button" onClick={() => updateDraft(workerId, (current) => ({ ...current, attachments: current.attachments.filter((item) => item.id !== attachment.id), requestId: null }))} aria-label={t('workerInput.removeAttachment', { defaultValue: 'Remove attachment' })} className="rounded hover:text-ds-ink">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          value={draft.text}
          onChange={(event) => updateDraft(workerId, (current) => ({ ...current, text: event.target.value, requestId: null }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void sendDraft()
            }
          }}
          rows={2}
          disabled={!available}
          placeholder={t('workerInput.placeholder', { name: row.label, defaultValue: `Message ${row.label}…` })}
          className="w-full resize-none rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] leading-5 text-ds-ink placeholder:text-ds-faint focus:border-accent/50 focus:outline-none disabled:opacity-60"
          data-worker-draft={workerId}
        />
        <div className="mt-1 flex items-center gap-2">
          <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.xml" className="hidden" onChange={(event) => void uploadFiles(event.currentTarget.files)} />
          <button type="button" disabled={!available || uploading} onClick={() => fileInputRef.current?.click()} aria-label={t('workerInput.upload', { defaultValue: 'Add attachment' })} className="rounded-md p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          </button>
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-ds-faint">
            {actionError ?? (receipt?.status === 'queued'
              ? t('workerInput.queued', { position: receipt.position ?? 1, defaultValue: `Queued · position ${receipt.position ?? 1}` })
              : receipt?.status === 'sent' ? t('workerInput.sent', { defaultValue: 'Sent' }) : '')}
          </span>
          <button type="button" disabled={!canSend} onClick={() => void sendDraft()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-45" data-worker-send={workerId}>
            {actionBusy === 'send' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {actionBusy === 'send'
              ? t('workerInput.sending', { defaultValue: 'Sending…' })
              : control === 'manager'
                ? t('workerInput.takeOverAndSend', { defaultValue: 'Take over and send' })
                : row.bucket === 'working'
                  ? t('workerInput.queue', { defaultValue: 'Queue' })
                  : t('workerInput.send', { defaultValue: 'Send' })}
          </button>
        </div>
      </div>
    </section>
  )
}
