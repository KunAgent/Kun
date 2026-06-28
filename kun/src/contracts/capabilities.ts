import { z } from 'zod'
import { MODEL_ENDPOINT_FORMATS } from './model-endpoint-format.js'

export const RUNTIME_CAPABILITY_CONTRACT_VERSION = 1

export const RuntimeCapabilityStatus = z.enum(['available', 'disabled', 'unavailable'])
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

export const ModelReasoningRequestProtocol = z.enum([
  'none',
  'deepseek-chat-completions',
  'glm-chat-completions',
  'mimo-chat-completions',
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
    // Per-model wire-format override. Lets one provider route some models to
    // chat completions and others to Anthropic Messages / OpenAI Responses
    // (e.g. OpenCode Go). Absent means "inherit the provider/runtime format".
    endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS).optional()
  })
  .strict()
export type ModelCapabilityMetadata = z.infer<typeof ModelCapabilityMetadata>

const CapabilityToggleConfig = z
  .object({
    enabled: z.boolean().default(false)
  })
  .strict()

const StringRecord = z.record(z.string(), z.string())

export const McpTransportKind = z.enum(['stdio', 'streamable-http', 'sse'])
export type McpTransportKind = z.infer<typeof McpTransportKind>

export const McpTrustScope = z.enum(['user', 'workspace'])
export type McpTrustScope = z.infer<typeof McpTrustScope>

export const McpToolDiscoveryMode = z.enum(['direct', 'search', 'auto'])
export type McpToolDiscoveryMode = z.infer<typeof McpToolDiscoveryMode>

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
    trustScope: McpTrustScope.default('workspace'),
    trustedWorkspaceRoots: z.array(z.string().min(1)).default([]),
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
export type McpServerConfig = z.infer<typeof McpServerConfig>

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
  /**
   * Skill ids the user disabled in the GUI. Excluded everywhere a skill can
   * surface (catalog, auto-match, load_skill, diagnostics) so a disabled skill
   * is truly gone from the runtime, not merely hidden in the UI. Compared after
   * `slug()` normalization on both sides.
   */
  disabledIds: z.array(z.string().min(1)).default([]),
  legacySkillMd: z.boolean().default(true)
}).strict()
export type SkillsCapabilityConfig = z.infer<typeof SkillsCapabilityConfig>

export const SubagentToolPolicy = z.enum(['readOnly', 'inherit'])
export type SubagentToolPolicy = z.infer<typeof SubagentToolPolicy>

/** Where an agent can be used: a delegated subagent, a primary session persona, or both. */
export const SubagentMode = z.enum(['subagent', 'primary', 'all'])
export type SubagentMode = z.infer<typeof SubagentMode>

/**
 * Tools a `readOnly` subagent may call. The list is enforced twice: the
 * child loop advertises only these names (schema filter) and the
 * capability registry re-checks them at execute time (backstop). Keep it
 * to side-effect-free investigation tools — no bash/edit/write, and no
 * nested `delegate_task`.
 */
export const SUBAGENT_READ_ONLY_TOOL_NAMES = ['read', 'grep', 'find', 'ls'] as const

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
    /** Overrides the child model for this role (falls back to the server default). */
    model: z.string().min(1).optional(),
    /** Routes this role's child to a specific provider id (falls back to the runtime default provider). */
    providerId: z.string().min(1).optional(),
    /** Persona/instructions appended to the base system prompt for this role (not a full replace). */
    systemPrompt: z.string().min(1).optional(),
    /** Short instruction prepended to the delegated task prompt. */
    promptPreamble: z.string().min(1).optional(),
    /**
     * Whether the child is restricted to read-only tools or inherits the
     * parent agent's full tool set + approval policy. Defaults to `inherit`
     * (follow the main agent); a profile that needs read-only must say so
     * explicitly (e.g. the built-in reviewers).
     */
    toolPolicy: SubagentToolPolicy.default('inherit'),
    /** Exact tool allow-list; overrides toolPolicy when set (e.g. ['read','grep','bash']). */
    allowedTools: z.array(z.string().min(1)).min(1).optional(),
    /** Built-in tool names blocked for this profile (deny-list, layered on `inherit`; e.g. ['bash','write']). */
    blockedTools: z.array(z.string().min(1)).optional(),
    /** MCP server ids blocked for this profile (deny-list; the server's entire toolset is hidden from the child). */
    blockedMcpServers: z.array(z.string().min(1)).optional(),
    /** Skill ids blocked for this profile (deny-list; default inherits every available skill). */
    blockedSkills: z.array(z.string().min(1)).optional(),
    /**
     * Reasoning depth applied to this profile's child model requests. Default
     * 'off' (cheap); a profile opts into deeper thinking explicitly. Flows to
     * the child agent's ModelRequest.reasoningEffort.
     */
    reasoningEffort: ModelReasoningEffort.optional()
  })
  .strict()
export type SubagentProfileConfig = z.infer<typeof SubagentProfileConfig>

export const SubagentsCapabilityConfig = CapabilityToggleConfig.extend({
  /** Max children running at once; extra spawns queue instead of erroring. */
  maxParallel: z.number().int().nonnegative().default(0),
  /** Hard cap on total children per parent thread. */
  maxChildRuns: z.number().int().nonnegative().default(0),
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
    if (config.defaultProfile && !(config.defaultProfile in config.profiles)) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultProfile'],
        message: `defaultProfile "${config.defaultProfile}" is not defined in profiles`
      })
    }
  })
  .transform(({ defaultStepLimit: _legacyDefaultStepLimit, ...config }) => config)
export type SubagentsCapabilityConfig = z.output<typeof SubagentsCapabilityConfig>

export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_BASE64_BYTES = 512 * 1024
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_IMAGE_DIMENSION = 1280
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_PREFERRED_MIME_TYPE = 'image/webp'

export const AttachmentsCapabilityConfig = CapabilityToggleConfig.extend({
  maxImageBytes: z.number().int().positive().default(5 * 1024 * 1024),
  maxImageDimension: z.number().int().positive().default(4096),
  allowedMimeTypes: z.array(z.string().min(1)).default(['image/png', 'image/jpeg', 'image/webp']),
  textFallbackMaxBase64Bytes: z.number().int().positive().default(DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_BASE64_BYTES),
  textFallbackMaxImageDimension: z.number().int().positive().default(DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_IMAGE_DIMENSION),
  textFallbackPreferredMimeType: z.string().min(1).default(DEFAULT_ATTACHMENT_TEXT_FALLBACK_PREFERRED_MIME_TYPE)
}).strict()
export type AttachmentsCapabilityConfig = z.infer<typeof AttachmentsCapabilityConfig>

export const MemoryCapabilityConfig = CapabilityToggleConfig.extend({
  scopes: z.array(z.enum(['user', 'workspace', 'project'])).default(['user', 'workspace', 'project']),
  maxInjectedRecords: z.number().int().positive().default(8)
}).strict()
export type MemoryCapabilityConfig = z.infer<typeof MemoryCapabilityConfig>

export const ImageGenerationProtocol = z.enum(['openai-images', 'minimax-image'])
export type ImageGenerationProtocol = z.infer<typeof ImageGenerationProtocol>

export const ImageGenCapabilityConfig = CapabilityToggleConfig.extend({
  protocol: ImageGenerationProtocol.default('openai-images'),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  defaultSize: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().default(180_000),
  maxReferenceImages: z.number().int().positive().max(8).default(4)
}).strict()
export type ImageGenCapabilityConfig = z.infer<typeof ImageGenCapabilityConfig>

export const TextToSpeechProtocol = z.enum(['openai-speech', 'minimax-t2a', 'mimo-tts'])
export type TextToSpeechProtocol = z.infer<typeof TextToSpeechProtocol>

export const SpeechGenCapabilityConfig = CapabilityToggleConfig.extend({
  protocol: TextToSpeechProtocol.default('openai-speech'),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  voice: z.string().min(1).optional(),
  format: z.string().min(1).default('mp3'),
  timeoutMs: z.number().int().positive().default(120_000)
}).strict()
export type SpeechGenCapabilityConfig = z.infer<typeof SpeechGenCapabilityConfig>

export const MusicGenerationProtocol = z.enum(['minimax-music'])
export type MusicGenerationProtocol = z.infer<typeof MusicGenerationProtocol>

export const MusicGenCapabilityConfig = CapabilityToggleConfig.extend({
  protocol: MusicGenerationProtocol.default('minimax-music'),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  format: z.string().min(1).default('mp3'),
  timeoutMs: z.number().int().positive().default(300_000)
}).strict()
export type MusicGenCapabilityConfig = z.infer<typeof MusicGenCapabilityConfig>

export const VideoGenerationProtocol = z.enum(['minimax-video'])
export type VideoGenerationProtocol = z.infer<typeof VideoGenerationProtocol>

export const VideoGenCapabilityConfig = CapabilityToggleConfig.extend({
  protocol: VideoGenerationProtocol.default('minimax-video'),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  defaultDuration: z.number().int().positive().default(6),
  defaultResolution: z.string().min(1).default('1080P'),
  timeoutMs: z.number().int().positive().default(900_000),
  pollIntervalMs: z.number().int().positive().default(10_000)
}).strict()
export type VideoGenCapabilityConfig = z.infer<typeof VideoGenCapabilityConfig>

/**
 * Host computer-use mode. `auto` advertises the tool only when the active
 * model accepts image input (a vision model decides for itself); `always`
 * advertises whenever the host backend + permissions allow regardless of
 * modality; `off` never advertises it.
 */
export const ComputerUseMode = z.enum(['auto', 'always', 'off'])
export type ComputerUseMode = z.infer<typeof ComputerUseMode>

export const ComputerUseCapabilityConfig = CapabilityToggleConfig.extend({
  mode: ComputerUseMode.default('auto'),
  /** Longest screenshot edge in pixels; larger captures are downscaled for grounding. */
  maxImageDimension: z.number().int().positive().default(1280),
  /** Hard cap on computer_use actions per turn, as a runaway backstop. */
  maxActionsPerTurn: z.number().int().positive().default(40)
}).strict()
export type ComputerUseCapabilityConfig = z.infer<typeof ComputerUseCapabilityConfig>

export const KunCapabilitiesConfig = z
  .object({
    mcp: McpCapabilityConfig.default(() => McpCapabilityConfig.parse({})),
    web: WebCapabilityConfig.default(() => WebCapabilityConfig.parse({})),
    skills: SkillsCapabilityConfig.default(() => SkillsCapabilityConfig.parse({})),
    subagents: SubagentsCapabilityConfig.default(() => SubagentsCapabilityConfig.parse({})),
    attachments: AttachmentsCapabilityConfig.default(() => AttachmentsCapabilityConfig.parse({})),
    memory: MemoryCapabilityConfig.default(() => MemoryCapabilityConfig.parse({})),
    imageGen: ImageGenCapabilityConfig.default(() => ImageGenCapabilityConfig.parse({})),
    speechGen: SpeechGenCapabilityConfig.default(() => SpeechGenCapabilityConfig.parse({})),
    musicGen: MusicGenCapabilityConfig.default(() => MusicGenCapabilityConfig.parse({})),
    videoGen: VideoGenCapabilityConfig.default(() => VideoGenCapabilityConfig.parse({})),
    computerUse: ComputerUseCapabilityConfig.default(() => ComputerUseCapabilityConfig.parse({}))
  })
  .strict()
export type KunCapabilitiesConfig = z.infer<typeof KunCapabilitiesConfig>

export const DEFAULT_KUN_CAPABILITIES_CONFIG: KunCapabilitiesConfig = KunCapabilitiesConfig.parse({})

export const RuntimeCapabilityManifest = z
  .object({
    contractVersion: z.literal(RUNTIME_CAPABILITY_CONTRACT_VERSION),
    model: ModelCapabilityMetadata,
    cli: z
      .object({
        serve: RuntimeCapabilityState,
        run: RuntimeCapabilityState,
        chat: RuntimeCapabilityState,
        exec: RuntimeCapabilityState
      })
      .strict(),
    mcp: RuntimeCapabilityState.extend({
      configuredServers: z.number().int().nonnegative(),
      connectedServers: z.number().int().nonnegative(),
      toolCount: z.number().int().nonnegative(),
      search: z
        .object({
          enabled: z.boolean(),
          mode: McpToolDiscoveryMode,
          active: z.boolean(),
          indexedToolCount: z.number().int().nonnegative(),
          advertisedToolCount: z.number().int().nonnegative()
        })
        .strict()
    }).strict(),
    web: RuntimeCapabilityState.extend({
      fetch: RuntimeCapabilityState,
      search: RuntimeCapabilityState,
      provider: z.string().optional()
    }).strict(),
    skills: RuntimeCapabilityState.extend({
      configuredRoots: z.number().int().nonnegative(),
      discoveredSkills: z.number().int().nonnegative()
    }).strict(),
    subagents: RuntimeCapabilityState.extend({
      maxParallel: z.number().int().nonnegative(),
      maxChildRuns: z.number().int().nonnegative(),
      defaultToolPolicy: SubagentToolPolicy,
      defaultProfile: z.string().optional(),
      profiles: z
        .array(
          z
            .object({
              name: z.string().min(1),
              model: z.string().optional(),
              toolPolicy: SubagentToolPolicy
            })
            .strict()
        )
        .default([])
    }).strict(),
    attachments: RuntimeCapabilityState.extend({
      maxImageBytes: z.number().int().positive(),
      maxImageDimension: z.number().int().positive(),
      allowedMimeTypes: z.array(z.string().min(1)),
      textFallbackMaxBase64Bytes: z.number().int().positive(),
      textFallbackMaxImageDimension: z.number().int().positive(),
      textFallbackPreferredMimeType: z.string().min(1)
    }).strict(),
    memory: RuntimeCapabilityState.extend({
      scopes: z.array(z.enum(['user', 'workspace', 'project'])),
      maxInjectedRecords: z.number().int().positive()
    }).strict(),
    imageGen: RuntimeCapabilityState.extend({
      model: z.string().optional()
    }).strict(),
    speechGen: RuntimeCapabilityState.extend({
      model: z.string().optional()
    }).strict(),
    musicGen: RuntimeCapabilityState.extend({
      model: z.string().optional()
    }).strict(),
    videoGen: RuntimeCapabilityState.extend({
      model: z.string().optional()
    }).strict(),
    computerUse: RuntimeCapabilityState.extend({
      mode: ComputerUseMode
    }).strict()
  })
  .strict()
export type RuntimeCapabilityManifest = z.infer<typeof RuntimeCapabilityManifest>

export function buildRuntimeCapabilityManifest(input: {
  config?: KunCapabilitiesConfig
  model: ModelCapabilityMetadata
  mcp?: {
    configuredServers?: number
    connectedServers?: number
    toolCount?: number
    lastError?: string
    search?: {
      active?: boolean
      indexedToolCount?: number
      advertisedToolCount?: number
    }
  }
  web?: {
    fetchAvailable?: boolean
    searchAvailable?: boolean
    provider?: string
    reason?: string
  }
  skills?: {
    configuredRoots?: number
    discoveredSkills?: number
    reason?: string
  }
  attachments?: {
    available?: boolean
    reason?: string
  }
  memory?: {
    available?: boolean
    reason?: string
  }
  subagents?: {
    available?: boolean
    reason?: string
  }
  imageGen?: {
    available?: boolean
    reason?: string
  }
  speechGen?: {
    available?: boolean
    reason?: string
  }
  musicGen?: {
    available?: boolean
    reason?: string
  }
  videoGen?: {
    available?: boolean
    reason?: string
  }
  computerUse?: {
    available?: boolean
    reason?: string
  }
}): RuntimeCapabilityManifest {
  const config = KunCapabilitiesConfig.parse(input.config ?? {})
  const configuredMcpServers = input.mcp?.configuredServers ?? Object.keys(config.mcp.servers).length
  const connectedMcpServers = input.mcp?.connectedServers ?? 0
  const mcpToolCount = input.mcp?.toolCount ?? 0
  const mcpState = mcpCapabilityState(config.mcp.enabled, connectedMcpServers, input.mcp?.lastError)
  const webFetchState = providerCapabilityState(
    config.web.enabled && config.web.fetchEnabled,
    'web fetch is disabled by config',
    input.web?.fetchAvailable === true,
    input.web?.reason ?? 'web fetch provider is unavailable'
  )
  const webSearchState = providerCapabilityState(
    config.web.enabled && config.web.searchEnabled,
    'web search is disabled by config',
    input.web?.searchAvailable === true,
    input.web?.reason ?? 'web search provider is unavailable'
  )
  const webState = webCapabilityState(config.web.enabled, webFetchState, webSearchState, input.web?.reason)
  const configuredSkillRoots = input.skills?.configuredRoots ?? config.skills.roots.length
  const discoveredSkills = input.skills?.discoveredSkills ?? 0
  const skillsState = skillsCapabilityState(config.skills.enabled, discoveredSkills, input.skills?.reason)
  return RuntimeCapabilityManifest.parse({
    contractVersion: RUNTIME_CAPABILITY_CONTRACT_VERSION,
    model: input.model,
    cli: {
      serve: available(),
      run: unavailable('not implemented'),
      chat: unavailable('not implemented'),
      exec: unavailable('not implemented')
    },
    mcp: {
      ...mcpState,
      configuredServers: configuredMcpServers,
      connectedServers: connectedMcpServers,
      toolCount: mcpToolCount,
      search: {
        enabled: config.mcp.search.enabled,
        mode: config.mcp.search.mode,
        active: input.mcp?.search?.active ?? false,
        indexedToolCount: input.mcp?.search?.indexedToolCount ?? mcpToolCount,
        advertisedToolCount: input.mcp?.search?.advertisedToolCount ?? mcpToolCount
      }
    },
    web: {
      ...webState,
      fetch: webFetchState,
      search: webSearchState,
      provider: input.web?.provider ?? config.web.provider
    },
    skills: {
      ...skillsState,
      configuredRoots: configuredSkillRoots,
      discoveredSkills
    },
    subagents: {
      ...providerCapabilityState(
        config.subagents.enabled,
        'subagents are disabled by config',
        input.subagents?.available === true,
        input.subagents?.reason ?? 'subagent runtime is unavailable'
      ),
      maxParallel: config.subagents.maxParallel,
      maxChildRuns: config.subagents.maxChildRuns,
      defaultToolPolicy: config.subagents.defaultToolPolicy,
      ...(config.subagents.defaultProfile ? { defaultProfile: config.subagents.defaultProfile } : {}),
      profiles: Object.entries(config.subagents.profiles).map(([name, profile]) => ({
        name,
        ...(profile.model ? { model: profile.model } : {}),
        toolPolicy: profile.toolPolicy
      }))
    },
    attachments: {
      ...providerCapabilityState(
        config.attachments.enabled,
        'attachments are disabled by config',
        input.attachments?.available === true,
        input.attachments?.reason ?? 'attachment store is unavailable'
      ),
      maxImageBytes: config.attachments.maxImageBytes,
      maxImageDimension: config.attachments.maxImageDimension,
      allowedMimeTypes: config.attachments.allowedMimeTypes,
      textFallbackMaxBase64Bytes: config.attachments.textFallbackMaxBase64Bytes,
      textFallbackMaxImageDimension: config.attachments.textFallbackMaxImageDimension,
      textFallbackPreferredMimeType: config.attachments.textFallbackPreferredMimeType
    },
    memory: {
      ...providerCapabilityState(
        config.memory.enabled,
        'memory is disabled by config',
        input.memory?.available === true,
        input.memory?.reason ?? 'memory store is unavailable'
      ),
      scopes: config.memory.scopes,
      maxInjectedRecords: config.memory.maxInjectedRecords
    },
    imageGen: {
      ...providerCapabilityState(
        config.imageGen.enabled,
        'image generation is disabled by config',
        input.imageGen?.available === true,
        input.imageGen?.reason ?? 'image generation provider is not configured'
      ),
      ...(config.imageGen.model ? { model: config.imageGen.model } : {})
    },
    speechGen: {
      ...providerCapabilityState(
        config.speechGen.enabled,
        'speech generation is disabled by config',
        input.speechGen?.available === true,
        input.speechGen?.reason ?? 'speech generation provider is not configured'
      ),
      ...(config.speechGen.model ? { model: config.speechGen.model } : {})
    },
    musicGen: {
      ...providerCapabilityState(
        config.musicGen.enabled,
        'music generation is disabled by config',
        input.musicGen?.available === true,
        input.musicGen?.reason ?? 'music generation provider is not configured'
      ),
      ...(config.musicGen.model ? { model: config.musicGen.model } : {})
    },
    videoGen: {
      ...providerCapabilityState(
        config.videoGen.enabled,
        'video generation is disabled by config',
        input.videoGen?.available === true,
        input.videoGen?.reason ?? 'video generation provider is not configured'
      ),
      ...(config.videoGen.model ? { model: config.videoGen.model } : {})
    },
    computerUse: {
      ...providerCapabilityState(
        config.computerUse.enabled && config.computerUse.mode !== 'off',
        'computer use is disabled by config',
        input.computerUse?.available === true,
        input.computerUse?.reason ?? 'computer-use backend is unavailable on this platform'
      ),
      mode: config.computerUse.mode
    }
  })
}

function available(): RuntimeCapabilityState {
  return { status: 'available', enabled: true, available: true }
}

function unavailable(reason: string): RuntimeCapabilityState {
  return { status: 'unavailable', enabled: false, available: false, reason }
}

function stateFromEnabled(
  enabled: boolean,
  disabledReason: string,
  unavailableReason: string
): RuntimeCapabilityState {
  return enabled
    ? { status: 'unavailable', enabled: true, available: false, reason: unavailableReason }
    : { status: 'disabled', enabled: false, available: false, reason: disabledReason }
}

function providerCapabilityState(
  enabled: boolean,
  disabledReason: string,
  availableProvider: boolean,
  unavailableReason: string
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: disabledReason }
  return availableProvider
    ? { status: 'available', enabled: true, available: true }
    : { status: 'unavailable', enabled: true, available: false, reason: unavailableReason }
}

function webCapabilityState(
  enabled: boolean,
  fetchState: RuntimeCapabilityState,
  searchState: RuntimeCapabilityState,
  reason: string | undefined
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: 'web access is disabled by config' }
  if (fetchState.available || searchState.available) return { status: 'available', enabled: true, available: true }
  return {
    status: 'unavailable',
    enabled: true,
    available: false,
    reason: reason ?? 'no web providers available'
  }
}

function skillsCapabilityState(
  enabled: boolean,
  discoveredSkills: number,
  reason: string | undefined
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: 'Skills are disabled by config' }
  if (discoveredSkills > 0) return { status: 'available', enabled: true, available: true }
  return {
    status: 'unavailable',
    enabled: true,
    available: false,
    reason: reason ?? 'no Skills discovered'
  }
}

function mcpCapabilityState(
  enabled: boolean,
  connectedServers: number,
  lastError: string | undefined
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: 'MCP is disabled by config' }
  if (connectedServers > 0) return { status: 'available', enabled: true, available: true }
  return {
    status: 'unavailable',
    enabled: true,
    available: false,
    reason: lastError ?? 'no MCP servers connected'
  }
}
