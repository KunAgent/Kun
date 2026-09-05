import { z } from 'zod'
import { ProviderBindingSchema } from './accounts.js'
import { JsonObjectSchema, JsonValueSchema, PageInfoSchema, PageRequestSchema } from './common.js'
import { ModelContentPartSchema, ModelUsageSchema } from './providers.js'

export const AgentRunStateSchema = z.enum([
  'queued',
  'running',
  'waiting-approval',
  'waiting-user-input',
  'completed',
  'failed',
  'cancelled',
  'budget-exhausted'
])
export type AgentRunState = z.infer<typeof AgentRunStateSchema>

export const ExtensionVisibilitySchema = z.enum(['private', 'workspace'])
export type ExtensionVisibility = z.infer<typeof ExtensionVisibilitySchema>

/**
 * Public reasoning values accepted by Kun's turn admission boundary. Provider
 * adapters may translate these stable semantic levels to provider-specific
 * wire values (for example `max` to a Codex `xhigh` request).
 */
export const AgentReasoningEffortSchema = z.enum(['auto', 'off', 'low', 'medium', 'high', 'max'])
export type AgentReasoningEffort = z.infer<typeof AgentReasoningEffortSchema>

export const AgentModelOptionSchema = z.strictObject({
  id: z.string().min(1).max(512),
  displayName: z.string().min(1).max(512),
  selected: z.boolean(),
  reasoningEfforts: z.array(AgentReasoningEffortSchema).max(6),
  defaultReasoningEffort: AgentReasoningEffortSchema.optional()
}).superRefine((option, context) => {
  if (
    option.defaultReasoningEffort &&
    !option.reasoningEfforts.includes(option.defaultReasoningEffort)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['defaultReasoningEffort'],
      message: 'defaultReasoningEffort must be included in reasoningEfforts'
    })
  }
})
export type AgentModelOption = z.infer<typeof AgentModelOptionSchema>

export const AgentRunOptionsSchema = z.strictObject({
  defaultModel: z.string().min(1).max(512),
  models: z.array(AgentModelOptionSchema).min(1).max(512)
}).superRefine((options, context) => {
  const selected = options.models.filter((model) => model.selected)
  if (selected.length !== 1 || selected[0]?.id !== options.defaultModel) {
    context.addIssue({
      code: 'custom',
      path: ['models'],
      message: 'exactly one selected model must match defaultModel'
    })
  }
})
export type AgentRunOptions = z.infer<typeof AgentRunOptionsSchema>

export const AgentBudgetSchema = z.strictObject({
  maxTokens: z.number().int().positive().optional(),
  maxElapsedMs: z.number().int().positive().optional(),
  maxModelRequests: z.number().int().positive().optional(),
  maxToolInvocations: z.number().int().positive().optional(),
  maxEvents: z.number().int().positive().optional()
})
export type AgentBudget = z.infer<typeof AgentBudgetSchema>

export const AgentInputSchema = z.union([
  z.string().min(1),
  z.strictObject({ content: z.array(ModelContentPartSchema).min(1), metadata: JsonObjectSchema.optional() })
])
export type AgentInput = z.infer<typeof AgentInputSchema>

export const AgentProfileDeclarationSchema = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1).max(128),
  description: z.string().max(2048).optional(),
  instructions: z.string().max(32_768).optional(),
  providerBinding: ProviderBindingSchema.partial({ accountId: true }).optional(),
  allowedTools: z.array(z.string().min(1).max(256)).max(512).optional(),
  budget: AgentBudgetSchema.optional(),
  visibility: ExtensionVisibilitySchema.default('private')
})
export type AgentProfileDeclaration = z.infer<typeof AgentProfileDeclarationSchema>
export type AgentProfileDeclarationInput = z.input<typeof AgentProfileDeclarationSchema>

export const AgentCreateRunRequestSchema = z.strictObject({
  input: AgentInputSchema,
  threadId: z.string().min(1).max(256).optional(),
  workspace: z.string().min(1).max(4096).optional(),
  model: z.string().trim().min(1).max(512).optional(),
  reasoningEffort: AgentReasoningEffortSchema.optional(),
  profileId: z.string().min(1).max(256).optional(),
  providerBinding: ProviderBindingSchema.optional(),
  budget: AgentBudgetSchema.optional(),
  allowedTools: z.array(z.string().min(1).max(256)).max(512).optional(),
  visibility: ExtensionVisibilitySchema.optional(),
  metadata: JsonObjectSchema.optional()
})
export type AgentCreateRunRequest = z.infer<typeof AgentCreateRunRequestSchema>

export const ResolvedAgentProfileSchema = z.strictObject({
  id: z.string().min(1).max(256),
  instructionDigest: z.string().min(1).max(256),
  providerBinding: ProviderBindingSchema.optional(),
  allowedTools: z.array(z.string().min(1).max(256)),
  budget: AgentBudgetSchema
})
export type ResolvedAgentProfile = z.infer<typeof ResolvedAgentProfileSchema>

export const AgentRunSchema = z.strictObject({
  id: z.string().min(1).max(256),
  threadId: z.string().min(1).max(256),
  ownerExtensionId: z.string().min(1).max(129),
  ownerExtensionVersion: z.string().min(1).max(64),
  accountId: z.string().min(1).max(256).optional(),
  extensionVisibility: ExtensionVisibilitySchema,
  extensionProfile: ResolvedAgentProfileSchema.optional(),
  extensionBudget: AgentBudgetSchema,
  toolCatalogEpoch: z.string().min(1).max(256),
  state: AgentRunStateSchema,
  model: z.string().min(1).max(512),
  providerBinding: ProviderBindingSchema.optional(),
  reasoningEffort: AgentReasoningEffortSchema.optional(),
  usage: ModelUsageSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  terminalAt: z.string().datetime().optional(),
  error: z
    .strictObject({ code: z.string().min(1).max(128), message: z.string().min(1).max(4096) })
    .optional()
})
export type AgentRun = z.infer<typeof AgentRunSchema>

export const AgentCreateRunResponseSchema = z.strictObject({
  run: AgentRunSchema,
  createdThread: z.boolean()
})
export type AgentCreateRunResponse = z.infer<typeof AgentCreateRunResponseSchema>

const AgentEventBase = {
  runId: z.string().min(1).max(256),
  threadId: z.string().min(1).max(256),
  sequence: z.number().int().positive(),
  timestamp: z.string().datetime()
}

export const AgentRunEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...AgentEventBase, type: z.literal('state'), state: AgentRunStateSchema }),
  z.strictObject({
    ...AgentEventBase,
    type: z.literal('message'),
    role: z.enum(['user', 'assistant', 'tool']),
    messageId: z.string().min(1).max(256),
    phase: z.enum(['delta', 'replace', 'complete']),
    content: JsonValueSchema
  }),
  z.strictObject({ ...AgentEventBase, type: z.literal('progress'), message: z.string().max(4096), data: JsonValueSchema.optional() }),
  z.strictObject({ ...AgentEventBase, type: z.literal('steering-accepted'), steeringId: z.string().min(1).max(256) }),
  z.strictObject({ ...AgentEventBase, type: z.literal('usage'), usage: ModelUsageSchema }),
  z.strictObject({ ...AgentEventBase, type: z.literal('terminal'), state: z.enum(['completed', 'failed', 'cancelled', 'budget-exhausted']), error: JsonObjectSchema.optional() })
])
export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>

export const AgentListRunEventsRequestSchema = z.strictObject({
  runId: z.string().min(1).max(256),
  afterSequence: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(100)
})
export type AgentListRunEventsRequest = z.input<typeof AgentListRunEventsRequestSchema>

export const AgentListRunEventsResponseSchema = z.strictObject({
  items: z.array(AgentRunEventSchema).max(200),
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  historyIncomplete: z.boolean()
})
export type AgentListRunEventsResponse = z.infer<typeof AgentListRunEventsResponseSchema>

export const AgentSubscribeRequestSchema = z.strictObject({
  runId: z.string().min(1).max(256),
  afterSequence: z.number().int().nonnegative().default(0)
})
export type AgentSubscribeRequest = z.input<typeof AgentSubscribeRequestSchema>

export const AgentSteerRequestSchema = z.strictObject({
  runId: z.string().min(1).max(256),
  input: AgentInputSchema
})
export type AgentSteerRequest = z.infer<typeof AgentSteerRequestSchema>

export const AgentCancelRequestSchema = z.strictObject({
  runId: z.string().min(1).max(256),
  reason: z.string().max(1024).optional()
})
export type AgentCancelRequest = z.infer<typeof AgentCancelRequestSchema>

export const AgentMutationResultSchema = z.strictObject({
  accepted: z.boolean(),
  run: AgentRunSchema
})
export type AgentMutationResult = z.infer<typeof AgentMutationResultSchema>

export const ExtensionThreadProjectionSchema = z.strictObject({
  id: z.string().min(1).max(256),
  title: z.string().max(512).optional(),
  ownerExtensionId: z.string().min(1).max(129),
  ownerExtensionVersion: z.string().min(1).max(64),
  extensionVisibility: ExtensionVisibilitySchema,
  workspace: z.string().max(4096).optional(),
  latestRun: AgentRunSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})
export type ExtensionThreadProjection = z.infer<typeof ExtensionThreadProjectionSchema>

export const ListOwnThreadsRequestSchema = PageRequestSchema.extend({
  workspace: z.string().max(4096).optional(),
  state: AgentRunStateSchema.optional()
}).strict()
export type ListOwnThreadsRequest = z.input<typeof ListOwnThreadsRequestSchema>

export const ListOwnThreadsResponseSchema = z.strictObject({
  items: z.array(ExtensionThreadProjectionSchema),
  page: PageInfoSchema
})
export type ListOwnThreadsResponse = z.infer<typeof ListOwnThreadsResponseSchema>
