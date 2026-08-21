import { z } from 'zod'
import { MODEL_ENDPOINT_FORMATS } from './model-endpoint-format.js'
import {
  LocalModelGatewayConfigSchema,
  ModelRoutePoolConfigSchema
} from './model-route-pool.js'
import { ModelCapabilityMetadata } from './capabilities.js'

export const ModelConnectionProxySchema = z.object({
  enabled: z.boolean(),
  url: z.string().max(2_048)
}).strict()

export const ModelConnectionCredentialStatusSchema = z.enum([
  'ready',
  'missing',
  'unreadable'
])

export const ModelConnectionCredentialErrorCodeSchema = z.enum([
  'credential_missing',
  'credential_unreadable'
])

export const ModelConnectionProfileSchema = z.object({
  id: z.string().min(1).max(128),
  accountId: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  presetSource: z.string().min(1).max(128).optional(),
  presetMode: z.enum(['api', 'token-plan']).optional(),
  kind: z.enum([
    'http',
    'agent-sdk',
    'antigravity-cli',
    'cursor-sdk',
    'gemini-cli-api',
    'gemini-code-assist'
  ]),
  authType: z.enum(['api-key', 'oauth', 'subscription']),
  baseUrl: z.string().url().optional(),
  endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS),
  configured: z.boolean(),
  credentialStatus: ModelConnectionCredentialStatusSchema.optional(),
  credentialErrorCode: ModelConnectionCredentialErrorCodeSchema.optional(),
  models: z.array(z.string().min(1).max(512)).max(500),
  modelCapabilities: z.record(z.string(), ModelCapabilityMetadata).optional(),
  selectedModel: z.string().min(1).max(512).optional()
}).strict()

export const ModelConnectionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  providers: z.array(ModelConnectionProfileSchema),
  defaultProviderId: z.string().min(1).optional(),
  defaultAccountId: z.string().min(1).optional(),
  defaultModel: z.string().min(1).optional(),
  proxy: ModelConnectionProxySchema.default({ enabled: false, url: '' }),
  routePools: z.array(ModelRoutePoolConfigSchema).default([]),
  localModelGateway: LocalModelGatewayConfigSchema.default({ enabled: false })
}).strict()

export const ModelConnectionGlobalsRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  proxy: ModelConnectionProxySchema,
  routePools: z.array(ModelRoutePoolConfigSchema),
  localModelGateway: LocalModelGatewayConfigSchema
}).strict()

export const ModelConnectionConnectRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  id: z.string().min(1).max(128).optional(),
  name: z.string().min(1).max(120),
  presetSource: z.string().min(1).max(128).optional(),
  presetMode: z.enum(['api', 'token-plan']).optional(),
  kind: z.enum([
    'http',
    'agent-sdk',
    'antigravity-cli',
    'cursor-sdk',
    'gemini-cli-api',
    'gemini-code-assist'
  ]).default('http'),
  authType: z.enum(['api-key', 'oauth', 'subscription']).default('api-key'),
  baseUrl: z.string().url().optional(),
  endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS).default('chat_completions'),
  credential: z.string().max(64 * 1024).optional(),
  models: z.array(z.string().min(1).max(512)).max(500).default([]),
  modelCapabilities: z.record(z.string(), ModelCapabilityMetadata).optional(),
  selectedModel: z.string().min(1).max(512).optional(),
  probe: z.boolean().default(true),
  select: z.boolean().default(true)
}).strict()

export const ModelConnectionSelectRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  providerId: z.string().min(1).max(128),
  accountId: z.string().min(1).max(128).optional(),
  model: z.string().min(1).max(512)
}).strict()

export const ModelConnectionCredentialRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  credential: z.string().min(1).max(64 * 1024)
}).strict()

export const ModelConnectionCredentialOperationTokenSchema = z.string()
  .max(128)
  .regex(
    /^credential:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]*$/iu,
    'credential operation token must contain a stable client id and a positive generation'
  )

export const ModelConnectionCredentialPrepareRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  credential: z.string().min(1).max(64 * 1024),
  operationToken: ModelConnectionCredentialOperationTokenSchema
}).strict()

export const ModelConnectionCredentialFenceRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  operationToken: ModelConnectionCredentialOperationTokenSchema
}).strict()

export const ModelConnectionCredentialCommitRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  operationToken: ModelConnectionCredentialOperationTokenSchema
}).strict()

export const ModelConnectionPatchRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  name: z.string().min(1).max(120).optional(),
  presetSource: z.string().min(1).max(128).optional(),
  presetMode: z.enum(['api', 'token-plan']).optional(),
  kind: z.enum([
    'http',
    'agent-sdk',
    'antigravity-cli',
    'cursor-sdk',
    'gemini-cli-api',
    'gemini-code-assist'
  ]).optional(),
  authType: z.enum(['api-key', 'oauth', 'subscription']).optional(),
  baseUrl: z.string().url().optional(),
  endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS).optional(),
  models: z.array(z.string().min(1).max(512)).max(500).optional(),
  modelCapabilities: z.record(z.string(), ModelCapabilityMetadata).optional(),
  selectedModel: z.string().min(1).max(512).optional()
}).strict()

export const ModelConnectionOAuthStartRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  provider: z.enum(['chatgpt', 'grok', 'claude']),
  select: z.boolean().default(true),
  model: z.string().min(1).max(512).optional()
}).strict()

export const ModelConnectionOAuthSubmitRequestSchema = z.object({
  code: z.string().min(1).max(16 * 1024)
}).strict()

export const ModelConnectionOAuthStatusSchema = z.object({
  sessionId: z.string().min(1),
  provider: z.enum(['chatgpt', 'grok', 'claude']),
  status: z.enum(['pending', 'connected', 'cancelled', 'failed']),
  url: z.string().url().optional(),
  userCode: z.string().min(1).optional(),
  interval: z.number().int().positive().optional(),
  expiresAt: z.string().datetime(),
  message: z.string().optional(),
  snapshot: ModelConnectionSnapshotSchema.optional()
}).strict()

export const ModelConnectionCliAuthRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  provider: z.enum(['gemini-cli', 'antigravity']),
  select: z.boolean().default(true),
  model: z.string().min(1).max(512).optional()
}).strict()

export const ClaudeSdkInstallStatusSchema = z.object({
  installed: z.boolean(),
  path: z.string().optional(),
  status: z.enum(['idle', 'downloading', 'done', 'error']),
  receivedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  message: z.string().optional()
}).strict()

export type ModelConnectionProfile = z.infer<typeof ModelConnectionProfileSchema>
export type ModelConnectionSnapshot = z.infer<typeof ModelConnectionSnapshotSchema>
export type ModelConnectionCredentialStatus = z.infer<typeof ModelConnectionCredentialStatusSchema>
export type ModelConnectionCredentialErrorCode = z.infer<typeof ModelConnectionCredentialErrorCodeSchema>

/**
 * Snapshots written before credential health was published have no
 * `credentialStatus`. Preserve their previous `configured` behavior while
 * preventing known-bad credential references from being selected or used.
 */
export function isModelConnectionProfileUsable(
  profile: Pick<ModelConnectionProfile, 'configured' | 'credentialStatus'>
): boolean {
  return profile.configured &&
    profile.credentialStatus !== 'missing' &&
    profile.credentialStatus !== 'unreadable'
}

export type ModelConnectionConnectRequest = z.infer<typeof ModelConnectionConnectRequestSchema>
export type ModelConnectionCredentialPrepareRequest = z.infer<typeof ModelConnectionCredentialPrepareRequestSchema>
export type ModelConnectionCredentialFenceRequest = z.infer<typeof ModelConnectionCredentialFenceRequestSchema>
export type ModelConnectionCredentialCommitRequest = z.infer<typeof ModelConnectionCredentialCommitRequestSchema>
export type ModelConnectionSelectRequest = z.infer<typeof ModelConnectionSelectRequestSchema>
export type ModelConnectionOAuthStartRequest = z.infer<typeof ModelConnectionOAuthStartRequestSchema>
export type ModelConnectionOAuthStatus = z.infer<typeof ModelConnectionOAuthStatusSchema>
export type ModelConnectionCliAuthRequest = z.infer<typeof ModelConnectionCliAuthRequestSchema>
export type ClaudeSdkInstallStatus = z.infer<typeof ClaudeSdkInstallStatusSchema>
