/**
 * ACP (Agent Client Protocol) wire surface, protocolVersion 1.
 *
 * Protocol types come from the pinned official SDK — imported type-only so the
 * runtime carries no dependency on the package at execution time. The zod
 * schemas below validate only the fields Kun reads and pass everything else
 * through, so forward-compatible agents keep working; a missing or malformed
 * required field is a protocol error.
 */
import { z } from 'zod'
import type {
  AgentCapabilities,
  AvailableCommand,
  ContentBlock,
  InitializeResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PermissionOption,
  PromptResponse,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionNotification,
  SessionUpdate,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate
} from '@agentclientprotocol/sdk'

export const ACP_PROTOCOL_VERSION = 1

// ---- Official wire types Kun consumes (type-only re-exports) ---------------

export type {
  AgentCapabilities,
  AuthMethod,
  AuthenticateRequest,
  AvailableCommand,
  AvailableCommandsUpdate,
  ClientCapabilities,
  ConfigOptionUpdate,
  ContentBlock,
  CreateElicitationResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  CurrentModeUpdate,
  ElicitationContentValue,
  EmbeddedResource,
  EnvVariable,
  FileSystemCapabilities,
  HttpHeader,
  ImageContent,
  Implementation,
  InitializeRequest,
  InitializeResponse,
  KillTerminalRequest,
  LoadSessionRequest,
  LoadSessionResponse,
  McpCapabilities,
  McpServer,
  McpServerHttp,
  McpServerStdio,
  NewSessionRequest,
  NewSessionResponse,
  PermissionOption,
  PermissionOptionKind,
  PlanEntry,
  PromptCapabilities,
  PromptRequest,
  PromptResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  RequestPermissionOutcome,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResourceLink,
  SessionConfigOption,
  SessionId,
  SessionModeState,
  SessionNotification,
  SessionUpdate,
  SetSessionConfigOptionRequest,
  SetSessionModeRequest,
  StopReason,
  TerminalExitStatus,
  TerminalId,
  TerminalOutputRequest,
  TerminalOutputResponse,
  TextContent,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
  Usage,
  UsageUpdate,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse
} from '@agentclientprotocol/sdk'

// ---- Method names -----------------------------------------------------------

/** Client → agent request/notification methods (protocolVersion 1). */
export const ACP_AGENT_METHODS = {
  initialize: 'initialize',
  authenticate: 'authenticate',
  sessionNew: 'session/new',
  sessionLoad: 'session/load',
  sessionPrompt: 'session/prompt',
  sessionSetConfigOption: 'session/set_config_option',
  sessionSetMode: 'session/set_mode',
  sessionCancel: 'session/cancel'
} as const

/** Agent → client request/notification methods. */
export const ACP_CLIENT_METHODS = {
  requestPermission: 'session/request_permission',
  fsReadTextFile: 'fs/read_text_file',
  fsWriteTextFile: 'fs/write_text_file',
  terminalCreate: 'terminal/create',
  terminalOutput: 'terminal/output',
  terminalWaitForExit: 'terminal/wait_for_exit',
  terminalKill: 'terminal/kill',
  terminalRelease: 'terminal/release',
  elicitationCreate: 'elicitation/create',
  sessionUpdate: 'session/update'
} as const

/** Standard JSON-RPC 2.0 error codes plus Kun's policy denial code. */
export const ACP_RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Kun policy rejected a client-mediated action (write/command). */
  policyDenied: -32001,
  /** The sessionId has no live host context (turn ended or unknown). */
  sessionUnavailable: -32002
} as const

// ---- Errors -----------------------------------------------------------------

export type AcpErrorCode =
  /** Malformed frame, oversized line, or missing/invalid required field. */
  | 'harness_protocol_error'
  /** Process died while requests were outstanding. */
  | 'harness_crashed'
  /** Agent returned a JSON-RPC error object for the request. */
  | 'agent_error'
  /** Kun policy rejected an agent-requested client action (§8). */
  | 'policy_denied'
  | 'request_timeout'
  | 'request_aborted'
  | 'connection_closed'

export class AcpError extends Error {
  readonly code: AcpErrorCode
  readonly rpcCode?: number
  readonly data?: unknown

  constructor(
    code: AcpErrorCode,
    message: string,
    options: { rpcCode?: number; data?: unknown; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'AcpError'
    this.code = code
    if (options.rpcCode !== undefined) this.rpcCode = options.rpcCode
    if (options.data !== undefined) this.data = options.data
  }
}

// ---- JSON-RPC envelope ------------------------------------------------------

export const AcpJsonRpcIdSchema = z.union([
  z.number().int(),
  z.string().min(1).max(256)
])
export type AcpJsonRpcId = z.infer<typeof AcpJsonRpcIdSchema>

export const AcpJsonRpcErrorObjectSchema = z
  .object({
    code: z.number().int(),
    message: z.string().max(16_384),
    data: z.unknown().optional()
  })
  .passthrough()
export type AcpJsonRpcErrorObject = z.infer<typeof AcpJsonRpcErrorObjectSchema>

/**
 * A parsed frame. The `jsonrpc` marker is validated when present but absent
 * markers are tolerated — classification is by field shape (method+id →
 * request; method-only → notification; id+result/error → response).
 */
export const AcpJsonRpcFrameSchema = z
  .object({
    jsonrpc: z.literal('2.0').optional(),
    id: AcpJsonRpcIdSchema.nullish(),
    method: z.string().min(1).max(256).optional(),
    params: z.unknown().optional(),
    result: z.unknown().optional(),
    error: AcpJsonRpcErrorObjectSchema.optional()
  })
  .passthrough()
export type AcpJsonRpcFrame = z.infer<typeof AcpJsonRpcFrameSchema>

export function makeAcpRequest(
  id: AcpJsonRpcId,
  method: string,
  params?: unknown
): Record<string, unknown> {
  return params === undefined
    ? { jsonrpc: '2.0', id, method }
    : { jsonrpc: '2.0', id, method, params }
}

export function makeAcpNotification(
  method: string,
  params?: unknown
): Record<string, unknown> {
  return params === undefined
    ? { jsonrpc: '2.0', method }
    : { jsonrpc: '2.0', method, params }
}

export function makeAcpResultResponse(
  id: AcpJsonRpcId,
  result: unknown
): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result: result ?? {} }
}

export function makeAcpErrorResponse(
  id: AcpJsonRpcId,
  code: number,
  message: string,
  data?: unknown
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data }
  }
}

// ---- Params/results Kun reads (required fields only; rest passthrough) -------

const MetaSchema = z.object({ _meta: z.record(z.string(), z.unknown()).nullish() }).passthrough()

export const AcpPromptCapabilitiesSchema = MetaSchema.extend({
  image: z.boolean().optional(), audio: z.boolean().optional(),
  embeddedContext: z.boolean().optional()
})

// v1 sends booleans (`{http: true}`); the v2 draft declares transports by
// object presence (`{http: {}}`). Accept both so either dialect parses.
const McpTransportFlagSchema = z.union([z.boolean(), MetaSchema])

/** v1 boolean / v2 object-presence capability flag: truthy means supported. */
export function capabilityFlagOn(flag: boolean | Record<string, unknown> | null | undefined): boolean {
  return flag === true || (typeof flag === 'object' && flag !== null)
}

export const AcpAgentCapabilitiesSchema = MetaSchema.extend({
  loadSession: z.boolean().optional(),
  promptCapabilities: AcpPromptCapabilitiesSchema.optional(),
  elicitation: McpTransportFlagSchema.optional(),
  mcpCapabilities: MetaSchema.extend({
    http: McpTransportFlagSchema.optional(), stdio: McpTransportFlagSchema.optional()
  }).optional()
})

export const AcpInitializeResultSchema = MetaSchema.extend({
  protocolVersion: z.number().int(),
  agentCapabilities: AcpAgentCapabilitiesSchema.optional(),
  authMethods: z.array(MetaSchema.extend({ id: z.string(), name: z.string().optional() })).optional(),
  agentInfo: MetaSchema.extend({ name: z.string().optional(), version: z.string().optional() }).nullish()
})
export type AcpInitializeResult = z.infer<typeof AcpInitializeResultSchema>

const ConfigOptionValueSchema = MetaSchema.extend({
  value: z.string(),
  name: z.string()
})

const ConfigOptionOptionsSchema = z.union([
  z.array(ConfigOptionValueSchema),
  z.array(
    MetaSchema.extend({
      group: z.string(),
      name: z.string(),
      options: z.array(ConfigOptionValueSchema)
    })
  )
])

export const AcpConfigOptionSchema = z.intersection(
  z.union([
    MetaSchema.extend({
      type: z.literal('select'),
      currentValue: z.string(),
      options: ConfigOptionOptionsSchema
    }),
    MetaSchema.extend({
      type: z.literal('boolean'),
      currentValue: z.boolean()
    })
  ]),
  MetaSchema.extend({
    id: z.string().min(1),
    name: z.string().optional(),
    category: z.string().nullish()
  })
)

export type AcpConfigOption = z.infer<typeof AcpConfigOptionSchema>

/** Flattened select values regardless of grouped/flat `options` shape. */
export function acpConfigOptionValues(option: {
  options?: ReadonlyArray<
    { value: string } | { options: ReadonlyArray<{ value: string }> }
  > | null
}): string[] {
  const options = 'options' in option ? option.options : undefined
  if (!Array.isArray(options)) return []
  const values: string[] = []
  for (const entry of options) {
    if ('options' in entry && Array.isArray(entry.options)) {
      for (const inner of entry.options) values.push(inner.value)
    } else if ('value' in entry) {
      values.push(entry.value)
    }
  }
  return values
}

export const SessionModeStateSchema = MetaSchema.extend({
  currentModeId: z.string(),
  availableModes: z.array(
    MetaSchema.extend({
      id: z.string(),
      name: z.string().optional()
    })
  )
})
export type AcpSessionModes = z.infer<typeof SessionModeStateSchema>

export const AcpNewSessionResultSchema = MetaSchema.extend({
  sessionId: z.string().min(1).max(1_024),
  modes: SessionModeStateSchema.nullish(),
  configOptions: z.array(AcpConfigOptionSchema).nullish()
})

export const AcpLoadSessionResultSchema = MetaSchema.extend({
  modes: SessionModeStateSchema.nullish(),
  configOptions: z.array(AcpConfigOptionSchema).nullish()
})

export const AcpUsageSchema = MetaSchema.extend({
  totalTokens: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  thoughtTokens: z.number().nullish(),
  cachedReadTokens: z.number().nullish(),
  cachedWriteTokens: z.number().nullish()
})

export const AcpStopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled'
])

export const AcpPromptResultSchema = MetaSchema.extend({
  stopReason: AcpStopReasonSchema,
  usage: AcpUsageSchema.nullish()
})

// ---- session/update variants -------------------------------------------------

const TextContentBlockSchema = MetaSchema.extend({
  type: z.literal('text'),
  text: z.string()
})
const ImageContentBlockSchema = MetaSchema.extend({
  type: z.literal('image'),
  data: z.string(),
  mimeType: z.string()
})
const AudioContentBlockSchema = MetaSchema.extend({
  type: z.literal('audio'),
  data: z.string(),
  mimeType: z.string()
})
const ResourceLinkBlockSchema = MetaSchema.extend({
  type: z.literal('resource_link'),
  uri: z.string(),
  name: z.string()
})
const EmbeddedResourceBlockSchema = MetaSchema.extend({
  type: z.literal('resource'),
  resource: z.union([
    MetaSchema.extend({ uri: z.string(), text: z.string() }),
    MetaSchema.extend({ uri: z.string(), blob: z.string() })
  ])
})
/** Known blocks validate; unknown block types parse as opaque pass-through. */
export const AcpContentBlockSchema = z.union([
  TextContentBlockSchema,
  ImageContentBlockSchema,
  AudioContentBlockSchema,
  ResourceLinkBlockSchema,
  EmbeddedResourceBlockSchema,
  z.object({ type: z.string() }).passthrough()
])

const ToolCallContentItemSchema = z.union([
  MetaSchema.extend({ type: z.literal('content'), content: AcpContentBlockSchema }),
  MetaSchema.extend({
    type: z.literal('diff'),
    path: z.string().min(1),
    oldText: z.string().nullish(),
    newText: z.string()
  }),
  MetaSchema.extend({ type: z.literal('terminal'), terminalId: z.string() }),
  z.object({ type: z.string() }).passthrough()
])

const ToolCallLocationSchema = MetaSchema.extend({
  path: z.string(),
  line: z.number().int().nullish()
})

const AcpToolCallStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed'
])

const AcpToolKindSchema = z.enum([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other'
])

const ToolCallSharedFields = {
  kind: AcpToolKindSchema.nullish(),
  status: AcpToolCallStatusSchema.nullish(),
  content: z.array(ToolCallContentItemSchema).nullish(),
  locations: z.array(ToolCallLocationSchema).nullish(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional()
}

export const AcpToolCallSchema = MetaSchema.extend({
  sessionUpdate: z.literal('tool_call'),
  toolCallId: z.string().min(1).max(1_024),
  title: z.string().max(4_096),
  ...ToolCallSharedFields
})

export const AcpToolCallUpdateWireSchema = MetaSchema.extend({
  sessionUpdate: z.literal('tool_call_update'),
  toolCallId: z.string().min(1).max(1_024),
  title: z.string().max(4_096).nullish(),
  ...ToolCallSharedFields
})

const PlanEntrySchema = MetaSchema.extend({
  content: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'in_progress', 'completed'])
})

export const AcpPlanUpdateSchema = MetaSchema.extend({
  sessionUpdate: z.literal('plan'),
  entries: z.array(PlanEntrySchema)
})

export const AcpAvailableCommandsUpdateSchema = MetaSchema.extend({
  sessionUpdate: z.literal('available_commands_update'),
  availableCommands: z.array(
    MetaSchema.extend({
      name: z.string().min(1).max(256),
      description: z.string().max(4_096),
      input: MetaSchema.extend({ hint: z.string().max(4_096) }).nullish()
    })
  )
})

export const AcpCurrentModeUpdateSchema = MetaSchema.extend({
  sessionUpdate: z.literal('current_mode_update'),
  currentModeId: z.string()
})

export const AcpConfigOptionUpdateSchema = MetaSchema.extend({
  sessionUpdate: z.literal('config_option_update'),
  configOptions: z.array(AcpConfigOptionSchema)
})

export const AcpSessionInfoUpdateSchema = MetaSchema.extend({
  sessionUpdate: z.literal('session_info_update'),
  title: z.string().max(4_096).nullish(),
  updatedAt: z.string().max(128).nullish()
})

export const AcpUsageUpdateSchema = MetaSchema.extend({
  sessionUpdate: z.literal('usage_update'),
  used: z.number(),
  size: z.number(),
  cost: MetaSchema.extend({
    amount: z.number(),
    currency: z.string().max(8)
  }).nullish()
})

const MessageChunkBase = {
  content: AcpContentBlockSchema,
  messageId: z.string().max(1_024).nullish()
}

/**
 * Parse one `session/update` payload. Unknown variants parse into
 * `{ sessionUpdate: <name> }` marked objects so the mapper can ignore them
 * with a debug note; known variants fail closed on missing required fields.
 */
export function parseAcpSessionUpdate(update: unknown):
  | SessionUpdate
  | { sessionUpdate: string } {
  const variant = AcpUpdateVariantSchema.safeParse(update)
  if (!variant.success) {
    throw new AcpError(
      'harness_protocol_error',
      'session/update payload is not an object with a sessionUpdate tag'
    )
  }
  const schema = SESSION_UPDATE_SCHEMAS[variant.data.sessionUpdate]
  if (!schema) {
    return { sessionUpdate: variant.data.sessionUpdate }
  }
  const parsed = schema.safeParse(update)
  if (!parsed.success) {
    throw new AcpError(
      'harness_protocol_error',
      `session/update ${variant.data.sessionUpdate} is missing required fields`,
      { data: { issues: parsed.error.issues.slice(0, 8).map((issue) => issue.message) } }
    )
  }
  return parsed.data as SessionUpdate
}

const AcpUpdateVariantSchema = z
  .object({ sessionUpdate: z.string().min(1).max(128) })
  .passthrough()

const SESSION_UPDATE_SCHEMAS: Record<string, z.ZodType<unknown>> = {
  user_message_chunk: MetaSchema.extend({
    sessionUpdate: z.literal('user_message_chunk'),
    ...MessageChunkBase
  }),
  agent_message_chunk: MetaSchema.extend({
    sessionUpdate: z.literal('agent_message_chunk'),
    ...MessageChunkBase
  }),
  agent_thought_chunk: MetaSchema.extend({
    sessionUpdate: z.literal('agent_thought_chunk'),
    ...MessageChunkBase
  }),
  tool_call: AcpToolCallSchema,
  tool_call_update: AcpToolCallUpdateWireSchema,
  plan: AcpPlanUpdateSchema,
  available_commands_update: AcpAvailableCommandsUpdateSchema,
  current_mode_update: AcpCurrentModeUpdateSchema,
  config_option_update: AcpConfigOptionUpdateSchema,
  session_info_update: AcpSessionInfoUpdateSchema,
  usage_update: AcpUsageUpdateSchema
}

export const AcpSessionNotificationSchema = MetaSchema.extend({
  sessionId: z.string().min(1).max(1_024),
  update: z.unknown()
})

export type AcpParsedSessionNotification = {
  sessionId: string
  update: SessionUpdate | { sessionUpdate: string }
}

export function parseAcpSessionNotification(params: unknown): AcpParsedSessionNotification {
  const parsed = AcpSessionNotificationSchema.safeParse(params)
  if (!parsed.success) {
    throw new AcpError(
      'harness_protocol_error',
      'session/update notification is missing its sessionId or update'
    )
  }
  return {
    sessionId: parsed.data.sessionId,
    update: parseAcpSessionUpdate(parsed.data.update)
  }
}

// ---- Agent → client request params -------------------------------------------

export const AcpRequestPermissionParamsSchema = MetaSchema.extend({
  sessionId: z.string().min(1).max(1_024),
  toolCall: MetaSchema.extend({
    toolCallId: z.string().min(1).max(1_024),
    title: z.string().max(4_096).nullish(),
    kind: AcpToolKindSchema.nullish(),
    status: AcpToolCallStatusSchema.nullish(),
    content: z.array(ToolCallContentItemSchema).nullish(),
    locations: z.array(ToolCallLocationSchema).nullish(),
    rawInput: z.unknown().optional(),
    rawOutput: z.unknown().optional()
  }),
  options: z.array(
    MetaSchema.extend({
      optionId: z.string().min(1).max(1_024),
      name: z.string().max(1_024),
      kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always'])
    })
  )
})
export type AcpRequestPermissionParams = z.infer<typeof AcpRequestPermissionParamsSchema>

export const AcpReadTextFileParamsSchema = MetaSchema.extend({
  sessionId: z.string().min(1).max(1_024),
  path: z.string().min(1).max(16_384),
  line: z.number().int().min(1).nullish(),
  limit: z.number().int().min(1).nullish()
})

export const AcpWriteTextFileParamsSchema = MetaSchema.extend({
  sessionId: z.string().min(1).max(1_024),
  path: z.string().min(1).max(16_384),
  content: z.string().max(32 * 1024 * 1024)
})

const EnvVariableSchema = MetaSchema.extend({
  name: z.string().min(1).max(256),
  value: z.string().max(64_1024)
})

export const AcpTerminalCreateParamsSchema = MetaSchema.extend({
  sessionId: z.string().min(1).max(1_024),
  command: z.string().min(1).max(4_096),
  args: z.array(z.string().max(4_096)).max(256).nullish(),
  env: z.array(EnvVariableSchema).max(256).nullish(),
  cwd: z.string().max(16_384).nullish(),
  outputByteLimit: z.number().int().min(1).max(64 * 1024 * 1024).nullish()
})

export const AcpTerminalIdParamsSchema = MetaSchema.extend({
  sessionId: z.string().min(1).max(1_024),
  terminalId: z.string().min(1).max(1_024)
})

/** `elicitation/create`; `requestedSchema` stays opaque, read leniently downstream. */
export const AcpCreateElicitationParamsSchema = MetaSchema.extend({
  sessionId: z.string().min(1).max(1_024).nullish(),
  requestId: AcpJsonRpcIdSchema.nullish(),
  toolCallId: z.string().max(1_024).nullish(),
  mode: z.string().min(1).max(128),
  message: z.string().min(1).max(16_384),
  requestedSchema: z.unknown().nullish(),
  elicitationId: z.string().max(1_024).nullish(),
  url: z.string().max(8_192).nullish()
})

/** Narrow + cast: params that fail validation surface as JSON-RPC -32602. */
export function parseAcpParams<S extends z.ZodType<unknown>>(
  schema: S,
  params: unknown
): z.infer<S> {
  const parsed = schema.safeParse(params)
  if (!parsed.success) {
    throw new AcpError('harness_protocol_error', 'request params are invalid', {
      rpcCode: ACP_RPC_ERROR.invalidParams,
      data: { issues: parsed.error.issues.slice(0, 8).map((issue) => issue.message) }
    })
  }
  return parsed.data as z.infer<S>
}

