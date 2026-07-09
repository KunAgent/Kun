import { z } from 'zod'

export const ConnectorAuthKindSchema = z.enum([
  'none',
  'api_key',
  'oauth2',
  'mcp_oauth',
  'service_account'
])
export type ConnectorAuthKind = z.infer<typeof ConnectorAuthKindSchema>

export const ConnectorPermissionScopeSchema = z.enum([
  'user',
  'workspace',
  'project',
  'organization',
  'external_account'
])
export type ConnectorPermissionScope = z.infer<typeof ConnectorPermissionScopeSchema>

export const ConnectorCapabilitySchema = z.enum([
  'read',
  'write',
  'destructive',
  'network',
  'files',
  'commands',
  'secrets',
  'audit'
])
export type ConnectorCapability = z.infer<typeof ConnectorCapabilitySchema>

export const ConnectorRiskLevelSchema = z.enum(['low', 'medium', 'high'])
export type ConnectorRiskLevel = z.infer<typeof ConnectorRiskLevelSchema>

export const ConnectorAuthSchema = z
  .object({
    kind: ConnectorAuthKindSchema,
    scopes: z.array(z.string().min(1)).default([]),
    authorizationUrl: z.string().url().optional(),
    tokenUrl: z.string().url().optional(),
    callbackUrl: z.string().url().optional(),
    tokenRotation: z.boolean().default(false),
    revocable: z.boolean().default(false)
  })
  .strict()
  .superRefine((auth, ctx) => {
    if ((auth.kind === 'oauth2' || auth.kind === 'mcp_oauth') && !auth.authorizationUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['authorizationUrl'],
        message: `${auth.kind} connectors require an authorizationUrl`
      })
    }
  })
export type ConnectorAuth = z.infer<typeof ConnectorAuthSchema>

export const ConnectorPermissionSchema = z
  .object({
    scopes: z.array(ConnectorPermissionScopeSchema).default(['user']),
    capabilities: z.array(ConnectorCapabilitySchema).min(1),
    risk: ConnectorRiskLevelSchema.default('low'),
    reason: z.string().min(1).optional(),
    source: z.string().min(1).optional()
  })
  .strict()
export type ConnectorPermission = z.infer<typeof ConnectorPermissionSchema>

export const ConnectorToolSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    adapter: z.enum(['mcp', 'connector', 'workflow']),
    permissions: z.array(ConnectorPermissionSchema).default([])
  })
  .strict()
export type ConnectorTool = z.infer<typeof ConnectorToolSchema>

export const ConnectorAuditSchema = z
  .object({
    enabled: z.boolean().default(true),
    events: z.array(z.enum(['auth', 'read', 'write', 'destructive', 'token', 'config'])).default([
      'auth',
      'write',
      'destructive',
      'token',
      'config'
    ]),
    redactSecrets: z.boolean().default(true),
    retentionDays: z.number().int().positive().max(3650).default(90)
  })
  .strict()
export type ConnectorAudit = z.infer<typeof ConnectorAuditSchema>

export const ConnectorSupplyChainSchema = z
  .object({
    versionLock: z.string().min(1).optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    signature: z.string().min(1).optional(),
    rollbackSupported: z.boolean().default(false)
  })
  .strict()
export type ConnectorSupplyChain = z.infer<typeof ConnectorSupplyChainSchema>

export const ConnectorManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    name: z.string().min(1),
    vendor: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    version: z.string().min(1),
    homepageUrl: z.string().url().optional(),
    auth: ConnectorAuthSchema,
    permissions: z.array(ConnectorPermissionSchema).default([]),
    tools: z.array(ConnectorToolSchema).default([]),
    audit: ConnectorAuditSchema.default(() => ConnectorAuditSchema.parse({})),
    supplyChain: ConnectorSupplyChainSchema.default(() => ConnectorSupplyChainSchema.parse({}))
  })
  .strict()
export type ConnectorManifestV1 = z.infer<typeof ConnectorManifestV1Schema>

export type ConnectorPermissionSummary = {
  capabilities: ConnectorCapability[]
  scopes: ConnectorPermissionScope[]
  risk: ConnectorRiskLevel
  destructive: boolean
  sources: string[]
}

export function summarizeConnectorPermissions(manifest: ConnectorManifestV1): ConnectorPermissionSummary {
  const permissions = [
    ...manifest.permissions,
    ...manifest.tools.flatMap((tool) => tool.permissions)
  ]
  const capabilities = uniqueSorted(permissions.flatMap((permission) => permission.capabilities))
  const scopes = uniqueSorted(permissions.flatMap((permission) => permission.scopes))
  const sources = uniqueSorted(permissions.flatMap((permission) => permission.source ? [permission.source] : []))
  const risk = permissions.reduce<ConnectorRiskLevel>(
    (current, permission) => riskRank(permission.risk) > riskRank(current) ? permission.risk : current,
    'low'
  )
  return {
    capabilities,
    scopes,
    risk,
    destructive: capabilities.includes('destructive'),
    sources
  }
}

export function connectorRequiresInstallPreview(manifest: ConnectorManifestV1): boolean {
  const summary = summarizeConnectorPermissions(manifest)
  return summary.risk !== 'low' || summary.destructive || summary.capabilities.includes('secrets')
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort()
}

function riskRank(value: ConnectorRiskLevel): number {
  switch (value) {
    case 'low':
      return 0
    case 'medium':
      return 1
    case 'high':
      return 2
  }
}
