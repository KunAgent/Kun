import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { GitBranch, ListTree, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import {
  ensureThreadBinding,
  loadReviewComments,
  loadWorkspaceDiff,
  setReviewViewMode,
  unwatchReviewWorkspace,
  useReviewStore,
  watchReviewWorkspace,
  type ReviewViewMode
} from '../../store/review-store'
import { ReviewFileTree } from './ReviewFileTree'
import { ReviewDiffBlock } from './ReviewDiffBlock'
import { ReviewPrimaryAction } from './ReviewPrimaryAction'
import { ChangeRequestPanel } from './ChangeRequestPanel'
import { ReviewSendMenu } from './ReviewSendMenu'

/**
 * ADE review surface (docs/ade/11 §3): workspace header on top, then a
 * directory file tree beside the per-file diff blocks. The primary action
 * row is reserved for P1-19's integrate controls.
 */
export function ReviewPanel({ className }: { className?: string }): ReactElement {
  const { t } = useTranslation('common')
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const binding = useReviewStore((s) =>
    activeThreadId ? s.bindings[activeThreadId] : undefined)
  const workspaceId = binding?.workspaceId
  const review = useReviewStore((s) =>
    workspaceId ? s.workspaces[workspaceId] : undefined)
  const [treeOpen, setTreeOpen] = useState(true)

  useEffect(() => {
    if (activeThreadId) void ensureThreadBinding(activeThreadId)
  }, [activeThreadId])

  useEffect(() => {
    if (workspaceId && !review?.files.length && !review?.loading) {
      void loadWorkspaceDiff(workspaceId)
    }
    if (workspaceId && !review?.commentsLoaded) {
      void loadReviewComments(workspaceId)
    }
  }, [workspaceId, review?.files.length, review?.loading, review?.commentsLoaded])

  // Live refresh: settled work on the bound unit reloads the diff (11 §4.4).
  useEffect(() => {
    if (!workspaceId) return
    watchReviewWorkspace(workspaceId)
    return () => unwatchReviewWorkspace(workspaceId)
  }, [workspaceId])

  const viewMode = review?.viewMode ?? 'unified'
  const modeButton = (mode: ReviewViewMode, label: string): ReactElement => (
    <button
      type="button"
      onClick={() => workspaceId && setReviewViewMode(workspaceId, mode)}
      className={`rounded px-2 py-1 text-[11px] ${
        viewMode === mode ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
      }`}
    >
      {label}
    </button>
  )
  const shortSha = useMemo(() => binding?.baseRevision?.slice(0, 8), [binding?.baseRevision])

  return (
    <div className={`flex h-full min-h-0 flex-col bg-ds-sidebar ${className ?? ''}`}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-ds-border-muted px-3">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ds-ink">
          {binding?.label ?? binding?.branch ?? binding?.workspaceId ?? ''}
        </span>
        {shortSha ? (
          <span className="shrink-0 font-mono text-[10.5px] text-ds-faint">@{shortSha}</span>
        ) : null}
        {binding ? (
          <span className="shrink-0 rounded-full bg-ds-hover px-2 py-0.5 text-[10.5px] text-ds-muted">
            {binding.state}
          </span>
        ) : null}
        {binding ? <ReviewSendMenu binding={binding} /> : null}
        <div className="ml-1 flex shrink-0 items-center rounded-[7px] border border-ds-border-muted p-0.5">
          {modeButton('unified', t('reviewUnified'))}
          {modeButton('split', t('reviewSplit'))}
        </div>
        <button
          type="button"
          onClick={() => workspaceId && void loadWorkspaceDiff(workspaceId)}
          aria-label={t('reviewRefresh')}
          title={t('reviewRefresh')}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => setTreeOpen((v) => !v)}
          aria-label={t('rightPanelFiles')}
          title={t('rightPanelFiles')}
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] ${
            treeOpen ? 'text-ds-ink' : 'text-ds-faint'
          } hover:bg-ds-hover`}
        >
          <ListTree className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>

      {binding ? <ReviewPrimaryAction binding={binding} /> : null}
      {binding ? <ChangeRequestPanel binding={binding} /> : null}

      {!binding ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-ds-muted">
          {binding === null ? t('reviewNoWorkspace') : t('reviewLoading')}
        </div>
      ) : review?.error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-red-600 dark:text-red-400">
          {t('reviewLoadError')}: {review.error}
        </div>
      ) : review?.loading && !review.files.length ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-ds-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('reviewLoading')}
        </div>
      ) : !review?.files.length ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-ds-muted">
          {t('reviewEmpty')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {treeOpen ? (
            <div className="w-44 shrink-0 overflow-hidden border-r border-ds-border-muted max-[800px]:w-32">
              <ReviewFileTree files={review.files} />
            </div>
          ) : null}
          <div className="min-w-0 flex-1 overflow-y-auto">
            {review.files.map((file) => (
              <ReviewDiffBlock key={file.path} workspaceId={binding.workspaceId} file={file} />
            ))}
            {/* 11 §6: attribution is best-effort — only Kun-observable writes. */}
            <div className="px-3 py-2 text-[10.5px] text-ds-faint">
              {t('reviewAttributionNote')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
