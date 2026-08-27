import { z } from 'zod'
import { MODEL_ENDPOINT_FORMATS } from './model-endpoint-format.js'

export const RUNTIME_CAPABILITY_CONTRACT_VERSION = 1
export const MAX_MODEL_CONTEXT_WINDOW_TOKENS = 10_000_000
export const MAX_MODEL_OUTPUT_TOKENS = 1_000_000

export const RuntimeCapabilityStatus = z.enum(['available', 'disabled', 'unavailable', 'interaction-required'])
export type RuntimeCapabilityStatus = z.infer<typeof RuntimeCapabilityStatus>

export const RuntimeCapabilityState = z
  .object({
    status: RuntimeCapabilityStatus,
    enabled: z.boolean(),
    available: z.boolean(),
    reason: z.string().optional()
  })
  .strict()
export type RuntimeCapabilityState = z.infer<typeof RuntimeCapabilityState>

export const ModelInputModality = z.enum(['text', 'image'])
export type ModelInputModality = z.infer<typeof ModelInputModality>

export const ModelMessagePartSupport = z.enum(['text', 'image_url', 'input_image'])
export type ModelMessagePartSupport = z.infer<typeof ModelMessagePartSupport>

export const ModelReasoningEffort = z.enum(['auto', 'off', 'low', 'medium', 'high', 'max'])
export type ModelReasoningEffort = z.infer<typeof ModelReasoningEffort>

export const ModelServiceTier = z.enum(['priority', 'flex'])
export type ModelServiceTier = z.infer<typeof ModelServiceTier>

export const ModelReasoningRequestProtocol = z.enum([
  'none',
  'deepseek-chat-completions',
  'glm-chat-completions',
  'mimo-chat-completions',
  'openai-chat-completions',
  'qwen-chat-completions',
  'thinking-toggle-chat-completions',
  'openai-responses',
  'anthropic-thinking'
])
export type ModelReasoningRequestProtocol = z.infer<typeof ModelReasoningRequestProtocol>

export const ModelReasoningCapabilityMetadata = z
  .object({
    supportedEfforts: z.array(ModelReasoningEffort).min(1),
    defaultEffort: ModelReasoningEffort,
    requestProtocol: ModelReasoningRequestProtocol
  })
  .strict()
export type ModelReasoningCapabilityMetadata = z.infer<typeof ModelReasoningCapabilityMetadata>

/**
 * Reference catalog pricing in USD per million tokens. Used only as the
 * last-resort local cost estimate when the provider reports no cost and no
 * first-party estimator (DeepSeek/MiniMax) matched the model.
 */
export const ModelCatalogPricing = z
  .object({
    inputUsdPerMillion: z.number().nonnegative(),
    outputUsdPerMillion: z.number().nonnegative(),
    cacheReadUsdPerMillion: z.number().nonnegative().optional(),
    cacheWriteUsdPerMillion: z.number().nonnegative().optional()
  })
  .strict()
export type ModelCatalogPricing = z.infer<typeof ModelCatalogPricing>

export const ModelCapabilityMetadata = z
  .object({
    id: z.string().min(1),
    inputModalities: z.array(ModelInputModality).min(1),
    outputModalities: z.array(ModelInputModality).min(1),
    supportsToolCalling: z.boolean(),
    contextWindowTokens: z.number().int().positive().optional(),
    // Maximum tokens the model may emit per response. When set it caps the
    // request's output budget (max_tokens / max_output_tokens). Absent means
    // "use the runtime default" — which is reasoning-aware for the Anthropic
    // Messages format so thinking models don't truncate their tool calls.
    maxOutputTokens: z.number().int().positive().optional(),
    messageParts: z.array(ModelMessagePartSupport).min(1),
    reasoning: ModelReasoningCapabilityMetadata.optional(),
    /** Reference catalog pricing for local cost estimation. */
    pricing: ModelCatalogPricing.optional(),
    /** Provider-advertised request service tiers supported by this model. */
    serviceTiers: z.array(ModelServiceTier).min(1).optional(),
    // Per-model wire-format override. Lets one provider route some models to
    // chat completions and others to Anthropic Messages / OpenAI Responses
    // (e.g. OpenCode Go). Absent means "inherit the provider/runtime format".
    endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS).optional(),
    // Codex-only Responses Lite transport. Omitted uses the standard
    // Responses request shape.
    responsesMode: z.literal('lite').optional()
  })
  .strict()
export type ModelCapabilityMetadata = z.infer<typeof ModelCapabilityMetadata>

export const CapabilityToggleConfig = z
  .object({
    enabled: z.boolean().default(false)
  })
  .strict()

export const StringRecord = z.record(z.string(), z.string())

export const McpTransportKind = z.enum(['stdio', 'streamable-http', 'sse'])
export type McpTransportKind = z.infer<typeof McpTransportKind>

export const McpTrustScope = z.enum(['user', 'workspace'])
export type McpTrustScope = z.infer<typeof McpTrustScope>

export const McpToolDiscoveryMode = z.enum(['direct', 'search', 'auto'])
export type McpToolDiscoveryMode = z.infer<typeof McpToolDiscoveryMode>

export const McpOAuthConfig = z
  .object({
    enabled: z.boolean().default(true),
    clientName: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    scopes: z.array(z.string().min(1)).default([]),
    redirectPort: z.number().int().min(1024).max(65535).optional(),
    callbackTimeoutMs: z.number().int().positive().default(120_000)
  })
  .strict()
export type McpOAuthConfig = z.infer<typeof McpOAuthConfig>

export const McpSearchConfig = z
  .object({
    enabled: z.boolean().default(false),
    mode: McpToolDiscoveryMode.default('auto'),
    autoThresholdToolCount: z.number().int().positive().default(24),
    topKDefault: z.number().int().positive().default(5),
    topKMax: z.number().int().positive().default(10),
    minScore: z.number().nonnegative().default(0.15),
    bm25: z
      .object({
        k1: z.number().positive().default(1.2),
        b: z.number().min(0).max(1).default(0.75)
      })
      .strict()
      .default(() => ({ k1: 1.2, b: 0.75 }))
  })
  .strict()
  .superRefine((search, ctx) => {
    if (search.topKDefault > search.topKMax) {
      ctx.addIssue({
        code: 'custom',
        path: ['topKDefault'],
        message: 'topKDefault must be less than or equal to topKMax'
      })
    }
  })
export type McpSearchConfig = z.infer<typeof McpSearchConfig>

export const McpServerConfig = z
  .object({
    enabled: z.boolean().default(true),
    transport: McpTransportKind,
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    cwd: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    headers: StringRecord.default({}),
    env: StringRecord.default({}),
    // Visibility scope: empty means globally visible; otherwise the server is
    // advertised only when ToolHostContext.workspace is under one of these roots.
    workspaceRoots: z.array(z.string().min(1)).default([]),
    oauth: McpOAuthConfig.optional(),
    trustScope: McpTrustScope.default('workspace'),
    trustedWorkspaceRoots: z.array(z.string().min(1)).default([]),
    /** MCP tool names explicitly trusted by the host as read-only in Plan mode. */
    planModeReadOnlyTools: z.array(z.string().min(1)).default([]),
    timeoutMs: z.number().int().positive().default(30_000)
  })
  .strict()
  .superRefine((server, ctx) => {
    if (server.transport === 'stdio' && !server.command) {
      ctx.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'stdio MCP servers require command'
      })
    }
    if ((server.transport === 'streamable-http' || server.transport === 'sse') && !server.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: `${server.transport} MCP servers require url`
      })
    }
    if (server.url) {
      try {
        const parsed = new URL(server.url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          ctx.addIssue({
            code: 'custom',
            path: ['url'],
            message: 'MCP server url must use http or https'
          })
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'MCP server url must be a valid URL'
        })
      }
    }
    if (server.trustScope === 'workspace' && server.trustedWorkspaceRoots.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['trustedWorkspaceRoots'],
        message: 'workspace-scoped MCP servers require at least one trusted workspace root'
      })
    }
  })
export type ParsedMcpServerConfig = z.infer<typeof McpServerConfig>
export type McpServerConfig = Omit<ParsedMcpServerConfig, 'planModeReadOnlyTools'> & {
  planModeReadOnlyTools?: string[]
}

export const McpCapabilityConfig = CapabilityToggleConfig.extend({
  servers: z.record(z.string().min(1), McpServerConfig).default({}),
  search: McpSearchConfig.default(() => McpSearchConfig.parse({}))
}).strict()
export type McpCapabilityConfig = z.infer<typeof McpCapabilityConfig>

export const WebCapabilityConfig = CapabilityToggleConfig.extend({
  fetchEnabled: z.boolean().default(false),
  searchEnabled: z.boolean().default(false),
  provider: z.string().min(1).optional(),
  allowDomains: z.array(z.string().min(1)).default([]),
  denyDomains: z.array(z.string().min(1)).default([]),
  /** Upper bound for web_fetch body bytes; fetched pages truncate here. */
  maxFetchBytes: z.number().int().positive().default(1_000_000)
}).strict()
export type WebCapabilityConfig = z.infer<typeof WebCapabilityConfig>

export const SkillsCapabilityConfig = CapabilityToggleConfig.extend({
  roots: z.array(z.string().min(1)).default([]),
  workspaceRoots: z.array(z.string().min(1)).default([]),
  /** Global skill roots (e.g. ~/.kun/skills). Scanned after project roots. */
  globalRoots: z.array(z.string().min(1)).default([]),
  /** Read workspace-local `.kun/project.json` Skill policy on demand. */
  projectConfigEnabled: z.boolean().default(true),
  /**
   * Skill ids the user disabled in the GUI. Excluded everywhere a skill can
   * surface (catalog, auto-match, load_skill, diagnostics) so a disabled skill
   * is truly gone from the runtime, not merely hidden in the UI. Compared after
   * `slug()` normalization on both sides.
   */
  disabledIds: z.array(z.string().min(1)).default([]),
  legacySkillMd: z.boolean().default(true)
}).strict()
export type ParsedSkillsCapabilityConfig = z.infer<typeof SkillsCapabilityConfig>
export type SkillsCapabilityConfig = Omit<ParsedSkillsCapabilityConfig, 'projectConfigEnabled'> & {
  projectConfigEnabled?: boolean
}

export const InstructionsCapabilityConfig = CapabilityToggleConfig.extend({
  maxFileBytes: z.number().int().positive().default(64 * 1024),
  maxTotalBytes: z.number().int().positive().default(96 * 1024)
}).strict()
export type InstructionsCapabilityConfig = z.infer<typeof InstructionsCapabilityConfig>

export const SubagentToolPolicy = z.enum(['readOnly', 'inherit'])
export type SubagentToolPolicy = z.infer<typeof SubagentToolPolicy>

/** Where an agent can be used: a delegated subagent, a primary session persona, or both. */
export const SubagentMode = z.enum(['subagent', 'primary', 'all'])
export type SubagentMode = z.infer<typeof SubagentMode>

/** Product surfaces where a profile is available for delegation. */
export const SubagentSurface = z.enum(['shared', 'code', 'write', 'design'])
export type SubagentSurface = z.infer<typeof SubagentSurface>

/**
 * Tools a `readOnly` subagent may call. The list is enforced twice: the
 * child loop advertises only these names (schema filter) and the
 * capability registry re-checks them at execute time (backstop). Keep it
 * to side-effect-free investigation tools — no bash/edit/write, and no
 * nested `delegate_task`.
 */
/**
 * Host-enforced upper bound for read-only subagents. Profile `allowedTools`
 * may narrow this set but can never add mutation, command, delegation, memory,
 * or arbitrary connector tools to it.
 */
export const SUBAGENT_READ_ONLY_TOOL_NAMES = [
  'read',
  'grep',
  'glob',
  'ls',
  'repo_map',
  'web_fetch',
  'web_search'
] as const

export const SubagentProfileConfig = z
  .object({
    /** Display name for the GUI roster and pickers (falls back to the profile key). */
    name: z.string().min(1).optional(),
    /** When-to-use description shown in the delegate_task schema and the GUI. */
    description: z.string().min(1).optional(),
    /** UI accent color (hex) for the agent's chip/avatar. */
    color: z.string().min(1).optional(),
    /** Where the agent can be used: delegated subagent, primary session persona, or both. */
    mode: SubagentMode.default('subagent'),
    /**
     * Product surfaces where this role participates in routing. `shared`
     * makes the role available everywhere and is canonicalized without other
     * values. Missing values retain legacy global availability.
     */
    surfaces: z.array(SubagentSurface).max(4).optional(),
    /** Overrides the child model for this role (falls back to the server default). */
    model: z.string().min(1).optional(),
    /** Routes this role's child to a specific provider id (falls back to the runtime default provider). */
    providerId: z.string().min(1).optional(),
    /** Persona/instructions appended to the base system prompt for this role (not a full replace). */
    systemPrompt: z.string().min(1).optional(),
    /**
     * When true, the child's immutable system prompt is only `systemPrompt`
     * (no Kun base prefix). Empty/missing role prompts still fall back to base.
     */
    omitBasePrompt: z.boolean().optional(),
    /** Short instruction prepended to the delegated task prompt. */
    promptPreamble: z.string().min(1).optional(),
    /**
     * Whether the child is restricted to read-only tools or inherits the
     * parent agent's full tool set + approval policy. Defaults to `inherit`
     * (follow the main agent); a profile that needs read-only must say so
     * explicitly (e.g. the built-in reviewers).
     */
    toolPolicy: SubagentToolPolicy.default('inherit'),
    /** Exact tool allow-list; narrows toolPolicy and the parent capability snapshot. */
    allowedTools: z.array(z.string().min(1)).min(1).optional(),
    /** Built-in tool names blocked for this profile (deny-list, layered on `inherit`; e.g. ['bash','write']). */
    blockedTools: z.array(z.string().min(1)).optional(),
    /** MCP server ids blocked for this profile (deny-list; the server's entire toolset is hidden from the child). */
    blockedMcpServers: z.array(z.string().min(1)).optional(),
    /** Skill ids blocked for this profile (deny-list; default inherits every available skill). */
    blockedSkills: z.array(z.string().min(1)).optional(),
    /** Disable skill discovery, auto-activation, and load_skill for this child. */
    skillsEnabled: z.boolean().optional(),
    /**
     * Reasoning depth applied to this profile's child model requests. Default
     * 'off' (cheap); a profile opts into deeper thinking explicitly. Flows to
     * the child agent's ModelRequest.reasoningEffort.
     */
    reasoningEffort: ModelReasoningEffort.optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    const hasModel = Boolean(profile.model?.trim())
    const hasProvider = Boolean(profile.providerId?.trim())
    if (hasModel === hasProvider) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasModel ? ['providerId'] : ['model'],
      message: 'subagent model and providerId must be configured together'
    })
  })
export type SubagentProfileConfig = z.infer<typeof SubagentProfileConfig>

export const ProactiveSubagentRetryConfig = z.object({
  /** Let the main agent resume an eligible failed delegate_task child. */
  enabled: z.boolean().default(true),
  /** Model-initiated child continuations after the initial run. */
  maxAttempts: z.number().int().min(1).max(3).default(3)
}).strict()
export type ProactiveSubagentRetryConfig = z.infer<typeof ProactiveSubagentRetryConfig>

export const SubagentsCapabilityConfig = CapabilityToggleConfig.extend({
  /** Reuse configured profiles instead of requiring the parent to define a one-run role. */
  useExistingAgents: z.boolean().default(true),
  /** Max children running at once; extra spawns queue instead of erroring. */
  maxParallel: z.number().int().nonnegative().default(256),
  /** Bounded main-agent continuation policy for failed ordinary children. */
  proactiveRetry: ProactiveSubagentRetryConfig.default(() => ProactiveSubagentRetryConfig.parse({})),
  // Accept the removed cumulative limit so old configs keep loading, but ignore it.
  maxChildRuns: z.number().int().nonnegative().optional(),
  /**
   * Tool policy applied to children that do not resolve a profile. Defaults to
   * `inherit` so a delegated subagent follows the MAIN agent's tools AND
   * approval/permission policy (it can edit/run shell iff the parent can).
   * `inherit` never escalates beyond the parent: the child loop runs under the
   * parent thread's approvalPolicy/sandboxMode, so a read-only parent yields a
   * read-only child. Per-profile `toolPolicy` (e.g. the built-in read-only
   * reviewers) still wins over this default.
   */
  defaultToolPolicy: SubagentToolPolicy.default('inherit'),
  /** Profile chosen when `delegate_task` omits an explicit profile. */
  defaultProfile: z.string().min(1).optional(),
  /** Named subagent roles (e.g. researcher/reviewer/verifier). */
  profiles: z.record(z.string().min(1), SubagentProfileConfig).default({}),
  // Accept the removed legacy field so old configs keep loading, but ignore it.
  defaultStepLimit: z.number().int().positive().optional()
})
  .strict()
  .superRefine((config, ctx) => {
    if (config.defaultProfile && !Object.prototype.hasOwnProperty.call(config.profiles, config.defaultProfile)) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultProfile'],
        message: `defaultProfile "${config.defaultProfile}" is not defined in profiles`
      })
    }
  })
  .transform(({
    maxChildRuns: _legacyMaxChildRuns,
    defaultStepLimit: _legacyDefaultStepLimit,
    ...config
  }) => config)
export type SubagentsCapabilityConfig = z.output<typeof SubagentsCapabilityConfig>
