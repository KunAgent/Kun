import { z } from 'zod'

/** Metadata required to detect duplicate, stale, and missing SSE events. */
export const SequencedRuntimeEventSchema = z.object({
  streamId: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative().safe(),
  eventId: z.string().min(1).max(128),
  occurredAt: z.string().datetime({ offset: true })
}).strict()

export type SequencedRuntimeEvent = z.infer<typeof SequencedRuntimeEventSchema>
