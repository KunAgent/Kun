import { z } from 'zod'

export const GraphIdentifierSchema = z.string().trim().min(1).max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  'identifier must be portable and path safe'
)
export const GraphIdempotencyKeySchema = z.string().trim().min(1).max(256).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:,@=-]*$/,
  'idempotency key contains unsupported characters'
)

/** Provider identifiers are capability keys and are not filesystem identifiers. */
export const GraphToolProviderIdSchema = z.string().trim().min(1).max(256).refine(
  (value) => !Array.from(value).some(
    (character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f
  ),
  'tool provider id contains control characters'
)
export const GraphTimestampSchema = z.string().datetime({ offset: true })
export const GraphBoundedSummarySchema = z.string().max(4_096)

export const GraphRunIdSchema = GraphIdentifierSchema
export type GraphRunId = z.infer<typeof GraphRunIdSchema>
export const GraphNodeIdSchema = GraphIdentifierSchema
export type GraphNodeId = z.infer<typeof GraphNodeIdSchema>
export const GraphEdgeIdSchema = GraphIdentifierSchema
export type GraphEdgeId = z.infer<typeof GraphEdgeIdSchema>
export const GraphAttemptIdSchema = GraphIdentifierSchema
export type GraphAttemptId = z.infer<typeof GraphAttemptIdSchema>
export const GraphReviewIdSchema = GraphIdentifierSchema
export type GraphReviewId = z.infer<typeof GraphReviewIdSchema>
export const GraphMessageIdSchema = GraphIdentifierSchema
export type GraphMessageId = z.infer<typeof GraphMessageIdSchema>
export const GraphCommandIdSchema = GraphIdentifierSchema
export type GraphCommandId = z.infer<typeof GraphCommandIdSchema>
export const GraphProfileIdSchema = GraphIdentifierSchema
export type GraphProfileId = z.infer<typeof GraphProfileIdSchema>
