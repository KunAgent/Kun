import { z } from 'zod'

export const GatewayProtocolSchema = z.enum(['chat_completions', 'responses', 'messages', 'gemini'])
const ids = z.array(z.string().min(1).max(512)).max(2_000)
export const GatewayClientPolicySchema = z.object({
  mode: z.enum(['scoped', 'legacy-unrestricted']).default('scoped'),
  enabled: z.boolean().default(true),
  allowedRouteIds: ids.default([]),
  allowedModelIds: ids.default([]),
  allowedConnectionIds: ids.default([]),
  allowedProtocols: z.array(GatewayProtocolSchema).min(1).max(4)
    .default(['chat_completions', 'responses', 'messages', 'gemini']),
  expiresAt: z.string().datetime().optional(),
  maxConcurrent: z.number().int().min(1).max(128).default(2),
  requestsPerMinute: z.number().int().min(1).max(60_000).default(60),
  burst: z.number().int().min(1).max(1_000).default(20),
  maxBodyBytes: z.number().int().min(1_024).max(32 * 1024 * 1024).default(2 * 1024 * 1024),
  maxOutputTokens: z.number().int().min(1).max(1_048_576).optional(),
  requestTimeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  /** Reference cost estimate alert only; never a currency spending guarantee. */
  costAlert: z.object({ usd: z.number().finite().positive(), period: z.enum(['day', 'week', 'month']),
    timeZone: z.string().min(1).max(128).refine((value) => {
      try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
    }, 'Unknown cost alert time zone') }).strict().optional(),
  tokenBudget: z.object({
    mode: z.enum(['hard', 'soft']).default('hard'),
    period: z.enum(['day', 'week', 'month']),
    timeZone: z.string().min(1).max(128).refine((value) => {
      try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
    }, 'Unknown budget time zone'),
    tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  }).strict().optional()
}).strict().superRefine((policy, context) => {
  if (policy.tokenBudget && policy.costAlert && (policy.tokenBudget.period !== policy.costAlert.period ||
    policy.tokenBudget.timeZone !== policy.costAlert.timeZone)) context.addIssue({ code: 'custom',
    path: ['costAlert'], message: 'Cost alerts and token budgets must use the same period and time zone.' })
})
export type GatewayClientPolicy = z.infer<typeof GatewayClientPolicySchema>
export type GatewayProtocol = z.infer<typeof GatewayProtocolSchema>

export function legacyGatewayClientPolicy(): GatewayClientPolicy {
  return GatewayClientPolicySchema.parse({ mode: 'legacy-unrestricted' })
}

export function gatewayPolicyActive(policy: GatewayClientPolicy, now = Date.now()): boolean {
  return policy.enabled && (!policy.expiresAt || Date.parse(policy.expiresAt) > now)
}
