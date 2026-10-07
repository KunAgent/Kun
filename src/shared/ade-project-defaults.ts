import { HarnessGatewayBindingSchema } from '../../kun/src/contracts/harness-gateway-binding.js'
import { z } from 'zod'

/** Local project defaults are intentionally a small, non-secret allow-list. */
export const AdeProjectRouteSchema = z.object({
  harnessId: z.string().trim().regex(/^[a-z][a-z0-9-]{1,47}$/),
  model: z.string().trim().min(1).max(512),
  providerId: z.string().trim().min(1).max(128).optional(),
  credentialMode: z.enum(['native-login', 'provider', 'kun-gateway']).optional(),
  gatewayBinding: HarnessGatewayBindingSchema.optional()
}).strict().superRefine((route, ctx) => {
  if (route.gatewayBinding && (route.credentialMode !== 'kun-gateway' || route.harnessId === 'kun' || Boolean(route.providerId))) {
    ctx.addIssue({ code: 'custom', path: ['gatewayBinding'], message: 'Gateway aliases require an external Agent and cannot also name a provider connection' })
  }
  if ((route.credentialMode === 'provider' || route.credentialMode === 'kun-gateway') && !route.providerId && !route.gatewayBinding) {
    ctx.addIssue({ code: 'custom', path: ['providerId'], message: 'provider route requires providerId' })
  }
})
export type AdeProjectRoute = z.infer<typeof AdeProjectRouteSchema>

const LimitsSchema = z.object({
  softWorkers: z.number().int().min(1).max(16),
  hardWorkers: z.number().int().min(1).max(32)
}).strict().refine((value) => value.hardWorkers >= value.softWorkers)

const BudgetSchema = z.object({
  softTokens: z.number().int().positive().optional(),
  hardTokens: z.number().int().positive().optional()
}).strict().refine((value) => !value.softTokens || !value.hardTokens || value.hardTokens >= value.softTokens)

export const AdeProjectDefaultsFieldsSchema = z.object({
  route: AdeProjectRouteSchema.optional(),
  collaborationEnabled: z.boolean().optional(),
  managerModel: z.object({
    providerId: z.string().trim().min(1).max(128),
    model: z.string().trim().min(1).max(512)
  }).strict().optional(),
  limits: LimitsSchema.optional(),
  budget: BudgetSchema.optional(),
  isolation: z.enum(['worktree', 'local', 'directory']).optional()
}).strict()
export const AdeProjectDefaultsSchema = AdeProjectDefaultsFieldsSchema
export type AdeProjectDefaults = z.infer<typeof AdeProjectDefaultsSchema>

export const AdeProjectDefaultsMapSchema = z.record(
  z.string().min(1).max(4_096), AdeProjectDefaultsSchema
).refine((entries) => Object.keys(entries).length <= 64, { message: 'At most 64 project defaults are supported' })

export const AdeProjectDefaultFieldSchema = z.enum([
  'route', 'collaborationEnabled', 'managerModel', 'limits', 'budget', 'isolation'
])
export type AdeProjectDefaultField = z.infer<typeof AdeProjectDefaultFieldSchema>

export const AdeProjectDefaultsMutationSchema = z.object({
  projectPath: z.string().trim().min(1).max(4_096),
  expectedRevision: z.string().min(1).max(128),
  set: AdeProjectDefaultsFieldsSchema.optional(),
  unset: z.array(AdeProjectDefaultFieldSchema).max(6).optional()
}).strict().superRefine((input, ctx) => {
  const setKeys = new Set(Object.keys(input.set ?? {}))
  const unsetKeys = input.unset ?? []
  if (setKeys.size === 0 && unsetKeys.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['set'], message: 'set or unset is required' })
  }
  if (new Set(unsetKeys).size !== unsetKeys.length || unsetKeys.some((key) => setKeys.has(key))) {
    ctx.addIssue({ code: 'custom', path: ['unset'], message: 'fields may be changed only once' })
  }
})
export type AdeProjectDefaultsMutation = z.infer<typeof AdeProjectDefaultsMutationSchema>

export const AdeProjectDefaultsQuerySchema = z.object({
  projectPath: z.string().trim().min(1).max(4_096)
}).strict()
export type AdeProjectDefaultsQuery = z.infer<typeof AdeProjectDefaultsQuerySchema>

export type AdeProjectIdentity = {
  key: string
  sourcePath: string
  kind: 'git' | 'directory'
}

export type AdeProjectDefaultsSnapshot = {
  project: AdeProjectIdentity
  value: AdeProjectDefaults
  revision: string
}

export type AdeProjectDefaultsMutationResult =
  | ({ ok: true; generation: number } & AdeProjectDefaultsSnapshot)
  | ({ ok: false; kind: 'conflict' } & AdeProjectDefaultsSnapshot)

export type AdeProjectDefaultsBridge = {
  getAdeProjectDefaults: (request: AdeProjectDefaultsQuery) => Promise<AdeProjectDefaultsSnapshot>
  saveAdeProjectDefaults: (request: AdeProjectDefaultsMutation) => Promise<AdeProjectDefaultsMutationResult>
}

export function normalizeAdeProjectDefaultsMap(value: unknown): Record<string, AdeProjectDefaults> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, AdeProjectDefaults> = {}
  for (const [key, candidate] of Object.entries(value).slice(0, 64)) {
    if (!key || key.length > 4_096) continue
    const parsed = AdeProjectDefaultsSchema.safeParse(candidate)
    if (parsed.success && Object.keys(parsed.data).length > 0) out[key] = parsed.data
  }
  return out
}

export function mutateAdeProjectDefaults(
  current: AdeProjectDefaults,
  mutation: Pick<AdeProjectDefaultsMutation, 'set' | 'unset'>
): AdeProjectDefaults {
  const next: Record<string, unknown> = { ...current, ...(mutation.set ?? {}) }
  for (const key of mutation.unset ?? []) delete next[key]
  return AdeProjectDefaultsSchema.parse(next)
}
