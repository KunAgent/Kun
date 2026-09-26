import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { parsePatch } from 'diff'
import { MergeView } from '@codemirror/merge'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import type { TaskWorkspaceDiffFile } from '@shared/task-workspace'
import type { ReviewComment, ReviewCommentSide, ReviewSendRecord } from '@shared/review-comment'
import {
  createReviewDraft,
  loadWorkspaceDiffFile,
  REVIEW_LARGE_FILE_LINES,
  toggleReviewFileExpanded,
  useReviewStore
} from '../../store/review-store'
import { ReviewCommentGutter } from './ReviewCommentGutter'
import { ReviewCommentThread, ReviewDetachedComments } from './ReviewCommentThread'

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

type LineAnchor = {
  side: ReviewCommentSide
  line: number
  lineText: string
  before: string[]
  after: string[]
}

/** Row match keys: ctx lines anchor comments on either side (11 §4.1). */
function rowKeys(line: UnifiedLine): { side: ReviewCommentSide; line: number }[] {
  if (line.tone === 'del' && line.oldNo !== null) return [{ side: 'old', line: line.oldNo }]
  if (line.tone === 'add' && line.newNo !== null) return [{ side: 'new', line: line.newNo }]
  return [
    ...(line.newNo !== null ? [{ side: 'new' as const, line: line.newNo }] : []),
    ...(line.oldNo !== null ? [{ side: 'old' as const, line: line.oldNo }] : [])
  ]
}

function UnifiedPatch({
  patch,
  workspaceId,
  comments,
  requests,
  onAddComment
}: {
  patch: string
  workspaceId: string
  comments: ReviewComment[]
  requests: ReviewSendRecord[]
  onAddComment: (anchor: LineAnchor) => void
}): ReactElement {
  const { hunks } = unifiedLines(patch)
  const commentable = (line: UnifiedLine): boolean => line.oldNo !== null || line.newNo !== null
  const anchorFor = (lines: UnifiedLine[], i: number): LineAnchor | null => {
    const line = lines[i]
    const side: ReviewCommentSide = line.tone === 'del' ? 'old' : 'new'
    const lineNo = side === 'old' ? line.oldNo : line.newNo
    if (lineNo === null) return null
    return {
      side,
      line: lineNo,
      lineText: line.text,
      before: lines.slice(Math.max(0, i - 3), i).map((l) => l.text),
      after: lines.slice(i + 1, i + 4).map((l) => l.text)
    }
  }
  const commentsFor = (line: UnifiedLine): ReviewComment[] => {
    const keys = rowKeys(line)
    return comments.filter((c) =>
      !c.outdated && keys.some((k) => c.side === k.side && c.line === k.line))
  }
  return (
    <div className="overflow-x-auto font-mono text-[12px] leading-5">
      {hunks.map((hunk, index) => (
        <div key={index}>
          <div className="px-3 py-1 text-ds-faint bg-ds-hover/40 select-none">{hunk.header}</div>
          {hunk.lines.map((line, i) => {
            const anchored = commentsFor(line)
            const anchor = anchorFor(hunk.lines, i)
            return (
              <div key={i}>
                <div
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'c' && !event.metaKey && !event.ctrlKey
                      && event.target === event.currentTarget && anchor
                    ) {
                      event.preventDefault()
                      onAddComment(anchor)
                    }
                  }}
                  className={`group flex whitespace-pre outline-none focus:bg-sky-500/5 ${
                    line.tone === 'add'
                      ? 'bg-emerald-500/10'
                      : line.tone === 'del'
                        ? 'bg-red-500/10'
                        : ''
                  }`}
                >
                  {commentable(line) ? (
                    <ReviewCommentGutter
                      commentCount={anchored.length}
                      onAdd={() => anchor && onAddComment(anchor)}
                    />
                  ) : <span className="w-4 shrink-0" />}
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
                {anchored.length ? (
                  <ReviewCommentThread
                    workspaceId={workspaceId}
                    comments={anchored}
                    requests={requests}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Every side:line the patch renders — comments beyond it detach (11 §4.3). */
function patchAnchorKeys(patch: string): Set<string> {
  const keys = new Set<string>()
  for (const hunk of unifiedLines(patch).hunks) {
    for (const line of hunk.lines) {
      for (const key of rowKeys(line)) keys.add(`${key.side}:${key.line}`)
    }
  }
  return keys
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
  const fileComments = (review?.comments ?? []).filter((c) => c.path === file.path)
  const detail = entry?.detail
  const visibleKeys = detail?.patch ? patchAnchorKeys(detail.patch) : null
  const anchoredComments = fileComments.filter((c) =>
    !c.outdated && (!visibleKeys || visibleKeys.has(`${c.side}:${c.line}`)))
  const detachedComments = fileComments.filter((c) =>
    c.outdated || (visibleKeys !== null && !visibleKeys.has(`${c.side}:${c.line}`)))
  const requests = review?.requests ?? []
  const onAddComment = useCallback(
    (anchor: LineAnchor) => {
      createReviewDraft(workspaceId, {
        path: file.path,
        side: anchor.side,
        line: anchor.line,
        anchor: { lineText: anchor.lineText, before: anchor.before, after: anchor.after }
      })
    },
    [workspaceId, file.path]
  )

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
            <>
              <ReviewSplitMerge oldText={detail.oldText ?? ''} newText={detail.newText ?? ''} />
              {/* Split view has no per-line gutter; threads list per file. */}
              {fileComments.length ? (
                <ReviewCommentThread
                  workspaceId={workspaceId}
                  comments={fileComments}
                  requests={requests}
                />
              ) : null}
            </>
          ) : detail.patch ? (
            <>
              <UnifiedPatch
                patch={detail.patch}
                workspaceId={workspaceId}
                comments={anchoredComments}
                requests={requests}
                onAddComment={onAddComment}
              />
              <ReviewDetachedComments
                workspaceId={workspaceId}
                comments={detachedComments}
                requests={requests}
              />
            </>
          ) : (
            <div className="px-6 py-4 text-[12px] text-ds-muted">{t('reviewEmpty')}</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
