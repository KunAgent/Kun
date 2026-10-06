import { z } from 'zod'

export const AttemptUsageTotalsSchema = z.object({
  promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative().optional(), cacheHitTokens: z.number().int().nonnegative().optional(),
  cacheMissTokens: z.number().int().nonnegative().optional(), cacheWriteTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(), costCny: z.number().nonnegative().optional(),
  costByCurrency: z.record(z.string(), z.number().nonnegative()).optional(),
  cacheSavingsUsd: z.number().nonnegative().optional(), cacheSavingsCny: z.number().nonnegative().optional()
}).strict()
export const ModelAttemptAccountingSchema = z.object({
  requestId: z.string().min(1),
  attempts: z.array(z.object({ attemptId: z.string().min(1), providerId: z.string(), modelId: z.string(),
    dispatched: z.boolean(), usageKnown: z.boolean(), usage: AttemptUsageTotalsSchema.optional() }).strict()).max(16),
  totals: AttemptUsageTotalsSchema, usageKnown: z.boolean(), responseUsageKnown: z.boolean()
}).strict()
export type ModelAttemptAccounting = z.infer<typeof ModelAttemptAccountingSchema>
export type AttemptUsageTotals = z.infer<typeof AttemptUsageTotalsSchema>
