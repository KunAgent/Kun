import { z } from 'zod'

/** Renderer-owned terminal completion attention shared with the desktop workboard publisher. */
export type WorkboardCompletionOutcome = 'completed' | 'failed'
export type WorkboardCompletionAttention = Record<string, WorkboardCompletionOutcome>

export { WORKBOARD_COMPLETION_ATTENTION_CHANNEL } from './user-attention'
export const WORKBOARD_COMPLETION_ATTENTION_LIMIT = 1000

export const workboardCompletionAttentionSchema = z.record(
  z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  z.enum(['completed', 'failed'])
).refine(value => Object.keys(value).length <= WORKBOARD_COMPLETION_ATTENTION_LIMIT)
