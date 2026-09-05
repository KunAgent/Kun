import { z } from 'zod'
import { UsageSnapshotSchema } from './usage.js'

export const MODEL_REQUEST_TRACE_SCHEMA_VERSION = 1 as const
export const MODEL_REQUEST_TRACE_REDACTED_VALUE = '[REDACTED]' as const
export const MAX_MODEL_REQUEST_TRACE_TOOL_CATALOG_ENTRIES = 512
export const MAX_MODEL_REQUEST_TRACE_TOOL_NAME_LENGTH = 256
export const MAX_MODEL_REQUEST_TRACE_PROVIDER_KIND_LENGTH = 64
export const MAX_MODEL_REQUEST_TRACE_PROVIDER_ID_LENGTH = 256

export const ModelRequestTraceToolCatalogEntrySchema = z.object({
  name: z.string().min(1).max(MAX_MODEL_REQUEST_TRACE_TOOL_NAME_LENGTH),
  providerKind: z.string().min(1).max(MAX_MODEL_REQUEST_TRACE_PROVIDER_KIND_LENGTH).optional(),
  providerId: z.string().min(1).max(MAX_MODEL_REQUEST_TRACE_PROVIDER_ID_LENGTH).optional()
})
export type ModelRequestTraceToolCatalogEntry = z.infer<
  typeof ModelRequestTraceToolCatalogEntrySchema
>

export const ModelRequestTraceBodySchema = z.object({
  text: z.string(),
  capturedBytes: z.number().int().nonnegative(),
  originalBytes: z.number().int().nonnegative(),
  truncated: z.boolean()
})
export type ModelRequestTraceBody = z.infer<typeof ModelRequestTraceBodySchema>

export const ModelRequestTraceHeadersSchema = z.object({
  values: z.record(z.string(), z.string()),
  redactedNames: z.array(z.string())
})
export type ModelRequestTraceHeaders = z.infer<typeof ModelRequestTraceHeadersSchema>

export const ModelRequestTraceRequestSchema = z.object({
  method: z.enum(['POST', 'CLI', 'SDK']),
  url: z.string(),
  urlRedacted: z.boolean(),
  headers: ModelRequestTraceHeadersSchema,
  body: ModelRequestTraceBodySchema
})
export type ModelRequestTraceRequest = z.infer<typeof ModelRequestTraceRequestSchema>

export const ModelRequestTraceResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  statusText: z.string(),
  headers: ModelRequestTraceHeadersSchema,
  body: ModelRequestTraceBodySchema.optional(),
  captureError: z.string().optional()
})
export type ModelRequestTraceResponse = z.infer<typeof ModelRequestTraceResponseSchema>

export const ModelRequestTraceToolCallSchema = z.object({
  callId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown())
})

export const ModelRequestTraceToolResultSchema = z.object({
  callId: z.string(),
  toolName: z.string(),
  output: z.string(),
  isError: z.boolean()
})

export const ModelRequestTraceDelegatedCapabilitiesSchema = z.object({
  nativeResume: z.boolean(),
  structuredStreaming: z.boolean(),
  kunTools: z.boolean(),
  externalApproval: z.boolean(),
  liveSteering: z.boolean(),
  nativeContextTelemetry: z.boolean(),
  fork: z.boolean()
})

export const ModelRequestTraceDelegatedSchema = z.object({
  providerKind: z.enum(['agent-sdk', 'cursor-sdk', 'antigravity-cli']),
  phase: z.enum(['portable', 'resumed', 'rebased']),
  reason: z.enum([
    'new',
    'route_changed',
    'capabilities_changed',
    'history_changed',
    'native_state_unavailable'
  ]).optional(),
  contextManagement: z.literal('sdk-managed'),
  nativeHistory: z.enum(['known', 'unknown', 'none']),
  capabilities: ModelRequestTraceDelegatedCapabilitiesSchema
})
export type ModelRequestTraceDelegated = z.infer<typeof ModelRequestTraceDelegatedSchema>

export const ModelRequestTraceDecodedSchema = z.object({
  text: z.string(),
  reasoning: z.string(),
  toolCalls: z.array(ModelRequestTraceToolCallSchema),
  toolResults: z.array(ModelRequestTraceToolResultSchema).max(512).optional(),
  usage: UsageSnapshotSchema.optional(),
  stopReason: z.string().optional(),
  error: z.string().optional(),
  truncated: z.record(z.string(), z.boolean()).optional()
})
export type ModelRequestTraceDecoded = z.infer<typeof ModelRequestTraceDecodedSchema>

export const ModelRequestTracePhase = z.enum([
  'credential',
  'setup',
  'model',
  'transport',
  'sdk'
])
export type ModelRequestTracePhase = z.infer<typeof ModelRequestTracePhase>

export const ModelRequestTraceFailureOrigin = z.enum([
  'provider',
  'credential',
  'setup',
  'config',
  'runtime',
  'transport'
])
export type ModelRequestTraceFailureOrigin = z.infer<typeof ModelRequestTraceFailureOrigin>

export const ModelRequestTraceRecordSchema = z
  .object({
    schemaVersion: z.literal(MODEL_REQUEST_TRACE_SCHEMA_VERSION),
    id: z.string().min(1),
    roundId: z.string().min(1).optional(),
    step: z.number().int().nonnegative().optional(),
    purpose: z.string().min(1).max(64).optional(),
    captureMode: z.enum(['metadata', 'full']).optional(),
    manifestId: z.string().min(1).optional(),
    sequence: z.number().int().positive(),
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    provider: z.string(),
    model: z.string(),
    transport: z.enum(['http', 'cli', 'sdk']).optional(),
    /**
     * Pipeline stage that produced this record:
     * - `credential`: token read/refresh before any model request;
     * - `setup`: provider/account setup (e.g. Gemini loadCodeAssist);
     * - `model`: the actual LLM stream; the default for existing callers;
     * - `transport`: non-model delegated transports (CLI/SDK wrappers);
     * - `sdk`: agent-sdk / cursor-sdk delegated sessions.
     * Legacy records without the field are treated as `model`.
     */
    phase: ModelRequestTracePhase.optional(),
    /**
     * Where a failure originated. Lets the Agent Perspective distinguish
     * "no request was ever attempted" from "the provider rejected a request"
     * without guessing from the absence of a body.
     */
    failureOrigin: ModelRequestTraceFailureOrigin.optional(),
    /** Stable machine-readable failure code, e.g. `gemini_cli_setup_failed`. */
    diagnosticCode: z.string().max(256).optional(),
    endpointFormat: z.string(),
    attempt: z.number().int().positive(),
    attemptReason: z.enum([
      'initial',
      'transport_retry',
      'credential_refresh',
      'stream_options_fallback'
    ]),
    status: z.enum([
      'pending',
      'completed',
      'transport_error',
      'capture_error',
      'not_started',
      'failed',
      'cancelled',
      'interrupted'
    ]),
    startedAt: z.string(),
    firstTokenAt: z.string().optional(),
    receivedTextLength: z.number().int().nonnegative().optional(),
    receivedReasoningLength: z.number().int().nonnegative().optional(),
    responseStartedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    timeToHeadersMs: z.number().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
    /**
     * Present for every record that actually attempted a transport. A
     * `not_started` diagnostic record (e.g. local credential missing) has no
     * fabricated URL/headers/body — the renderer must show "no request".
     */
    request: ModelRequestTraceRequestSchema.optional(),
    delegated: ModelRequestTraceDelegatedSchema.optional(),
    toolCatalog: z.array(ModelRequestTraceToolCatalogEntrySchema)
      .max(MAX_MODEL_REQUEST_TRACE_TOOL_CATALOG_ENTRIES)
      .optional(),
    response: ModelRequestTraceResponseSchema.optional(),
    decoded: ModelRequestTraceDecodedSchema.optional(),
    error: z.string().optional(),
    captureWarnings: z.array(z.string()).optional()
  })
  .superRefine((record, ctx) => {
    if (record.status === 'not_started' && record.request !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['request'],
        message: 'not_started diagnostic records must not carry a fabricated request'
      })
    }
    if (record.status !== 'not_started' && record.request === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['request'],
        message: 'attempt records require a request payload'
      })
    }
    if (record.failureOrigin === 'credential' && record.phase !== 'credential') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['failureOrigin'],
        message: 'credential failures must be marked phase=credential'
      })
    }
  })
export type ModelRequestTraceRecord = z.infer<typeof ModelRequestTraceRecordSchema>

export type ModelRequestTraceLimits = {
  maxRequestBodyBytes: number
  maxResponseBodyBytes: number
  maxPageSize: number
}

export type ModelRequestTracePage = {
  schemaVersion: typeof MODEL_REQUEST_TRACE_SCHEMA_VERSION
  records: ModelRequestTraceRecord[]
  nextCursor?: string
  activeCount: number
  limits: ModelRequestTraceLimits
  warnings: string[]
}
