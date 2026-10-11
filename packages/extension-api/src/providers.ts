import { z } from 'zod'
import { ProviderBindingSchema } from './accounts.js'
import { JsonObjectSchema, JsonValueSchema, type JsonValue } from './common.js'
import type { CancellationToken } from './tools.js'

export const ModelModalitySchema = z.enum(['text', 'image', 'audio', 'video', 'file'])
export type ModelModality = z.infer<typeof ModelModalitySchema>

export const ModelCapabilitiesSchema = z.strictObject({
  input: z.array(ModelModalitySchema).min(1),
  output: z.array(ModelModalitySchema).min(1),
  reasoning: z.boolean().default(false),
  tools: z.boolean().default(false),
  parallelTools: z.boolean().default(false),
  streaming: z.boolean().default(true),
  maxContextTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional()
})
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>

export const ProviderModelSchema = z.strictObject({
  id: z.string().min(1).max(256),
  displayName: z.string().min(1).max(256),
  description: z.string().max(2048).optional(),
  capabilities: ModelCapabilitiesSchema
})
export type ProviderModel = z.infer<typeof ProviderModelSchema>

export const ModelProviderDeclarationSchema = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  displayName: z.string().min(1).max(128),
  authenticationProviderId: z.string().min(1).max(64).optional(),
  /** Hosts to which Account Broker credentials may be attached. */
  credentialHosts: z.array(z.string().regex(
    /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
  )).max(64).default([]),
  adapterApiVersion: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  models: z.array(ProviderModelSchema).max(512).default([]),
  /**
   * The provider may be offered to external agents through Kun's local
   * gateway. Declaring it changes nothing by itself: the user must also
   * choose which account to export in Kun's gateway settings.
   */
  gatewayExport: z.boolean().optional()
})
export type ModelProviderDeclaration = z.infer<typeof ModelProviderDeclarationSchema>
export type ModelProviderDeclarationInput = z.input<typeof ModelProviderDeclarationSchema>

export const ModelContentPartSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({ type: z.literal('image'), mimeType: z.string(), data: z.string(), name: z.string().optional() }),
  z.strictObject({ type: z.literal('audio'), mimeType: z.string(), data: z.string(), name: z.string().optional() }),
  z.strictObject({ type: z.literal('video'), mimeType: z.string(), data: z.string(), name: z.string().optional() }),
  z.strictObject({ type: z.literal('file'), mimeType: z.string(), data: z.string(), name: z.string() })
])
export type ModelContentPart = z.infer<typeof ModelContentPartSchema>

export const ModelMessageSchema = z.strictObject({
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: z.array(ModelContentPartSchema),
  name: z.string().max(256).optional(),
  toolCallId: z.string().max(256).optional(),
  metadata: JsonObjectSchema.optional()
})
export type ModelMessage = z.infer<typeof ModelMessageSchema>

export const ModelToolSchema = z.strictObject({
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(2048),
  inputSchema: JsonObjectSchema
})
export type ModelTool = z.infer<typeof ModelToolSchema>

export const ModelProviderRequestSchema = z.strictObject({
  apiVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  requestId: z.string().min(1).max(256),
  binding: ProviderBindingSchema,
  instructions: z.array(z.string()).default([]),
  messages: z.array(ModelMessageSchema),
  tools: z.array(ModelToolSchema).default([]),
  generation: z
    .strictObject({
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().min(0).max(1).optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      stop: z.array(z.string()).max(16).optional(),
      reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
      toolChoice: z.union([
        z.enum(['auto', 'none', 'required']),
        z.strictObject({ type: z.literal('tool'), name: z.string().min(1).max(256) })
      ]).optional()
    })
    .default({}),
  metadata: JsonObjectSchema.optional()
})
export type ModelProviderRequest = z.infer<typeof ModelProviderRequestSchema>

const ProviderEventBase = {
  requestId: z.string().min(1).max(256),
  sequence: z.number().int().nonnegative()
}

export const ModelUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional()
}).superRefine((usage, context) => {
  if ((usage.cost === undefined) !== (usage.currency === undefined)) {
    context.addIssue({
      code: 'custom',
      path: usage.cost === undefined ? ['cost'] : ['currency'],
      message: 'cost and currency must be reported together'
    })
  }
})
export type ModelUsage = z.infer<typeof ModelUsageSchema>

export const ModelProviderStreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...ProviderEventBase, type: z.literal('textDelta'), delta: z.string() }),
  z.strictObject({ ...ProviderEventBase, type: z.literal('reasoningDelta'), delta: z.string() }),
  z.strictObject({
    ...ProviderEventBase,
    type: z.literal('toolCallDelta'),
    callId: z.string().min(1).max(256),
    nameDelta: z.string().optional(),
    argumentsDelta: z.string().optional()
  }),
  z.strictObject({
    ...ProviderEventBase,
    type: z.literal('toolCallComplete'),
    callId: z.string().min(1).max(256),
    name: z.string().min(1).max(256),
    input: JsonObjectSchema
  }),
  z.strictObject({ ...ProviderEventBase, type: z.literal('usage'), usage: ModelUsageSchema }),
  z.strictObject({
    ...ProviderEventBase,
    type: z.literal('completed'),
    finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter', 'other']),
    usage: ModelUsageSchema.optional()
  }),
  z.strictObject({
    ...ProviderEventBase,
    type: z.literal('error'),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(4096),
    retryable: z.boolean().default(false),
    details: JsonObjectSchema.optional()
  })
])
export type ModelProviderStreamEvent = z.infer<typeof ModelProviderStreamEventSchema>

export const ProviderProbeResultSchema = z.strictObject({
  ok: z.boolean(),
  latencyMs: z.number().nonnegative().optional(),
  message: z.string().max(4096).optional(),
  details: JsonObjectSchema.optional()
})
export type ProviderProbeResult = z.infer<typeof ProviderProbeResultSchema>

export interface ModelProviderOperationContext {
  readonly cancellation: CancellationToken
}

export interface ModelProviderAdapter {
  probe(binding: z.infer<typeof ProviderBindingSchema>, context: ModelProviderOperationContext): Promise<ProviderProbeResult>
  listModels(
    binding: z.infer<typeof ProviderBindingSchema>,
    context: ModelProviderOperationContext
  ): Promise<ProviderModel[]>
  stream(
    request: ModelProviderRequest,
    context: ModelProviderOperationContext
  ): AsyncIterable<ModelProviderStreamEvent>
  cancel(requestId: string): void | Promise<void>
  countTokens?(request: ModelProviderRequest, context: ModelProviderOperationContext): Promise<number>
}

export const ProviderStatusSchema = z.strictObject({
  providerId: z.string().min(1).max(129),
  status: z.enum(['available', 'degraded', 'unavailable', 'interaction-required']),
  message: z.string().max(4096).optional(),
  checkedAt: z.string().datetime()
})
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>
