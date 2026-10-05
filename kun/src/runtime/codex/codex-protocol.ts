/**
 * Codex App Server wire surface (P6-04), distilled from
 * `codex app-server generate-json-schema` on codex-cli 0.145.0. The checked-in
 * method surface lives in `protocol/snapshot.json`;
 * `scripts/codex-protocol-snapshot.mjs` regenerates and drift-checks it.
 *
 * Schemas below validate only the fields Kun reads and pass everything else
 * through so forward-compatible servers keep working. The wire dialect is the
 * bare `{id, method, params}` JSON-RPC style (no `jsonrpc` envelope) handled
 * by `session/jsonrpc-peer.ts`.
 */
import { z } from 'zod'

/** Lowest codex-cli version whose app-server protocol Kun supports. */
export const CODEX_APP_SERVER_MIN_VERSION = '0.145.0'

// ---- client → server methods Kun calls ------------------------------------

export const CODEX_CLIENT_METHODS = {
  initialize: 'initialize',
  threadStart: 'thread/start',
  threadResume: 'thread/resume',
  threadFork: 'thread/fork',
  threadRollback: 'thread/rollback',
  turnStart: 'turn/start',
  turnSteer: 'turn/steer',
  turnInterrupt: 'turn/interrupt',
  modelList: 'model/list',
  configRead: 'config/read',
  accountRead: 'account/read',
  accountRateLimitsRead: 'account/rateLimits/read',
  accountLoginStart: 'account/login/start',
  accountLoginCancel: 'account/login/cancel'
} as const

/** Client → server notification sent once after `initialize` resolves. */
export const CODEX_INITIALIZED_NOTIFICATION = 'initialized'

// ---- server → client requests Kun answers ----------------------------------

export const CODEX_SERVER_REQUESTS = {
  commandExecutionApproval: 'item/commandExecution/requestApproval',
  fileChangeApproval: 'item/fileChange/requestApproval',
  permissionsApproval: 'item/permissions/requestApproval',
  toolRequestUserInput: 'item/tool/requestUserInput'
} as const

/**
 * Server → client requests Kun deliberately refuses (method-not-found is
 * safer than pretending support): dynamic tool calls, MCP elicitation, legacy
 * exec/patch approvals, ChatGPT token refresh, attestation.
 */
export const CODEX_DECLINED_SERVER_REQUESTS = [
  'item/tool/call',
  'mcpServer/elicitation/request',
  'applyPatchApproval',
  'execCommandApproval',
  'account/chatgptAuthTokens/refresh',
  'attestation/generate'
] as const

// ---- server → client notifications Kun consumes ----------------------------

export const CODEX_NOTIFICATIONS = {
  threadStarted: 'thread/started',
  turnStarted: 'turn/started',
  turnCompleted: 'turn/completed',
  turnDiffUpdated: 'turn/diff/updated',
  turnPlanUpdated: 'turn/plan/updated',
  itemStarted: 'item/started',
  itemCompleted: 'item/completed',
  agentMessageDelta: 'item/agentMessage/delta',
  planDelta: 'item/plan/delta',
  reasoningSummaryTextDelta: 'item/reasoning/summaryTextDelta',
  reasoningSummaryPartAdded: 'item/reasoning/summaryPartAdded',
  reasoningTextDelta: 'item/reasoning/textDelta',
  commandExecutionOutputDelta: 'item/commandExecution/outputDelta',
  fileChangeOutputDelta: 'item/fileChange/outputDelta',
  fileChangePatchUpdated: 'item/fileChange/patchUpdated',
  threadTokenUsageUpdated: 'thread/tokenUsage/updated',
  error: 'error',
  warning: 'warning',
  serverRequestResolved: 'serverRequest/resolved',
  accountUpdated: 'account/updated',
  accountRateLimitsUpdated: 'account/rateLimits/updated',
  accountLoginCompleted: 'account/login/completed',
  modelRerouted: 'model/rerouted',
  threadCompacted: 'thread/compacted'
} as const

// ---- shared scalar types ---------------------------------------------------

export const CodexAskForApprovalSchema = z.union([
  z.enum(['untrusted', 'on-request', 'never']),
  z.object({
    granular: z.object({
      mcp_elicitations: z.boolean(),
      rules: z.boolean(),
      sandbox_approval: z.boolean(),
      request_permissions: z.boolean().optional(),
      skill_approval: z.boolean().optional()
    })
  })
])
export type CodexAskForApproval = z.infer<typeof CodexAskForApprovalSchema>

export const CodexSandboxPolicySchema = z.union([
  z.object({ type: z.literal('dangerFullAccess') }),
  z.object({
    type: z.literal('readOnly'),
    networkAccess: z.boolean().optional()
  }),
  z.object({
    type: z.literal('externalSandbox'),
    networkAccess: z.enum(['restricted', 'enabled']).optional()
  }),
  z.object({
    type: z.literal('workspaceWrite'),
    writableRoots: z.array(z.string()).optional(),
    networkAccess: z.boolean().optional(),
    excludeSlashTmp: z.boolean().optional(),
    excludeTmpdirEnvVar: z.boolean().optional()
  })
])
export type CodexSandboxPolicy = z.infer<typeof CodexSandboxPolicySchema>

export const CodexUserInputSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }).passthrough(),
  z.object({ type: z.literal('image'), url: z.string() }).passthrough(),
  z.object({ type: z.literal('localImage'), path: z.string() }).passthrough(),
  z.object({ type: z.literal('audio'), url: z.string() }).passthrough()
])
export type CodexUserInput = z.infer<typeof CodexUserInputSchema>

// ---- thread / turn records --------------------------------------------------

export const CodexTurnStatusSchema = z.enum([
  'completed',
  'interrupted',
  'failed',
  'inProgress'
])
export type CodexTurnStatus = z.infer<typeof CodexTurnStatusSchema>

/**
 * codex 0.145+ serializes `thread.status`/`turn.status` as `{type: <name>}`
 * objects while older builds sent a bare string — normalize both to the name.
 */
const codexStatusString = (schema: z.ZodTypeAny) =>
  z.preprocess(
    (value) =>
      value && typeof value === 'object' && 'type' in value
        ? (value as { type: unknown }).type
        : value,
    schema
  )

export const CodexTurnErrorSchema = z
  .object({
    message: z.string(),
    additionalDetails: z.string().nullable().optional(),
    codexErrorInfo: z.unknown().nullable().optional()
  })
  .passthrough()
export type CodexTurnError = z.infer<typeof CodexTurnErrorSchema>

/** ThreadItem variants Kun maps; unknown variants pass through as opaque. */
export const CodexThreadItemSchema = z
  .object({
    id: z.string(),
    type: z.string()
  })
  .passthrough()
export type CodexThreadItem = z.infer<typeof CodexThreadItemSchema>

export const CodexTurnSchema = z
  .object({
    id: z.string(),
    status: codexStatusString(CodexTurnStatusSchema),
    items: z.array(CodexThreadItemSchema).default([]),
    error: CodexTurnErrorSchema.nullable().optional(),
    startedAt: z.number().nullable().optional(),
    completedAt: z.number().nullable().optional(),
    durationMs: z.number().nullable().optional()
  })
  .passthrough()
export type CodexTurn = z.infer<typeof CodexTurnSchema>

export const CodexThreadSchema = z
  .object({
    id: z.string(),
    sessionId: z.string().optional(),
    status: codexStatusString(z.string()).optional(),
    turns: z.array(CodexTurnSchema).optional(),
    preview: z.string().optional()
  })
  .passthrough()
export type CodexThread = z.infer<typeof CodexThreadSchema>

// ---- request params ---------------------------------------------------------

export type CodexThreadStartParams = {
  model?: string
  modelProvider?: string
  cwd?: string
  approvalPolicy?: CodexAskForApproval
  approvalsReviewer?: 'user' | 'auto_review' | 'guardian_subagent'
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  baseInstructions?: string
  developerInstructions?: string
  ephemeral?: boolean
  config?: Record<string, unknown>
}

export type CodexThreadResumeParams = {
  threadId: string
} & Omit<CodexThreadStartParams, 'ephemeral'>

export type CodexThreadForkParams = {
  threadId: string
  lastTurnId?: string
  ephemeral?: boolean
} & Omit<CodexThreadStartParams, 'ephemeral'>

export type CodexTurnStartParams = {
  threadId: string
  input: CodexUserInput[]
  model?: string
  effort?: string
  cwd?: string
  approvalPolicy?: CodexAskForApproval
  sandboxPolicy?: CodexSandboxPolicy
  clientUserMessageId?: string
}

export type CodexTurnSteerParams = {
  threadId: string
  expectedTurnId: string
  input: CodexUserInput[]
  clientUserMessageId?: string
}

export type CodexTurnInterruptParams = {
  threadId: string
  turnId: string
}

export type CodexThreadStartResponse = {
  thread: CodexThread
  model: string
  modelProvider: string
  cwd: string
  approvalPolicy: CodexAskForApproval
}

export type CodexTurnStartResponse = { turn: CodexTurn }

// ---- approvals & user input --------------------------------------------------

export const CodexCommandExecutionApprovalParamsSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    approvalId: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    commandActions: z.array(z.unknown()).nullable().optional(),
    cwd: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    networkApprovalContext: z.unknown().nullable().optional()
  })
  .passthrough()
export type CodexCommandExecutionApprovalParams = z.infer<
  typeof CodexCommandExecutionApprovalParamsSchema
>

export type CodexCommandExecutionApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel'

export const CodexFileChangeApprovalParamsSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    grantRoot: z.string().nullable().optional(),
    reason: z.string().nullable().optional()
  })
  .passthrough()
export type CodexFileChangeApprovalParams = z.infer<
  typeof CodexFileChangeApprovalParamsSchema
>

export type CodexFileChangeApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel'

export const CodexPermissionsApprovalParamsSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    cwd: z.string(),
    reason: z.string().nullable().optional(),
    permissions: z.unknown()
  })
  .passthrough()
export type CodexPermissionsApprovalParams = z.infer<
  typeof CodexPermissionsApprovalParamsSchema
>

export const CodexToolRequestUserInputQuestionSchema = z
  .object({
    header: z.string(),
    id: z.string(),
    question: z.string(),
    isOther: z.boolean().optional(),
    isSecret: z.boolean().optional(),
    options: z
      .array(
        z
          .object({ label: z.string(), description: z.string() })
          .passthrough()
      )
      .nullable()
      .optional()
  })
  .passthrough()

export const CodexToolRequestUserInputParamsSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    questions: z.array(CodexToolRequestUserInputQuestionSchema),
    autoResolutionMs: z.number().nullable().optional()
  })
  .passthrough()
export type CodexToolRequestUserInputParams = z.infer<
  typeof CodexToolRequestUserInputParamsSchema
>

export type CodexToolRequestUserInputResponse = {
  answers: Record<string, { answers: string[] }>
}

// ---- notifications -------------------------------------------------------------

export const CodexTurnScopedNotificationSchema = z
  .object({ threadId: z.string(), turnId: z.string() })
  .passthrough()

export const CodexItemNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    item: CodexThreadItemSchema
  })
  .passthrough()

export const CodexDeltaNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    delta: z.string()
  })
  .passthrough()

export const CodexTurnCompletedNotificationSchema = z
  .object({ threadId: z.string(), turn: CodexTurnSchema })
  .passthrough()

export const CodexTurnPlanUpdatedNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    explanation: z.string().nullable().optional(),
    plan: z.array(
      z
        .object({
          step: z.string(),
          status: z.enum(['pending', 'inProgress', 'completed'])
        })
        .passthrough()
    )
  })
  .passthrough()

export const CodexTokenUsageNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    tokenUsage: z
      .object({
        last: z.object({
          inputTokens: z.number(),
          cachedInputTokens: z.number(),
          outputTokens: z.number(),
          reasoningOutputTokens: z.number(),
          totalTokens: z.number()
        }).passthrough(),
        total: z
          .object({
            inputTokens: z.number(),
            cachedInputTokens: z.number(),
            outputTokens: z.number(),
            reasoningOutputTokens: z.number(),
            totalTokens: z.number()
          })
          .passthrough(),
        modelContextWindow: z.number().nullable().optional()
      })
      .passthrough()
  })
  .passthrough()

export const CodexErrorNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    error: CodexTurnErrorSchema,
    willRetry: z.boolean()
  })
  .passthrough()

// ---- account / models -----------------------------------------------------------

export const CodexAccountSchema = z.union([
  z.object({ type: z.literal('apiKey') }).passthrough(),
  z
    .object({
      type: z.literal('chatgpt'),
      email: z.string().nullable().optional(),
      planType: z.string()
    })
    .passthrough(),
  z.object({ type: z.literal('amazonBedrock') }).passthrough()
])
export type CodexAccount = z.infer<typeof CodexAccountSchema>

export const CodexGetAccountResponseSchema = z
  .object({
    requiresOpenaiAuth: z.boolean(),
    account: CodexAccountSchema.nullable().optional()
  })
  .passthrough()

export const CodexRateLimitWindowSchema = z
  .object({
    usedPercent: z.number(),
    windowDurationMins: z.number().nullable().optional(),
    resetsAt: z.number().nullable().optional()
  })
  .passthrough()

export const CodexRateLimitSnapshotSchema = z
  .object({
    limitId: z.string().nullable().optional(),
    limitName: z.string().nullable().optional(),
    planType: z.string().nullable().optional(),
    primary: CodexRateLimitWindowSchema.nullable().optional(),
    secondary: CodexRateLimitWindowSchema.nullable().optional()
  })
  .passthrough()
export type CodexRateLimitSnapshot = z.infer<
  typeof CodexRateLimitSnapshotSchema
>

export const CodexRateLimitsResponseSchema = z
  .object({
    rateLimits: CodexRateLimitSnapshotSchema,
    rateLimitsByLimitId: z
      .record(z.string(), CodexRateLimitSnapshotSchema)
      .nullable()
      .optional()
  })
  .passthrough()

export const CodexModelSchema = z
  .object({
    id: z.string(),
    model: z.string(),
    displayName: z.string(),
    description: z.string(),
    isDefault: z.boolean(),
    hidden: z.boolean(),
    defaultReasoningEffort: z.string(),
    supportedReasoningEfforts: z.array(z.unknown()).optional(),
    inputModalities: z.array(z.string()).optional()
  })
  .passthrough()
export type CodexModel = z.infer<typeof CodexModelSchema>

export const CodexModelListResponseSchema = z
  .object({
    data: z.array(CodexModelSchema),
    nextCursor: z.string().nullable().optional()
  })
  .passthrough()

export const CodexLoginAccountResponseSchema = z
  .object({
    type: z.enum(['apiKey', 'chatgpt', 'chatgptDeviceCode']),
    authUrl: z.string().optional(),
    loginId: z.string().optional(),
    userCode: z.string().optional(),
    verificationUrl: z.string().optional()
  })
  .passthrough()
export type CodexLoginAccountResponse = z.infer<
  typeof CodexLoginAccountResponseSchema
>
