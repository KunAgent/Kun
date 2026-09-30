import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReviewSendTarget } from '@shared/review-comment'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'
import {
  sendReviewBatch,
  useReviewStore
} from '../../store/review-store'
import { useChatStore } from '../../store/chat-store'
import { buildReviewRequestAttachment } from '../../agent/review-composer-context'

type TargetChoice = 'worker' | 'manager' | 'new-worker'

/**
 * "N 条待发送 · 发送给…" header control (docs/ade/11 §4.4): batches all
 * unresolved comments into one revision request — to the worker that owns
 * the workspace, the manager thread's composer, or a fresh worker reusing
 * the same task workspace.
 */
export function ReviewSendMenu({
  binding
}: {
  binding: TaskWorkspaceRecord
}): ReactElement | null {
  const { t } = useTranslation('common')
  const workspaceId = binding.workspaceId
  const review = useReviewStore((s) => s.workspaces[workspaceId])
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<TargetChoice>('worker')
  const [note, setNote] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const submitting = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const pendingCount = useMemo(
    () => (review?.comments ?? []).filter((c) => c.state !== 'resolved').length,
    [review?.comments]
  )
  const workerId = binding.unitId
  const canWorker = Boolean(workerId)
  const effectiveTarget: TargetChoice = target === 'worker' && !canWorker ? 'manager' : target
  const sending = review?.sending === true
  const busy = sending || review?.loading === true
  const lastSent = review?.lastSent
  const targetLabel = (kind: TargetChoice): string =>
    kind === 'worker'
      ? t('reviewSendWorker')
      : kind === 'manager'
        ? t('reviewSendManager')
        : t('reviewSendNewWorker')

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const send = async (): Promise<void> => {
    if (submitting.current || busy) return
    submitting.current = true
    setLocalError(null)
    const origin = useChatStore.getState()
    const originThreadId = origin.activeThreadId
    const originRoute = origin.route
    try {
      const sendTarget: ReviewSendTarget =
        effectiveTarget === 'worker'
          ? { kind: 'worker', workerId: workerId! }
          : effectiveTarget === 'manager'
            ? { kind: 'manager' }
            : { kind: 'new-worker' }
      const response = await sendReviewBatch(workspaceId, sendTarget, note.trim() || undefined)
      if (!response) return
      setOpen(false)
      setNote('')
      // Manager target: pin the rendered request on the owner thread's composer
      // so it attaches to the user's next message as a review card (11 §4.4).
      if (response.composerContext) {
        const chat = useChatStore.getState()
        const workspaceRoot = chat.threads.find((thread) => thread.id === binding.ownerThreadId)?.workspace ?? binding.sourceRoot
        const attachment = await buildReviewRequestAttachment({
          workspaceRoot,
          response,
          commentCount: response.request.commentIds.length
        })
        const stillInScope = (): boolean => {
          const current = useChatStore.getState()
          return current.route === originRoute &&
            (current.activeThreadId === originThreadId || current.activeThreadId === binding.ownerThreadId)
        }
        if (!stillInScope()) { setLocalError(t('reviewManagerPreparedElsewhere')); return }
        if (chat.activeThreadId !== binding.ownerThreadId) {
          await chat.selectThread(binding.ownerThreadId, { selectionGuard: stillInScope })
        }
        if (!stillInScope() || useChatStore.getState().activeThreadId !== binding.ownerThreadId) return
        if (attachment) {
          useChatStore.getState().attachComposerContext({
            attachment,
            workspaceRoot,
            threadId: binding.ownerThreadId
          })
        }
      }
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      submitting.current = false
    }
  }

  if (!review?.commentsLoaded) return null
  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      {pendingCount > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          className="flex items-center gap-1 rounded-[7px] border border-ds-border-muted px-2 py-1 text-[11px] text-ds-ink hover:bg-ds-hover disabled:opacity-50"
        >
          <Send className="h-3 w-3" strokeWidth={1.8} />
          {t('reviewSendPending', { count: pendingCount })} · {t('reviewSendTo')}
          <ChevronDown className="h-3 w-3 text-ds-faint" />
        </button>
      ) : null}
      {sending ? (
        <span className="text-[10.5px] text-ds-faint">{t('reviewSendSending')}</span>
      ) : null}
      {(localError || review?.sendError) ? (
        <span className="max-w-40 truncate text-[10.5px] text-red-600 dark:text-red-400">
          {t('reviewSendFailed')}: {localError || review?.sendError}
        </span>
      ) : lastSent ? (
        <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400">
          {lastSent.targetKind === 'manager' ? t('reviewManagerPrepared', { round: lastSent.round }) : t('reviewSendDone', {
            target: targetLabel(lastSent.targetKind as TargetChoice),
            round: lastSent.round
          })}
        </span>
      ) : null}
      {open ? (
        <div role="dialog" aria-label={t('reviewSendTo')} className="absolute right-0 top-8 z-20 w-64 rounded-[10px] border border-ds-border-muted bg-ds-card p-2 shadow-lg">
          <p className="mb-1 break-all px-1 text-[10.5px] text-ds-muted">
            {binding.label || binding.branch || binding.workspaceId} · {review.revision?.contentHash?.slice(0, 8) || t('reviewRevision_unknown')}
          </p>
          {(['worker', 'manager', 'new-worker'] as const).map((kind) => (
            <label
              key={kind}
              className={`flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-[12px] ${
                kind === 'worker' && !canWorker
                  ? 'cursor-not-allowed text-ds-faint'
                  : 'cursor-pointer text-ds-ink hover:bg-ds-hover'
              }`}
            >
              <input
                type="radio"
                name="review-send-target"
                disabled={busy || (kind === 'worker' && !canWorker)}
                checked={effectiveTarget === kind}
                onChange={() => setTarget(kind)}
                className="accent-sky-600"
              />
              {targetLabel(kind)}
            </label>
          ))}
          <textarea
            disabled={busy}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder={t('reviewSendNotePlaceholder')}
            className="mt-1 w-full resize-none rounded-[6px] border border-ds-border-muted bg-ds-sidebar px-2 py-1.5 text-[12px] text-ds-ink outline-none focus:border-sky-500/60"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void send()}
            className="mt-1.5 w-full rounded-[7px] bg-sky-600 py-1 text-[12px] font-medium text-white hover:bg-sky-500"
          >
            {t('reviewSendSubmit')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
