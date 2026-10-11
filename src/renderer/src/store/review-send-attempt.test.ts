import { describe, expect, it } from 'vitest'
import type { ReviewComment } from '@shared/review-comment'
import type { ReviewRevision } from '@shared/review-revision'
import { finishReviewSendAttempt, rejectReviewSendAttempt, reviewSendAttempt } from './review-send-attempt'
const revision: ReviewRevision = { version: 1, target: { kind: 'task-workspace', workspaceId: 'workspace' }, completeness: 'complete', contentHash: 'old', fileCount: 1, capturedAt: 'now' }
const comments = [{ commentId: 'comment', body: 'Fix this exact issue' }] as ReviewComment[]
describe('review uncertain delivery retries', () => {
  it('retains both the key and submitted version after transport failure even when files change', () => {
    const first = reviewSendAttempt('uncertain', comments, { kind: 'manager' }, undefined, revision)
    expect(rejectReviewSendAttempt('uncertain', new Error('timeout'))).toBe(false)
    const retry = reviewSendAttempt('uncertain', comments, { kind: 'manager' }, undefined, { ...revision, contentHash: 'new' })
    expect(retry).toEqual(first)
    finishReviewSendAttempt('uncertain')
    expect(reviewSendAttempt('uncertain', comments, { kind: 'manager' }, undefined, revision).clientRequestId).not.toBe(first.clientRequestId)
  })
  it('starts a fresh attempt only after a known stale rejection or changed payload', () => {
    const first = reviewSendAttempt('stale', comments, { kind: 'manager' }, undefined, revision)
    const error = new Error(JSON.stringify({ code: 'conflict', message: 'stale', details: { reason: 'revision_stale' } }))
    expect(rejectReviewSendAttempt('stale', error)).toBe(true)
    const next = reviewSendAttempt('stale', comments, { kind: 'manager' }, undefined, revision)
    expect(next.clientRequestId).not.toBe(first.clientRequestId)
    expect(reviewSendAttempt('stale', [{ ...comments[0], body: 'Updated comment' }], { kind: 'manager' }, undefined, revision).clientRequestId).not.toBe(next.clientRequestId)
  })
})
