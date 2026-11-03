import { z } from 'zod'

/**
 * Average model timing over one turn's model calls, stamped on the turn when
 * it settles. Live clients read the same averages from `usage` events
 * (`turnAvgTtftMs` / `turnAvgTokensPerSecond`); this copy is what survives a
 * reopened session or a runtime restart. A null average had no measurement.
 */
export const TurnModelTimingSchema = z.object({
  avgTtftMs: z.number().nonnegative().nullable(),
  avgTokensPerSecond: z.number().nonnegative().nullable()
})
export type TurnModelTiming = z.infer<typeof TurnModelTimingSchema>
