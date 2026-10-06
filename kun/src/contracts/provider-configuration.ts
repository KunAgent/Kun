import { ProviderSafeUrlSchema } from './provider-safe-url.js'
import { z } from 'zod'
import { MODEL_ENDPOINT_FORMATS } from './model-endpoint-format.js'
import { GatewayClientPolicySchema } from './gateway-client-policy.js'
import { ModelConnectionConnectRequestSchema, ModelConnectionPatchRequestSchema } from './model-connections.js'
import { ModelRoutePoolConfigSchema, ModelFailoverGroupSchema } from './model-route-pool.js'

const id = z.string().trim().min(1).max(128).refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value), 'Reserved configuration identifier')
const url = ProviderSafeUrlSchema
export const ProviderWireProtocolSchema = z.enum(['chat_completions', 'responses', 'messages'])
export const ProviderEndpointBindingSchema = z.discriminatedUnion('urlMode', [
  z.object({ urlMode: z.literal('base'), protocol: ProviderWireProtocolSchema, baseUrl: url }).strict(),
  z.object({ urlMode: z.literal('full'), protocol: ProviderWireProtocolSchema, requestUrl: url }).strict()
])
export const ProviderProxySelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }).strict(),
  z.object({ mode: z.literal('direct') }).strict(),
  z.object({ mode: z.literal('proxy'), url: z.string().min(1).max(2_048).refine((value) => {
    try { const parsed = new URL(value); return ['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) && !parsed.username && !parsed.password } catch { return false }
  }, 'Proxy credentials must not be stored in provider configuration') }).strict()
])
const pointer = z.string().max(256).regex(/^(?:\/(?:[^~]|~[01])*)?$/)
export const ProviderDiscoverySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }).strict(),
  z.object({ mode: z.literal('manual') }).strict(),
  z.object({
    mode: z.literal('custom'), modelsUrl: url,
    itemsPointer: pointer.default('/data'), idPointer: pointer.default('/id'),
    namePointer: pointer.optional(), nextCursorPointer: pointer.optional(),
    cursorParameter: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/).optional(),
    credentialHosts: z.array(z.string().min(1).max(253)).max(16).default([]),
    maxPages: z.number().int().min(1).max(20).default(10)
  }).strict()
])
export const ProviderRequestPurposeSchema = z.enum(['inference', 'discovery', 'oauth', 'quota', 'public-metadata'])
const credentialHost = z.string().min(1).max(253).refine((value) => {
  try { const parsed = new URL(`https://${value}`); return !/[\s/*#?]/.test(value) && parsed.host === value && !parsed.username && !parsed.password && parsed.pathname === '/' } catch { return false }
}, 'Expected an exact host with optional port; wildcards and URLs are not allowed')
export const ProviderSecretScopeSchema = z.object({
  hosts: z.array(credentialHost).max(16),
  purposes: z.array(ProviderRequestPurposeSchema).min(1).max(4)
    .refine((values) => !values.includes('public-metadata'), 'Provider secrets cannot be used for public metadata')
}).strict()
export const ProviderAuthProfileSchema = z.object({
  mode: z.enum(['adapter', 'header']).default('adapter'),
  headerName: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/).max(128).refine((value) => {
    const lower = value.toLowerCase()
    return (['authorization', 'api-key'].includes(lower) || lower.startsWith('x-')) && !/^x-(?:kun-|openai-internal-|forwarded-)/.test(lower)
  }, 'Use Authorization, api-key, or an ordinary custom x-* authentication header').optional(),
  prefix: z.enum(['', 'Bearer ', 'Basic ']).default('Bearer '),
  scope: ProviderSecretScopeSchema
}).strict().superRefine((profile, ctx) => {
  if (profile.mode === 'header' && !profile.headerName) ctx.addIssue({ code: 'custom', path: ['headerName'], message: 'Header authentication requires a header name' })
  if (profile.mode === 'adapter' && profile.headerName) ctx.addIssue({ code: 'custom', path: ['headerName'], message: 'Adapter authentication owns its header name' })
})
export const ProviderHeaderProfileSchema = z.object({ scope: ProviderSecretScopeSchema }).strict()
export type ProviderAuthProfile = z.infer<typeof ProviderAuthProfileSchema>
export type ProviderHeaderProfile = z.infer<typeof ProviderHeaderProfileSchema>
export type ProviderRequestPurpose = z.infer<typeof ProviderRequestPurposeSchema>
export const ProviderAdmissionSchema = z.object({
  inputTokenUpperBound: z.number().int().positive().max(16_777_216).optional(),
  maxConcurrent: z.number().int().min(1).max(128).default(8),
  maxQueued: z.number().int().min(0).max(1_024).default(32),
  queueWaitMs: z.number().int().min(1).max(120_000).default(10_000)
}).strict()
export const ProviderDefaultsSchema = z.object({
  baseUrl: url.optional(), endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS).optional(),
  endpoints: z.object({ chat_completions: url.optional(), responses: url.optional(), messages: url.optional() }).strict().optional(),
  proxy: ProviderProxySelectionSchema.optional(), discovery: ProviderDiscoverySchema.optional(),
  admission: ProviderAdmissionSchema.optional(),
  authProfile: ProviderAuthProfileSchema.optional(), headerProfile: ProviderHeaderProfileSchema.optional()
}).strict()
export const ProviderTemplateSchema = z.object({
  id, revision: z.number().int().positive(), name: z.string().min(1).max(120),
  adapterId: z.string().min(1).max(128), defaults: ProviderDefaultsSchema,
  description: z.string().max(1_024).optional()
}).strict()
export const ProviderGroupSchema = z.object({
  id, name: z.string().trim().min(1).max(120), enabled: z.boolean().default(true),
  template: ProviderTemplateSchema.optional(), defaults: ProviderDefaultsSchema.default({})
}).strict()
export const ProviderConnectionConfigurationSchema = z.object({
  migrationOrigin: z.object({ schemaVersion: z.literal(1), migratedAt: z.string().datetime() }).strict().optional(),
  groupId: id.optional(), enabled: z.boolean().default(true),
  inherit: z.array(z.enum(['baseUrl', 'endpointFormat', 'endpoints', 'proxy', 'discovery', 'admission', 'authProfile', 'headerProfile'])).max(8).default([]),
  endpointBinding: ProviderEndpointBindingSchema.optional(),
  proxy: ProviderProxySelectionSchema.optional(), discovery: ProviderDiscoverySchema.optional(),
  admission: ProviderAdmissionSchema.optional(),
  authProfile: ProviderAuthProfileSchema.optional(), headerProfile: ProviderHeaderProfileSchema.optional(),
  manualModels: z.array(z.string().min(1).max(512)).max(500).default([]),
  template: ProviderTemplateSchema.optional()
}).strict()
export const ProviderConfigurationStateSchema = z.object({
  groups: z.record(z.string(), ProviderGroupSchema).default({}),
  connections: z.record(z.string(), ProviderConnectionConfigurationSchema).default({}),
  templates: z.record(z.string(), ProviderTemplateSchema).default({}),
  gatewayPolicies: z.record(z.string(), GatewayClientPolicySchema).default({}),
  commits: z.record(z.string(), z.object({ previewId: z.string().uuid(), digest: z.string(), revision: z.number().int(), committedAt: z.string().datetime() }).strict()).default({})
}).strict()
export const ProviderConfigurationOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add-connection'), connection: ModelConnectionConnectRequestSchema
    .omit({ expectedRevision: true, credential: true, customHeaders: true, select: true, probe: true })
    .extend({ id }) }).strict(),
  z.object({ kind: z.literal('remove-connection'), connectionId: id }).strict(),
  z.object({ kind: z.literal('patch-connection'), connectionId: id, patch: ModelConnectionPatchRequestSchema
    .omit({ expectedRevision: true, customHeaders: true }) }).strict(),
  z.object({ kind: z.literal('clear-connection-fields'), connectionId: id,
    fields: z.array(z.enum(['baseUrl', 'endpoints', 'selectedModel', 'modelCapabilities', 'presetSource', 'presetMode'])).min(1).max(6) }).strict(),
  z.object({ kind: z.literal('apply-template'), templateId: id, revision: z.number().int().positive(),
    connectionIds: z.array(id).min(1).max(500),
    resetFields: z.array(z.enum(['baseUrl', 'endpointFormat', 'endpoints', 'proxy', 'discovery', 'admission', 'authProfile', 'headerProfile'])).max(8).default([]) }).strict(),
  z.object({ kind: z.literal('put-group'), group: ProviderGroupSchema }).strict(),
  z.object({ kind: z.literal('remove-group'), groupId: id }).strict(),
  z.object({ kind: z.literal('configure-connection'), connectionId: id, configuration: ProviderConnectionConfigurationSchema }).strict(),
  z.object({ kind: z.literal('put-template'), template: ProviderTemplateSchema }).strict(),
  z.object({ kind: z.literal('remove-template'), templateId: id }).strict(),
  z.object({ kind: z.literal('set-client-policy'), clientId: id, policy: GatewayClientPolicySchema }).strict(),
  z.object({ kind: z.literal('set-default-selection'), selection: z.object({ connectionId: id, modelId: z.string().min(1).max(512) }).strict().optional() }).strict(),
  z.object({ kind: z.literal('set-failover'), groups: z.array(ModelFailoverGroupSchema).max(100) }).strict(),
  z.object({ kind: z.literal('set-routes'), routes: z.array(ModelRoutePoolConfigSchema).max(100) }).strict()
])
export const ProviderConfigurationPreviewRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  operations: z.array(ProviderConfigurationOperationSchema).min(1).max(2_000)
}).strict()
export const ProviderConfigurationCommitRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), previewId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(128)
}).strict()
export type ProviderConnectionConfiguration = z.infer<typeof ProviderConnectionConfigurationSchema>
export type ProviderConfigurationState = z.infer<typeof ProviderConfigurationStateSchema>
export type ProviderGroup = z.infer<typeof ProviderGroupSchema>
export type ProviderDefaults = z.infer<typeof ProviderDefaultsSchema>
export type ProviderDiscovery = z.infer<typeof ProviderDiscoverySchema>
export type ProviderConfigurationOperation = z.infer<typeof ProviderConfigurationOperationSchema>
export type ProviderAdmission = z.infer<typeof ProviderAdmissionSchema>
export type ProviderConfigurationSnapshot = {
  schemaVersion: 2; revision: number; activeRevision: number
  defaultProviderId?: string; defaultAccountId?: string; defaultModel?: string
  configuration: Omit<ProviderConfigurationState, 'commits'>
  connections: import('./model-connections.js').ModelConnectionProfile[]
  connectionOverrides?: Record<string, Pick<import('./model-connections.js').ModelConnectionProfile, 'baseUrl' | 'endpointFormat' | 'endpoints' | 'useProxy'>>
  routePools: import('./model-route-pool.js').ModelRoutePoolConfig[]
  failover: import('./model-route-pool.js').ModelFailoverGroup[]
  localModelGateway: import('./model-route-pool.js').LocalModelGatewayConfig
  fieldSources: Record<string, Record<string, 'connection' | 'group' | 'template'>>
}
export type ProviderConfigurationPreview = {
  previewId: string; expectedRevision: number; expiresAt: string; digest: string
  operations: ProviderConfigurationOperation[]; affectedConnections: string[]
  references?: Array<{ connectionId: string; kind: string; path: string; blocking: boolean }>
  remaps?: Record<string, Record<string, string>>
  secretSlots?: Array<{ id: string; connectionId: string; kind: string; bound: boolean;
    names?: string[]; headerClass?: 'user' | 'adapter' }>
}
