import { useEffect, useRef, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { parsePatch } from 'diff'
import { MergeView } from '@codemirror/merge'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import type { TaskWorkspaceDiffFile } from '@shared/task-workspace'
import {
  loadWorkspaceDiffFile,
  REVIEW_LARGE_FILE_LINES,
  toggleReviewFileExpanded,
  useReviewStore
} from '../../store/review-store'

const readOnlyExtensions = [
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
  lineNumbers(),
  EditorView.lineWrapping
]

function ReviewSplitMerge({ oldText, newText }: { oldText: string; newText: string }): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new MergeView({
      a: { doc: oldText, extensions: readOnlyExtensions },
      b: { doc: newText, extensions: readOnlyExtensions },
      parent: host,
      collapseUnchanged: { margin: 3, minSize: 4 },
      highlightChanges: true,
      gutter: false
    })
    return () => view.destroy()
  }, [oldText, newText])
  return <div ref={hostRef} className="ds-review-split min-h-0 text-[12px]" />
}

type UnifiedLine = { oldNo: number | null; newNo: number | null; text: string; tone: 'add' | 'del' | 'ctx' }

function unifiedLines(patch: string): { hunks: { header: string; lines: UnifiedLine[] }[] } {
  const [parsed] = parsePatch(patch)
  const hunks = (parsed?.hunks ?? []).map((hunk) => {
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    const lines: UnifiedLine[] = []
    for (const raw of hunk.lines) {
      const tag = raw[0]
      if (tag === '+') lines.push({ oldNo: null, newNo: newNo++, text: raw.slice(1), tone: 'add' })
      else if (tag === '-') lines.push({ oldNo: oldNo++, newNo: null, text: raw.slice(1), tone: 'del' })
      else if (tag === '\\') continue
      else lines.push({ oldNo: oldNo++, newNo: newNo++, text: raw.slice(1), tone: 'ctx' })
    }
    return { header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, lines }
  })
  return { hunks }
}

function UnifiedPatch({ patch }: { patch: string }): ReactElement {
  const { hunks } = unifiedLines(patch)
  return (
    <div className="overflow-x-auto font-mono text-[12px] leading-5">
      {hunks.map((hunk, index) => (
        <div key={index}>
          <div className="px-3 py-1 text-ds-faint bg-ds-hover/40 select-none">{hunk.header}</div>
          {hunk.lines.map((line, i) => (
            <div
              key={i}
              className={`flex whitespace-pre ${
                line.tone === 'add'
                  ? 'bg-emerald-500/10'
                  : line.tone === 'del'
                    ? 'bg-red-500/10'
                    : ''
              }`}
            >
              <span className="w-10 shrink-0 select-none pr-2 text-right text-ds-faint">
                {line.oldNo ?? ''}
              </span>
              <span className="w-10 shrink-0 select-none pr-2 text-right text-ds-faint border-r border-ds-border-muted">
                {line.newNo ?? ''}
              </span>
              <span className="pl-2 pr-3 min-w-0">
                {line.tone === 'add' ? '+ ' : line.tone === 'del' ? '- ' : '  '}
                {line.text}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

const STATUS_TONE: Record<TaskWorkspaceDiffFile['status'], string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  modified: 'text-ds-muted',
  deleted: 'text-red-600 dark:text-red-400',
  renamed: 'text-amber-600 dark:text-amber-400'
}

export function ReviewDiffBlock({
  workspaceId,
  file
}: {
  workspaceId: string
  file: TaskWorkspaceDiffFile
}): ReactElement {
  const { t } = useTranslation('common')
  const wrapRef = useRef<HTMLDivElement>(null)
  const changedLines = file.insertions + file.deletions
  const review = useReviewStore((s) => s.workspaces[workspaceId])
  const entry = review?.details[file.path]
  const viewMode = review?.viewMode ?? 'unified'
  const expanded = review?.expandedPaths[file.path] ?? (!file.tooLarge && changedLines <= REVIEW_LARGE_FILE_LINES)

  // Lazy: fetch the file payload only once the block scrolls into view (11 §3).
  useEffect(() => {
    if (!expanded || entry?.detail || entry?.loading) return
    const node = wrapRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      void loadWorkspaceDiffFile(workspaceId, file.path)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect()
        void loadWorkspaceDiffFile(workspaceId, file.path)
      }
    }, { rootMargin: '200px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [workspaceId, file.path, expanded, entry?.detail, entry?.loading])

  const detail = entry?.detail
  return (
    <div
      ref={wrapRef}
      id={`review-file-${encodeURIComponent(file.path)}`}
      className="border-b border-ds-border-muted"
    >
      <button
        type="button"
        onClick={() => toggleReviewFileExpanded(workspaceId, file.path)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-ds-hover"
      >
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-faint" />}
        <span className="min-w-0 flex-1 truncate font-mono text-ds-ink">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <span className={`shrink-0 ${STATUS_TONE[file.status]}`}>
          {t(`review${file.status[0].toUpperCase()}${file.status.slice(1)}`)}
        </span>
        <span className="shrink-0 font-mono">
          <span className="text-emerald-600 dark:text-emerald-400">+{file.insertions}</span>
          {' '}
          <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-ds-border-muted">
          {file.binary || detail?.binary ? (
            <div className="px-6 py-4 text-[12px] text-ds-muted">{t('reviewBinary')}</div>
          ) : file.tooLarge || detail?.tooLarge ? (
            <div className="px-6 py-4 text-[12px] text-ds-muted">{t('reviewTooLarge')}</div>
          ) : entry?.loading || !detail ? (
            <div className="flex items-center gap-2 px-6 py-4 text-[12px] text-ds-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('reviewLoading')}
            </div>
          ) : entry?.error ? (
            <div className="px-6 py-4 text-[12px] text-red-600 dark:text-red-400">{entry.error}</div>
          ) : viewMode === 'split' ? (
            <ReviewSplitMerge oldText={detail.oldText ?? ''} newText={detail.newText ?? ''} />
          ) : detail.patch ? (
            <UnifiedPatch patch={detail.patch} />
          ) : (
            <div className="px-6 py-4 text-[12px] text-ds-muted">{t('reviewEmpty')}</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
