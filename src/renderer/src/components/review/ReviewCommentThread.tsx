import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import { Check, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReviewComment } from '@shared/review-comment'
import {
  discardReviewDraft,
  resolveReviewComment,
  updateReviewDraftBody,
  useReviewStore
} from '../../store/review-store'

const isLocal = (id: string): boolean => id.startsWith('local_')

function CommentEditor({
  workspaceId,
  comment,
  onDone
}: {
  workspaceId: string
  comment: ReviewComment
  onDone: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [text, setText] = useState(comment.body)
  const save = (): void => {
    if (!text.trim()) {
      if (isLocal(comment.commentId)) discardReviewDraft(workspaceId, comment.commentId)
      onDone()
      return
    }
    updateReviewDraftBody(workspaceId, comment.commentId, text.trim())
    onDone()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (isLocal(comment.commentId)) discardReviewDraft(workspaceId, comment.commentId)
      onDone()
    }
  }
  return (
    <div className="px-2 py-1.5">
      <textarea
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={t('reviewCommentPlaceholder')}
        className="w-full resize-y rounded-[6px] border border-ds-border-muted bg-ds-card px-2 py-1.5 text-[12px] text-ds-ink outline-none focus:border-sky-500/60"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10.5px] text-ds-faint">{t('reviewCommentSaveHint')}</span>
        <button
          type="button"
          onClick={save}
          className="rounded-[6px] bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-sky-500"
        >
          {t('reviewSendSubmit')}
        </button>
      </div>
    </div>
  )
}

function CommentRow({
  workspaceId,
  comment,
  sentRound,
  editing,
  onEdit,
  onDoneEdit
}: {
  workspaceId: string
  comment: ReviewComment
  sentRound?: number
  editing: boolean
  onEdit: () => void
  onDoneEdit: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const dirty = useReviewStore(
    (s) => s.workspaces[workspaceId]?.dirtyComments[comment.commentId]
  )
  if (editing) {
    return <CommentEditor workspaceId={workspaceId} comment={comment} onDone={onDoneEdit} />
  }
  return (
    <div className="group/comment px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-ds-faint">
        <MessageSquare className="h-3 w-3 shrink-0" strokeWidth={1.8} />
        {comment.state === 'draft' ? (
          <span className="rounded bg-amber-500/15 px-1 py-px text-amber-700 dark:text-amber-300">
            {t('reviewCommentDraft')}
          </span>
        ) : comment.state === 'sent' ? (
          <span className="rounded bg-sky-500/15 px-1 py-px text-sky-700 dark:text-sky-300">
            {t('reviewCommentSentRound', { round: sentRound ?? '?' })}
          </span>
        ) : null}
        {comment.outdated ? (
          <span className="rounded bg-red-500/15 px-1 py-px text-red-700 dark:text-red-300">
            {t('reviewCommentOutdated')}
          </span>
        ) : null}
        {dirty ? <span className="italic">{t('reviewCommentSyncing')}</span> : null}
        <span className="flex-1" />
        {comment.state === 'draft' ? (
          <button
            type="button"
            onClick={onEdit}
            className="rounded px-1 text-ds-faint opacity-0 group-hover/comment:opacity-100 hover:text-ds-ink"
          >
            {t('reviewCommentEdit')}
          </button>
        ) : null}
        {comment.state !== 'resolved' ? (
          <button
            type="button"
            onClick={() => resolveReviewComment(workspaceId, comment.commentId)}
            title={t('reviewCommentResolve')}
            className="flex items-center gap-0.5 rounded px-1 text-ds-faint opacity-0 group-hover/comment:opacity-100 hover:text-emerald-600"
          >
            <Check className="h-3 w-3" strokeWidth={2} />
            {t('reviewCommentResolve')}
          </button>
        ) : null}
      </div>
      <div className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-ds-ink">
        {comment.body || <span className="text-ds-faint">…</span>}
      </div>
      {comment.outdated ? (
        <div className="mt-0.5 truncate font-mono text-[10.5px] text-ds-faint">
          {comment.path}:{comment.line} {comment.anchor.lineText}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Inline thread under one diff row — or a file-level strip for outdated /
 * detached comments (11 §4.2). Resolved comments collapse into a chip.
 */
export function ReviewCommentThread({
  workspaceId,
  comments,
  requests,
  resolvedVisible = false
}: {
  workspaceId: string
  comments: ReviewComment[]
  requests: { requestId: string; round: number }[]
  resolvedVisible?: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(resolvedVisible)
  const open = comments.filter((c) => c.state !== 'resolved')
  const resolved = comments.filter((c) => c.state === 'resolved')
  const roundOf = (comment: ReviewComment): number | undefined =>
    requests.find((r) => r.requestId === comment.sentInRequestId)?.round

  // A brand-new empty draft opens in edit mode immediately.
  useEffect(() => {
    const fresh = comments.find((c) => c.state === 'draft' && !c.body && isLocal(c.commentId))
    if (fresh && editingId === null) setEditingId(fresh.commentId)
  }, [comments, editingId])

  if (!open.length && !resolved.length) return null
  return (
    <div className="border-y border-ds-border-muted bg-ds-card/60 font-sans">
      {open.map((comment) => (
        <CommentRow
          key={comment.commentId}
          workspaceId={workspaceId}
          comment={comment}
          sentRound={roundOf(comment)}
          editing={editingId === comment.commentId}
          onEdit={() => setEditingId(comment.commentId)}
          onDoneEdit={() => setEditingId(null)}
        />
      ))}
      {showResolved
        ? resolved.map((comment) => (
            <div key={comment.commentId} className="px-2 py-1 opacity-60">
              <div className="whitespace-pre-wrap text-[12px] text-ds-muted">{comment.body}</div>
            </div>
          ))
        : resolved.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowResolved(true)}
              className="px-2 py-1 text-[10.5px] text-ds-faint hover:text-ds-ink"
            >
              {t('reviewCommentResolved', { count: resolved.length })}
            </button>
          ) : null}
    </div>
  )
}

/** Standalone strip for comments that no longer anchor to a visible row. */
export function ReviewDetachedComments({
  workspaceId,
  comments,
  requests
}: {
  workspaceId: string
  comments: ReviewComment[]
  requests: { requestId: string; round: number }[]
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (!comments.length) return null
  return (
    <div className="border-t border-ds-border-muted">
      <div className="px-3 py-1 text-[10.5px] text-ds-faint">
        {t('reviewCommentOutdated')}
      </div>
      <ReviewCommentThread workspaceId={workspaceId} comments={comments} requests={requests} />
    </div>
  )
}
