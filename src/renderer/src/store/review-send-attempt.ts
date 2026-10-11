import type { ReviewComment, ReviewSendTarget, SendReviewInput } from '@shared/review-comment'
import type { ReviewRevision } from '@shared/review-revision'
import { parseRuntimeErrorBody } from '@shared/runtime-error'

type Attempt = { fingerprint: string; clientRequestId: string; expectedRevision?: ReviewRevision }
const attempts = new Map<string, Attempt>()

/** An uncertain retry keeps the exact key and version first submitted. */
export function reviewSendAttempt(workspaceId: string, comments: ReviewComment[], target: ReviewSendTarget,
  note: string | undefined, revision: ReviewRevision | undefined): Pick<SendReviewInput, 'clientRequestId' | 'expectedRevision'> {
  const fingerprint = JSON.stringify([
    comments.map((comment) => [comment.commentId, comment.body]).sort(([left], [right]) => left.localeCompare(right)), target, note ?? ''
  ])
  let attempt = attempts.get(workspaceId)
  if (!attempt || attempt.fingerprint !== fingerprint) {
    attempt = {
      fingerprint,
      clientRequestId: globalThis.crypto?.randomUUID?.() ?? `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
      ...(revision?.completeness === 'complete' ? { expectedRevision: revision } : {})
    }
    attempts.set(workspaceId, attempt)
  }
  return { clientRequestId: attempt.clientRequestId, ...(attempt.expectedRevision ? { expectedRevision: attempt.expectedRevision } : {}) }
}

export function finishReviewSendAttempt(workspaceId: string): void { attempts.delete(workspaceId) }

export function rejectReviewSendAttempt(workspaceId: string, cause: unknown): boolean {
  const error = parseRuntimeErrorBody(cause instanceof Error ? cause.message : String(cause), '')
  const details = error.details as { reason?: string; safeToRetry?: boolean } | undefined
  if (details?.safeToRetry === true || details?.reason === 'revision_stale' || details?.reason === 'review_revision_stale' || details?.reason === 'review_revision_unknown') {
    attempts.delete(workspaceId)
    return true
  }
  return false
}
