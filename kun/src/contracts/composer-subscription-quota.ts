import { z } from 'zod'
import { ProviderQuotaEntrySchema } from './provider-quota.js'

export const ComposerSubscriptionQuotaQuerySchema = z.object({
  harnessId: z.string().trim().min(1).max(128),
  credentialMode: z.enum(['native-login', 'provider', 'kun-gateway']).optional(),
  providerId: z.string().trim().max(128).optional(),
  accountId: z.string().trim().max(128).optional(),
  workspaceRoot: z.string().max(4_096).optional(),
  gatewayBinding: z.boolean().optional(),
  forceRefresh: z.boolean().optional()
}).strict()
export const ComposerSubscriptionQuotaResponseSchema = z.object({
  entry: ProviderQuotaEntrySchema.nullable(),
  refreshedAt: z.string().datetime(),
  /** Random process-local scope version; never a credential hash or account data. */
  scopeKey: z.string().max(128).optional()
}).strict()
export type ComposerSubscriptionQuotaQuery = z.infer<typeof ComposerSubscriptionQuotaQuerySchema>
export type ComposerSubscriptionQuotaResponse = z.infer<typeof ComposerSubscriptionQuotaResponseSchema>
