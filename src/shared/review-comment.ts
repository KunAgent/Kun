/**
 * Renderer-facing mirrors of the ADE review-comment wire shapes in
 * kun/src/contracts/review.ts (docs/ade/11 §4). Kun owns the schema; keep
 * field names aligned.
 */

export type ReviewCommentAnchor = {
  lineText: string
  before: string[]
  after: string[]
}

export type ReviewCommentSide = 'new' | 'old'

export type ReviewCommentState = 'draft' | 'sent' | 'resolved'

export type ReviewComment = {
  commentId: string
  workspaceId: string
  dispatchId?: string
  path: string
  side: ReviewCommentSide
  /** Current line; may move after reanchoring. */
  line: number
  anchor: ReviewCommentAnchor
  body: string
  state: ReviewCommentState
  /** True when reanchoring could not re-locate the line uniquely. */
  outdated: boolean
  sentInRequestId?: string
  author: 'user' | 'reviewer'
  createdAt: string
  updatedAt: string
}

export type ReviewSendTarget =
  | { kind: 'worker'; workerId: string }
  | { kind: 'manager' }
  | { kind: 'new-worker'; harnessId?: string }

export type ReviewSendRecord = {
  requestId: string
  round: number
  target: ReviewSendTarget
  commentIds: string[]
  note?: string
  outcomeRef?: string
  sentAt: string
}

export type ReviewCommentFile = {
  workspaceId: string
  comments: ReviewComment[]
  requests: ReviewSendRecord[]
}

export type CreateReviewCommentInput = {
  dispatchId?: string
  path: string
  side: ReviewCommentSide
  line: number
  anchor: ReviewCommentAnchor
  body: string
}

export type UpdateReviewCommentInput = {
  body?: string
  state?: ReviewCommentState
}

export type SendReviewInput = {
  commentIds: string[]
  target: ReviewSendTarget
  note?: string
}

export type SendReviewResponse = {
  request: ReviewSendRecord
  dispatchId?: string
  workerId?: string
  userReport?: string
  composerContext?: { kind: 'review_request'; title: string; body: string }
}
