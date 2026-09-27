import {
  ReviewCommentFileSchema,
  ReviewCommentSchema,
  type CreateReviewCommentRequest,
  type ReviewComment,
  type ReviewCommentFile,
  type ReviewSendRecord,
  type UpdateReviewCommentRequest
} from '../contracts/review.js'
import { adeReviewFile } from './ade-paths.js'
import { readAdeJson, writeAdeJson } from './ade-file.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'

/**
 * Line-level review comments for one task workspace (11 §4.1):
 * `dataDir/ade/reviews/<workspaceId>.json`. Shared by every client so the
 * phone can see and send the same pending batch as the desktop.
 */
export class FileReviewStore {
  constructor(
    private readonly dataDir: string,
    private readonly nowIso: () => string = () => new Date().toISOString(),
    private readonly nextId: (prefix: 'rvc' | 'rvq') => string
  ) {}

  private readFile(workspaceId: string): Promise<ReviewCommentFile> {
    return readAdeJson(
      adeReviewFile(this.dataDir, workspaceId),
      ReviewCommentFileSchema,
      () => ({ comments: [], requests: [] })
    )
  }

  private writeFile(workspaceId: string, file: ReviewCommentFile): Promise<void> {
    return writeAdeJson(adeReviewFile(this.dataDir, workspaceId), file)
  }

  private mutex<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    return withManagerDataMutex(`ade-review:${workspaceId}`, () => operation())
  }

  /** New send-request id (`rvq_…`) for markSent records. */
  nextRequestId(): string {
    return this.nextId('rvq')
  }

  async list(workspaceId: string): Promise<ReviewCommentFile> {
    return this.readFile(workspaceId)
  }

  async create(
    workspaceId: string,
    input: CreateReviewCommentRequest,
    author: ReviewComment['author'] = 'user'
  ): Promise<ReviewComment> {
    return this.mutex(workspaceId, async () => {
      const file = await this.readFile(workspaceId)
      const now = this.nowIso()
      const comment: ReviewComment = ReviewCommentSchema.parse({
        commentId: this.nextId('rvc'),
        workspaceId,
        ...(input.dispatchId ? { dispatchId: input.dispatchId } : {}),
        path: input.path,
        side: input.side,
        line: input.line,
        anchor: input.anchor,
        body: input.body,
        state: 'draft',
        outdated: false,
        author,
        createdAt: now,
        updatedAt: now
      })
      file.comments.push(comment)
      await this.writeFile(workspaceId, file)
      return comment
    })
  }

  /** Edit body / resolve / unresolve. Sent comments may still be resolved. */
  async update(
    workspaceId: string,
    commentId: string,
    patch: UpdateReviewCommentRequest
  ): Promise<ReviewComment | null> {
    return this.mutex(workspaceId, async () => {
      const file = await this.readFile(workspaceId)
      const index = file.comments.findIndex((c) => c.commentId === commentId)
      if (index < 0) return null
      const comment = file.comments[index]
      const next: ReviewComment = {
        ...comment,
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        // Resolving keeps the recorded send id; reopening to draft clears it.
        ...(patch.state === 'draft' ? { sentInRequestId: undefined } : {}),
        updatedAt: this.nowIso()
      }
      file.comments[index] = ReviewCommentSchema.parse(next)
      await this.writeFile(workspaceId, file)
      return file.comments[index]
    })
  }

  /** After a capture: persist the new line or flag the comment outdated. */
  async reanchorResult(
    workspaceId: string,
    updates: { commentId: string; line?: number; outdated: boolean }[]
  ): Promise<void> {
    if (!updates.length) return
    await this.mutex(workspaceId, async () => {
      const file = await this.readFile(workspaceId)
      let changed = false
      for (const update of updates) {
        const index = file.comments.findIndex((c) => c.commentId === update.commentId)
        if (index < 0) continue
        const comment = file.comments[index]
        if (comment.state === 'resolved') continue
        const next = {
          ...comment,
          ...(update.line !== undefined ? { line: update.line } : {}),
          outdated: update.outdated,
          updatedAt: this.nowIso()
        }
        if (
          next.line !== comment.line ||
          next.outdated !== comment.outdated
        ) {
          file.comments[index] = ReviewCommentSchema.parse(next)
          changed = true
        }
      }
      if (changed) await this.writeFile(workspaceId, file)
    })
  }

  /**
   * Record one sent batch: comments become `sent` + `sentInRequestId`, and
   * the request log grows (its length is the round counter).
   */
  async markSent(
    workspaceId: string,
    record: ReviewSendRecord
  ): Promise<ReviewComment[]> {
    return this.mutex(workspaceId, async () => {
      const file = await this.readFile(workspaceId)
      const now = this.nowIso()
      for (const id of record.commentIds) {
        const index = file.comments.findIndex((c) => c.commentId === id)
        if (index < 0) continue
        file.comments[index] = {
          ...file.comments[index],
          state: 'sent',
          sentInRequestId: record.requestId,
          updatedAt: now
        }
      }
      file.requests.push(record)
      await this.writeFile(workspaceId, file)
      return file.comments.filter((c) => record.commentIds.includes(c.commentId))
    })
  }
}
