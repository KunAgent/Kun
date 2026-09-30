import {
  MAX_REVIEW_REQUEST_CHARS,
  ReviewCommentFileSchema,
  ReviewCommentSchema,
  type CreateReviewCommentRequest,
  type ReviewComment,
  type ReviewCommentFile,
  type ReviewSendRecord,
  type ReviewSendReservation,
  type UpdateReviewCommentRequest
} from '../contracts/review.js'
import { adeReviewFile } from './ade-paths.js'
import { writeAdeJson } from './ade-file.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import type { ReviewRevision } from '../contracts/review-revision.js'
import { renderRevisionRequest } from './revision-request.js'
import { readFile } from 'node:fs/promises'
import type { ArtifactStore } from '../artifacts/artifact-store.js'

/**
 * Line-level review comments for one task workspace (11 §4.1):
 * `dataDir/ade/reviews/<workspaceId>.json`. Shared by every client so the
 * phone can see and send the same pending batch as the desktop.
 */
export class FileReviewStore {
  constructor(
    private readonly dataDir: string,
    private readonly nowIso: () => string = () => new Date().toISOString(),
    private readonly nextId: (prefix: 'rvc' | 'rvq') => string,
    private readonly revisionForWorkspace?: (workspaceId: string) => Promise<ReviewRevision>,
    private readonly artifacts?: ArtifactStore
  ) {}

  private async readFile(workspaceId: string): Promise<ReviewCommentFile> {
    let content: string
    try {
      content = await readFile(adeReviewFile(this.dataDir, workspaceId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { comments: [], requests: [], reservations: [] }
      }
      throw error
    }
    // This store controls exactly-once review dispatch. A damaged existing
    // file must never masquerade as empty and admit a duplicate worker.
    return ReviewCommentFileSchema.parse(JSON.parse(content) as unknown)
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

  async getSentRequest(workspaceId: string, requestId: string): Promise<ReviewSendRecord | null> {
    const file = await this.readFile(workspaceId)
    return file.requests.find((entry) => entry.requestId === requestId) ?? null
  }

  async lookupSend(
    workspaceId: string,
    clientRequestId: string,
    requestHash: string
  ): Promise<
    | { kind: 'sent'; record: ReviewSendRecord }
    | { kind: 'pending'; reservation: ReviewSendReservation }
    | { kind: 'conflict' }
    | null
  > {
    const file = await this.readFile(workspaceId)
    const sent = file.requests.find((entry) => entry.clientRequestId === clientRequestId)
    if (sent) return sent.requestHash === requestHash
      ? { kind: 'sent', record: sent } : { kind: 'conflict' }
    const pending = file.reservations.find((entry) => entry.clientRequestId === clientRequestId)
    if (pending) return pending.requestHash === requestHash
      ? { kind: 'pending', reservation: pending } : { kind: 'conflict' }
    return null
  }

  /** Durable reservation precedes any worker/manager delivery side effect. */
  async reserveSend(workspaceId: string, input: {
    clientRequestId: string
    requestHash: string
    target: ReviewSendRecord['target']
    commentIds: string[]
    note?: string
    revision?: ReviewSendRecord['revision']
    language?: 'zh' | 'en'
  }): Promise<
    | { kind: 'reserved'; reservation: ReviewSendReservation }
    | { kind: 'sent'; record: ReviewSendRecord }
    | { kind: 'pending'; reservation: ReviewSendReservation }
    | { kind: 'conflict' | 'history_full' | 'comments_unavailable' | 'request_too_large' | 'artifact_unavailable' }
  > {
    return this.mutex(workspaceId, async () => {
      const existing = await this.lookupSend(workspaceId, input.clientRequestId, input.requestHash)
      if (existing) return existing
      const file = await this.readFile(workspaceId)
      if (file.requests.length + file.reservations.length >= 200) return { kind: 'history_full' }
      const wanted = new Set(input.commentIds)
      if (wanted.size !== input.commentIds.length ||
          file.comments.filter((comment) => wanted.has(comment.commentId) && comment.state === 'draft').length !== wanted.size ||
          file.reservations.some((reservation) => reservation.commentIds.some((id) => wanted.has(id)))) {
        return { kind: 'comments_unavailable' }
      }
      const round = Math.max(0, ...file.requests.map((entry) => entry.round),
        ...file.reservations.map((entry) => entry.round)) + 1
      const comments = file.comments.filter((comment) => wanted.has(comment.commentId))
      const title = input.language === 'zh' ? `审查意见 第 ${round} 轮` : `Review comments round ${round}`
      const requestText = renderRevisionRequest({
        workspaceId, round, comments, note: input.note
      })
      if (requestText.length > MAX_REVIEW_REQUEST_CHARS) return { kind: 'request_too_large' }
      let requestArtifactId: string | undefined
      if (input.target.kind !== 'manager' && requestText.length > 32_000) {
        if (!this.artifacts) return { kind: 'artifact_unavailable' }
        const artifact = await this.artifacts.put({
          content: requestText, mimeType: 'text/markdown', source: 'other',
          origin: `review:${workspaceId}:${round}`, linkedOwners: [`review:${workspaceId}`]
        })
        requestArtifactId = artifact.meta.id
      }
      const reservation: ReviewSendReservation = {
        requestId: this.nextRequestId(),
        workspaceId,
        clientRequestId: input.clientRequestId,
        requestHash: input.requestHash,
        round,
        target: input.target,
        commentIds: input.commentIds,
        ...(input.note ? { note: input.note } : {}),
        ...(input.revision ? { revision: input.revision } : {}),
        title,
        requestText,
        ...(requestArtifactId ? { requestArtifactId } : {}),
        reservedAt: this.nowIso()
      }
      file.reservations.push(reservation)
      await this.writeFile(workspaceId, file)
      return { kind: 'reserved', reservation }
    })
  }

  async completeSend(workspaceId: string, requestId: string, outcome: {
    outcomeRef?: string
    dispatchId?: string
    userReport?: string
  }): Promise<ReviewSendRecord> {
    return this.mutex(workspaceId, async () => {
      const file = await this.readFile(workspaceId)
      const prior = file.requests.find((entry) => entry.requestId === requestId)
      if (prior) return prior
      const index = file.reservations.findIndex((entry) => entry.requestId === requestId)
      if (index < 0) throw new Error('review send reservation not found')
      const pending = file.reservations[index]
      if (file.requests.length >= 200) throw new Error('review send history is full')
      const record: ReviewSendRecord = {
        requestId: pending.requestId,
        workspaceId: pending.workspaceId,
        round: pending.round,
        target: pending.target,
        commentIds: pending.commentIds,
        ...(pending.note ? { note: pending.note } : {}),
        ...(pending.revision ? { revision: pending.revision } : {}),
        title: pending.title,
        requestText: pending.requestText,
        ...(pending.requestArtifactId ? { requestArtifactId: pending.requestArtifactId } : {}),
        clientRequestId: pending.clientRequestId,
        requestHash: pending.requestHash,
        ...(outcome.outcomeRef ? { outcomeRef: outcome.outcomeRef } : {}),
        ...(outcome.dispatchId ? { dispatchId: outcome.dispatchId } : {}),
        ...(outcome.userReport ? { userReport: outcome.userReport.slice(0, 4_000) } : {}),
        sentAt: this.nowIso()
      }
      const ids = new Set(record.commentIds)
      for (const comment of file.comments) {
        if (!ids.has(comment.commentId)) continue
        comment.state = 'sent'
        comment.sentInRequestId = requestId
        comment.updatedAt = record.sentAt
      }
      file.reservations.splice(index, 1)
      file.requests.push(record)
      await this.writeFile(workspaceId, file)
      return record
    })
  }

  async create(
    workspaceId: string,
    input: CreateReviewCommentRequest,
    author: ReviewComment['author'] = 'user'
  ): Promise<ReviewComment> {
    return this.mutex(workspaceId, async () => {
      const file = await this.readFile(workspaceId)
      const now = this.nowIso()
      const revision = await this.revisionForWorkspace?.(workspaceId).catch(() => undefined)
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
        ...(revision ? { revision } : {}),
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
      if (file.requests.length + file.reservations.length >= 200) {
        throw new Error('review send history is full')
      }
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
