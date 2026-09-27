import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type { ReviewComment } from '../contracts/review.js'
import { workspaceGit } from '../workspace-tasks/workspace-git.js'
import { reanchorComment } from './review-anchor.js'
import type { FileReviewStore } from './review-store.js'

/**
 * Post-capture re-anchor (11 §4.3): every unresolved comment on the
 * workspace is re-located against the freshly captured file version and its
 * `line`/`outdated` written back. Runs from TaskWorkspaceService.onChange.
 */
export async function reanchorWorkspaceComments(
  store: FileReviewStore,
  record: TaskWorkspaceRecord
): Promise<void> {
  const file = await store.list(record.workspaceId)
  const open = file.comments.filter((c) => c.state !== 'resolved')
  if (!open.length) return
  const cache = new Map<string, Promise<string[] | null>>()
  const linesFor = (comment: ReviewComment): Promise<string[] | null> => {
    const key = `${comment.side}:${comment.path}`
    let pending = cache.get(key)
    if (!pending) {
      pending = comment.side === 'new'
        ? readFile(join(record.path, comment.path), 'utf8')
            .then((text) => text.split('\n'))
            .catch(() => null)
        : record.baseRevision
          ? workspaceGit(record.path, ['show', `${record.baseRevision}:${comment.path}`])
              .then((text) => text.split('\n'))
              .catch(() => null)
          : Promise.resolve(null)
      cache.set(key, pending)
    }
    return pending
  }
  const updates = await Promise.all(open.map(async (comment) => {
    const lines = await linesFor(comment)
    if (!lines) return { commentId: comment.commentId, outdated: true }
    const result = reanchorComment(
      { line: comment.line, side: comment.side, anchor: comment.anchor },
      lines
    )
    return 'outdated' in result
      ? { commentId: comment.commentId, outdated: true as const }
      : { commentId: comment.commentId, line: result.line, outdated: false }
  }))
  await store.reanchorResult(record.workspaceId, updates)
}
