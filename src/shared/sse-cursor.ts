import { z } from 'zod'

/** A renderer-owned acknowledgement cursor persisted across process restarts. */
export const SseResumeCursorSchema = z.object({
  scopeId: z.string().trim().min(1).max(128),
  streamId: z.string().trim().min(1).max(128),
  lastSequence: z.number().int().nonnegative().safe(),
  runtimeGeneration: z.string().trim().min(1).max(128).optional(),
  updatedAt: z.string().datetime({ offset: true })
}).strict()

export type SseResumeCursor = z.infer<typeof SseResumeCursorSchema>

export const SSE_RESUME_CURSOR_SCHEMA_VERSION = 1 as const

export const SseResumeCursorFileSchema = z.object({
  version: z.literal(SSE_RESUME_CURSOR_SCHEMA_VERSION),
  cursors: z.record(z.string().min(1).max(128), SseResumeCursorSchema)
}).strict()

export type SseResumeCursorFile = z.infer<typeof SseResumeCursorFileSchema>
