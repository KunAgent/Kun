import { z } from 'zod'
import { TurnReasoningEffortSchema } from './turn-reasoning.js'

export const ReviewLineRangeSchema = z.object({
  start: z.number().int().positive(),
  end: z.number().int().positive()
})
export type ReviewLineRange = z.infer<typeof ReviewLineRangeSchema>

export const ReviewCodeLocationSchema = z.object({
  absoluteFilePath: z.string().min(1),
  lineRange: ReviewLineRangeSchema
})
export type ReviewCodeLocation = z.infer<typeof ReviewCodeLocationSchema>

export const ReviewFindingSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  confidenceScore: z.number().min(0).max(1),
  priority: z.number().int().min(0).max(3),
  codeLocation: ReviewCodeLocationSchema
})
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>

export const ReviewOutputSchema = z.object({
  findings: z.array(ReviewFindingSchema).default([]),
  overallCorrectness: z.enum(['patch is correct', 'patch is incorrect']),
  overallExplanation: z.string(),
  overallConfidenceScore: z.number().min(0).max(1)
})
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>

export const ReviewTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('uncommittedChanges')
  }),
  z.object({
    kind: z.literal('baseBranch'),
    branch: z.string().trim().min(1)
  }),
  z.object({
    kind: z.literal('commit'),
    sha: z.string().trim().min(1)
  }),
  z.object({
    kind: z.literal('custom'),
    instructions: z.string().trim().min(1)
  })
])
export type ReviewTarget = z.infer<typeof ReviewTargetSchema>

export const StartReviewRequest = z.object({
  target: ReviewTargetSchema,
  model: z.string().trim().min(1).optional(),
  providerId: z.string().trim().min(1).optional(),
  accountId: z.string().trim().min(1).optional(),
  reasoningEffort: TurnReasoningEffortSchema.optional()
})
export type StartReviewRequest = z.infer<typeof StartReviewRequest>

export const StartReviewResponse = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  userMessageItemId: z.string().min(1),
  reviewItemId: z.string().min(1)
})
export type StartReviewResponse = z.infer<typeof StartReviewResponse>

export function reviewTargetTitle(target: ReviewTarget): string {
  switch (target.kind) {
    case 'uncommittedChanges':
      return 'Review current changes'
    case 'baseBranch':
      return `Review changes against ${target.branch}`
    case 'commit':
      return `Review commit ${target.sha.slice(0, 12)}`
    case 'custom':
      return 'Custom code review'
  }
}

export function reviewTargetPrompt(target: ReviewTarget): string {
  switch (target.kind) {
    case 'uncommittedChanges':
      return '/review'
    case 'baseBranch':
      return `/review base ${target.branch}`
    case 'commit':
      return `/review commit ${target.sha}`
    case 'custom':
      return `/review ${target.instructions}`
  }
}

/**
 * Line-level review comments on a task workspace diff (docs/ade/11 §4).
 * Stored in `dataDir/ade/reviews/<workspaceId>.json` so every client (GUI,
 * phone, TUI) sees and sends the same pending batch.
 */
export const ReviewCommentIdSchema = z.string().regex(/^rvc_[a-z0-9]{8,32}$/)

export const ReviewCommentAnchorSchema = z
  .object({
    lineText: z.string().max(2_000),
    before: z.array(z.string().max(2_000)).max(3),
    after: z.array(z.string().max(2_000)).max(3)
  })
  .strict()

export const ReviewCommentSchema = z
  .object({
    commentId: ReviewCommentIdSchema,
    workspaceId: z.string().min(1).max(256),
    /** Which produced dispatch the comment reviews, when known. */
    dispatchId: z.string().min(1).max(256).optional(),
    path: z.string().min(1).max(4_096),
    side: z.enum(['new', 'old']),
    line: z.number().int().positive(),
    anchor: ReviewCommentAnchorSchema,
    /** Markdown body. */
    body: z.string().min(1).max(4_000),
    state: z.enum(['draft', 'sent', 'resolved']),
    /** Re-anchoring failed after a capture; the comment still sends. */
    outdated: z.boolean().default(false),
    sentInRequestId: z.string().min(1).max(64).optional(),
    /** 'reviewer' comments originate from a cross-review agent (10 §5). */
    author: z.enum(['user', 'reviewer']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()
export type ReviewComment = z.infer<typeof ReviewCommentSchema>

/** POST /v1/reviews/:workspaceId/comments body. */
export const CreateReviewCommentSchema = z
  .object({
    dispatchId: z.string().min(1).max(256).optional(),
    path: z.string().min(1).max(4_096),
    side: z.enum(['new', 'old']),
    line: z.number().int().positive(),
    anchor: ReviewCommentAnchorSchema,
    body: z.string().min(1).max(4_000)
  })
  .strict()
export type CreateReviewCommentRequest = z.infer<typeof CreateReviewCommentSchema>

/** PATCH /v1/reviews/:workspaceId/comments/:commentId body. */
export const UpdateReviewCommentSchema = z
  .object({
    body: z.string().min(1).max(4_000).optional(),
    state: z.enum(['draft', 'resolved']).optional()
  })
  .strict()
export type UpdateReviewCommentRequest = z.infer<typeof UpdateReviewCommentSchema>

/** Send target for a pending review batch (11 §4.4). */
export const ReviewSendTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('worker'), workerId: z.string().min(1).max(256) })
    .strict(),
  z.object({ kind: z.literal('manager') }).strict(),
  z
    .object({
      kind: z.literal('new-worker'),
      harnessId: z.string().min(1).max(64).optional()
    })
    .strict()
])
export type ReviewSendTarget = z.infer<typeof ReviewSendTargetSchema>

/** POST /v1/reviews/:workspaceId/send body. */
export const SendReviewRequestSchema = z
  .object({
    commentIds: z.array(ReviewCommentIdSchema).min(1).max(200),
    target: ReviewSendTargetSchema,
    /** Free-form note prepended to the rendered revision request. */
    note: z.string().max(8_000).optional()
  })
  .strict()
export type SendReviewRequest = z.infer<typeof SendReviewRequestSchema>

/** Durable record of one sent batch; `round` = its ordinal for the workspace. */
export const ReviewSendRecordSchema = z
  .object({
    requestId: z.string().regex(/^rvq_[a-z0-9]{8,32}$/),
    round: z.number().int().positive(),
    target: ReviewSendTargetSchema,
    commentIds: z.array(ReviewCommentIdSchema).min(1),
    note: z.string().max(8_000).optional(),
    /** Dispatch id (worker target) or new worker id (new-worker target). */
    outcomeRef: z.string().min(1).max(256).optional(),
    sentAt: z.string().datetime()
  })
  .strict()
export type ReviewSendRecord = z.infer<typeof ReviewSendRecordSchema>

export const ReviewCommentFileSchema = z
  .object({
    comments: z.array(ReviewCommentSchema).max(2_000).default([]),
    requests: z.array(ReviewSendRecordSchema).max(200).default([])
  })
  .strict()
export type ReviewCommentFile = z.infer<typeof ReviewCommentFileSchema>
