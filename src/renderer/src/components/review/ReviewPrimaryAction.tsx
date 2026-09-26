import { useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { GitMerge, GitPullRequestArrow, Loader2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  TaskWorkspaceDiscardPreview,
  TaskWorkspaceIntegrateMode,
  TaskWorkspaceIntegratePreview,
  TaskWorkspaceIntegrateResponse,
  TaskWorkspaceRecord
} from '@shared/task-workspace'
import { getProvider } from '../../agent/registry'
import {
  discardWorkspace,
  integrateWorkspace,
  loadIntegratePreview,
  useReviewStore
} from '../../store/review-store'
import { IntegrateResultDialog } from './IntegrateResultDialog'

/** The single highlighted action (11 §7.1): merge first, patch second. */
export function reviewPrimaryMode(
  preview: TaskWorkspaceIntegratePreview | undefined
): TaskWorkspaceIntegrateMode | null {
  if (preview?.canMergeBranch) return 'merge-branch'
  if (preview?.canApplyPatch) return 'apply-patch'
  return null
}

/**
 * The review panel's lifecycle action row (docs/ade/11 §7.1): exactly one
 * highlighted primary action — merge-branch preferred, apply-patch next —
 * with discard always available as an outline button that only turns
 * destructive inside its confirmation dialog.
 */
export function ReviewPrimaryAction({
  binding
}: {
  binding: TaskWorkspaceRecord
}): ReactElement | null {
  const { t } = useTranslation('common')
  const workspaceId = binding.workspaceId
  const review = useReviewStore((s) => s.workspaces[workspaceId])
  const preview = review?.integratePreview
  const previewLoaded = review?.integratePreviewLoaded === true
  const pending = review?.actionPending
  const [result, setResult] = useState<{
    mode: TaskWorkspaceIntegrateMode
    response: TaskWorkspaceIntegrateResponse
  } | null>(null)
  const [discardPreview, setDiscardPreview] = useState<TaskWorkspaceDiscardPreview | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)

  useEffect(() => {
    if (!previewLoaded) void loadIntegratePreview(workspaceId)
  }, [workspaceId, previewLoaded])

  if (!['ready', 'captured', 'conflict'].includes(binding.state)) return null

  const primaryMode = reviewPrimaryMode(preview)

  const runIntegrate = (mode: TaskWorkspaceIntegrateMode): void => {
    void integrateWorkspace(workspaceId, mode).then((response) => {
      if (response) setResult({ mode, response })
    })
  }

  const openDiscard = (): void => {
    setDiscardOpen(true)
    void getProvider().previewTaskWorkspaceDiscard?.(workspaceId)
      .then(setDiscardPreview)
      .catch(() => setDiscardPreview({ uncommittedFiles: 0, unpushedCommits: 0 }))
  }

  const actionButton = (
    mode: TaskWorkspaceIntegrateMode,
    label: string,
    icon: ReactElement,
    enabled: boolean,
    blockReason?: string
  ): ReactElement => {
    const primary = mode === primaryMode
    return (
      <button
        key={mode}
        type="button"
        disabled={!enabled || pending === 'integrate'}
        title={blockReason}
        onClick={() => runIntegrate(mode)}
        className={`inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[11.5px] font-medium ${
          primary
            ? 'bg-sky-600 text-white hover:bg-sky-500'
            : 'border border-ds-border-muted text-ds-muted hover:text-ds-ink'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        data-primary={primary || undefined}
      >
        {pending === 'integrate' && primary
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          : icon}
        {label}
      </button>
    )
  }

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted px-3 py-1.5"
      data-testid="review-primary-action"
    >
      {actionButton(
        'merge-branch',
        t('reviewMergeBranch'),
        <GitMerge className="h-3.5 w-3.5" strokeWidth={1.8} />,
        preview?.canMergeBranch === true,
        preview?.mergeBlockReason
      )}
      {actionButton(
        'apply-patch',
        t('reviewApplyPatch'),
        <GitPullRequestArrow className="h-3.5 w-3.5" strokeWidth={1.8} />,
        preview?.canApplyPatch === true,
        preview?.applyBlockReason
      )}
      <div className="min-w-0 flex-1" />
      <button
        type="button"
        onClick={openDiscard}
        disabled={pending === 'discard'}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] border border-ds-border-muted px-2.5 text-[11.5px] font-medium text-ds-muted hover:text-ds-ink disabled:opacity-50"
      >
        {pending === 'discard'
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
        {t('reviewDiscard')}
      </button>

      {result ? (
        <IntegrateResultDialog
          binding={binding}
          mode={result.mode}
          response={result.response}
          onClose={() => setResult(null)}
        />
      ) : null}

      {discardOpen ? (
        <DiscardConfirmDialog
          preview={discardPreview}
          pending={pending === 'discard'}
          onConfirm={() => {
            void discardWorkspace(workspaceId).then(() => setDiscardOpen(false))
          }}
          onClose={() => setDiscardOpen(false)}
        />
      ) : null}
    </div>
  )
}

function DiscardConfirmDialog({
  preview,
  pending,
  onConfirm,
  onClose
}: {
  preview: TaskWorkspaceDiscardPreview | null
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/35" role="dialog" aria-label={t('reviewDiscardTitle')}>
      <div className="w-[340px] rounded-[12px] border border-ds-border bg-white p-4 shadow-xl dark:bg-ds-card">
        <div className="text-[13px] font-semibold text-ds-ink">{t('reviewDiscardTitle')}</div>
        <p className="mt-1.5 text-[12px] text-ds-muted">{t('reviewDiscardHint')}</p>
        {preview ? (
          <ul className="mt-2 space-y-0.5 text-[11.5px] text-ds-muted">
            {preview.uncommittedFiles > 0 ? (
              <li>{t('reviewDiscardUncommitted', { count: preview.uncommittedFiles })}</li>
            ) : null}
            {preview.unpushedCommits > 0 ? (
              <li>{t('reviewDiscardUnpushed', { count: preview.unpushedCommits })}</li>
            ) : null}
          </ul>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-[7px] border border-ds-border-muted px-3 text-[11.5px] text-ds-muted hover:text-ds-ink"
          >
            {t('reviewDiscardCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-red-600 px-3 text-[11.5px] font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} /> : null}
            {t('reviewDiscardConfirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
