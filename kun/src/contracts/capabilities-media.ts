import { z } from 'zod'
import { MODEL_ENDPOINT_FORMATS } from './model-endpoint-format.js'

import {
  CapabilityToggleConfig,
  InstructionsCapabilityConfig,
  McpCapabilityConfig,
  McpToolDiscoveryMode,
  ModelCapabilityMetadata,
  ProactiveSubagentRetryConfig,
  RUNTIME_CAPABILITY_CONTRACT_VERSION,
  RuntimeCapabilityState,
  SkillsCapabilityConfig,
  SubagentToolPolicy,
  SubagentsCapabilityConfig,
  WebCapabilityConfig
} from './capabilities-core.js'
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_BASE64_BYTES = 512 * 1024
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_IMAGE_DIMENSION = 1280
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_PREFERRED_MIME_TYPE = 'image/webp'
export const DEFAULT_ATTACHMENT_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/xml',
  'text/xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
export const DEFAULT_ATTACHMENT_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const DEFAULT_ATTACHMENT_MAX_DOCUMENT_TEXT_CHARS = 200_000

export const AttachmentsCapabilityConfig = CapabilityToggleConfig.extend({
  maxImageBytes: z.number().int().positive().default(5 * 1024 * 1024),
  maxImageDimension: z.number().int().positive().default(4096),
  allowedMimeTypes: z.array(z.string().min(1)).default(['image/png', 'image/jpeg', 'image/webp']),
  allowedDocumentMimeTypes: z.array(z.string().min(1)).default(DEFAULT_ATTACHMENT_DOCUMENT_MIME_TYPES),
  maxDocumentBytes: z.number().int().positive().default(DEFAULT_ATTACHMENT_MAX_DOCUMENT_BYTES),
  maxDocumentTextChars: z.number().int().positive().default(DEFAULT_ATTACHMENT_MAX_DOCUMENT_TEXT_CHARS),
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

export const ImageGenerationProtocol = z.enum([
  'openai-images',
  'minimax-image',
  'codex-responses-image',
  'grok-imagine-image',
  'volcengine-ark-image'
])
export type ImageGenerationProtocol = z.infer<typeof ImageGenerationProtocol>
export const ImageGenerationQuality = z.enum(['auto', 'low', 'medium', 'high'])
export type ImageGenerationQuality = z.infer<typeof ImageGenerationQuality>
export const ImageGenerationResolution = z.enum(['auto', '1K', '2K', '3K', '4K'])
export type ImageGenerationResolution = z.infer<typeof ImageGenerationResolution>

export const ImageGenCapabilityConfig = CapabilityToggleConfig.extend({
  providerId: z.string().min(1).optional(),
  protocol: ImageGenerationProtocol.default('openai-images'),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  model: z.string().min(1).optional(),
  defaultSize: z.string().min(1).optional(),
  defaultResolution: ImageGenerationResolution.default('1K'),
  quality: ImageGenerationQuality.default('auto'),
  timeoutMs: z.number().int().positive().default(180_000),
  maxReferenceImages: z.number().int().positive().max(8).default(4)
}).strict()
export type ImageGenCapabilityConfig = z.infer<typeof ImageGenCapabilityConfig>

export const TextToSpeechProtocol = z.enum(['openai-speech', 'minimax-t2a', 'mimo-tts'])
export type TextToSpeechProtocol = z.infer<typeof TextToSpeechProtocol>

export const SpeechGenCapabilityConfig = CapabilityToggleConfig.extend({
  providerId: z.string().min(1).optional(),
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
  providerId: z.string().min(1).optional(),
  protocol: MusicGenerationProtocol.default('minimax-music'),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  format: z.string().min(1).default('mp3'),
  timeoutMs: z.number().int().positive().default(300_000)
}).strict()
export type MusicGenCapabilityConfig = z.infer<typeof MusicGenCapabilityConfig>

export const VideoGenerationProtocol = z.enum([
  'minimax-video',
  'grok-imagine-video',
  'volcengine-ark-video'
])
export type VideoGenerationProtocol = z.infer<typeof VideoGenerationProtocol>

export const VideoGenCapabilityConfig = CapabilityToggleConfig.extend({
  providerId: z.string().min(1).optional(),
  protocol: VideoGenerationProtocol.default('minimax-video'),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
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

export const BrowserUseMode = z.enum(['public', 'local-development'])
export type BrowserUseMode = z.infer<typeof BrowserUseMode>
export const BrowserUseApprovalMode = z.enum(['auto-safe', 'always-ask'])
export type BrowserUseApprovalMode = z.infer<typeof BrowserUseApprovalMode>

export const BrowserUseCapabilityConfig = CapabilityToggleConfig.extend({
  mode: BrowserUseMode.default('public'),
  approvalMode: BrowserUseApprovalMode.default('auto-safe'),
  maxTabs: z.number().int().min(1).max(3).default(2),
  maxObservationActionsPerTurn: z.number().int().min(1).max(100).default(30),
  maxInteractionActionsPerTurn: z.number().int().min(1).max(50).default(12),
  maxSnapshotNodes: z.number().int().min(10).max(500).default(250),
  maxSnapshotTextChars: z.number().int().min(1000).max(50_000).default(20_000),
  maxImageDimension: z.number().int().min(320).max(2048).default(1280),
  idleTimeoutMs: z.number().int().min(30_000).max(30 * 60_000).default(5 * 60_000)
}).strict()
export type BrowserUseCapabilityConfig = z.infer<typeof BrowserUseCapabilityConfig>

export const KunCapabilitiesConfig = z
  .object({
    mcp: McpCapabilityConfig.default(() => McpCapabilityConfig.parse({})),
    web: WebCapabilityConfig.default(() => WebCapabilityConfig.parse({})),
    instructions: InstructionsCapabilityConfig.default(() => InstructionsCapabilityConfig.parse({ enabled: true })),
    skills: SkillsCapabilityConfig.default(() => SkillsCapabilityConfig.parse({})),
    subagents: SubagentsCapabilityConfig.default(() => SubagentsCapabilityConfig.parse({})),
    attachments: AttachmentsCapabilityConfig.default(() => AttachmentsCapabilityConfig.parse({})),
    memory: MemoryCapabilityConfig.default(() => MemoryCapabilityConfig.parse({})),
    imageGen: ImageGenCapabilityConfig.default(() => ImageGenCapabilityConfig.parse({})),
    speechGen: SpeechGenCapabilityConfig.default(() => SpeechGenCapabilityConfig.parse({})),
    musicGen: MusicGenCapabilityConfig.default(() => MusicGenCapabilityConfig.parse({})),
    videoGen: VideoGenCapabilityConfig.default(() => VideoGenCapabilityConfig.parse({})),
    computerUse: ComputerUseCapabilityConfig.default(() => ComputerUseCapabilityConfig.parse({})),
    browserUse: BrowserUseCapabilityConfig.default(() => BrowserUseCapabilityConfig.parse({}))
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
    instructions: RuntimeCapabilityState.extend({
      lastSourceCount: z.number().int().nonnegative(),
      lastInjectedBytes: z.number().int().nonnegative()
    }).strict(),
    subagents: RuntimeCapabilityState.extend({
      useExistingAgents: z.boolean(),
      maxParallel: z.number().int().nonnegative(),
      proactiveRetry: ProactiveSubagentRetryConfig,
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
      allowedDocumentMimeTypes: z.array(z.string().min(1)),
      maxDocumentBytes: z.number().int().positive(),
      maxDocumentTextChars: z.number().int().positive(),
      textFallbackMaxBase64Bytes: z.number().int().positive(),
      textFallbackMaxImageDimension: z.number().int().positive(),
      textFallbackPreferredMimeType: z.string().min(1)
    }).strict(),
    memory: RuntimeCapabilityState.extend({
      scopes: z.array(z.enum(['user', 'workspace', 'project'])),
      maxInjectedRecords: z.number().int().positive()
    }).strict(),
    imageGen: RuntimeCapabilityState.extend({
      model: z.string().optional(),
      supportsReferenceEdit: z.boolean()
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
    }).strict(),
    browserUse: RuntimeCapabilityState.extend({
      mode: BrowserUseMode,
      approvalMode: BrowserUseApprovalMode
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
  instructions?: {
    available?: boolean
    reason?: string
    lastSourceCount?: number
    lastInjectedBytes?: number
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
    supportsReferenceEdit?: boolean
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
  browserUse?: {
    available?: boolean
    interactionRequired?: boolean
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
  const instructionsState = providerCapabilityState(
    config.instructions.enabled,
    'instructions are disabled by config',
    input.instructions?.available !== false,
    input.instructions?.reason ?? 'instructions runtime is unavailable'
  )
  return RuntimeCapabilityManifest.parse({
    contractVersion: RUNTIME_CAPABILITY_CONTRACT_VERSION,
    model: input.model,
    cli: {
      serve: available(),
      run: available(),
      chat: available(),
      exec: available()
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
    instructions: {
      ...instructionsState,
      lastSourceCount: input.instructions?.lastSourceCount ?? 0,
      lastInjectedBytes: input.instructions?.lastInjectedBytes ?? 0
    },
    subagents: {
      ...providerCapabilityState(
        config.subagents.enabled,
        'subagents are disabled by config',
        input.subagents?.available === true,
        input.subagents?.reason ?? 'subagent runtime is unavailable'
      ),
      useExistingAgents: config.subagents.useExistingAgents,
      maxParallel: config.subagents.maxParallel,
      proactiveRetry: config.subagents.proactiveRetry,
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
      allowedDocumentMimeTypes: config.attachments.allowedDocumentMimeTypes,
      maxDocumentBytes: config.attachments.maxDocumentBytes,
      maxDocumentTextChars: config.attachments.maxDocumentTextChars,
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
      ...(config.imageGen.model ? { model: config.imageGen.model } : {}),
      supportsReferenceEdit: input.imageGen?.supportsReferenceEdit === true
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
    },
    browserUse: {
      ...browserUseCapabilityState(
        config.browserUse.enabled,
        input.browserUse?.available === true,
        input.browserUse?.interactionRequired === true,
        input.browserUse?.reason
      ),
      mode: config.browserUse.mode,
      approvalMode: config.browserUse.approvalMode
    }
  })
}

export function available(): RuntimeCapabilityState {
  return { status: 'available', enabled: true, available: true }
}

export function unavailable(reason: string): RuntimeCapabilityState {
  return { status: 'unavailable', enabled: false, available: false, reason }
}

export function stateFromEnabled(
  enabled: boolean,
  disabledReason: string,
  unavailableReason: string
): RuntimeCapabilityState {
  return enabled
    ? { status: 'unavailable', enabled: true, available: false, reason: unavailableReason }
    : { status: 'disabled', enabled: false, available: false, reason: disabledReason }
}

export function providerCapabilityState(
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

export function browserUseCapabilityState(
  enabled: boolean,
  hostAvailable: boolean,
  interactionRequired: boolean,
  reason: string | undefined
): RuntimeCapabilityState {
  if (!enabled) {
    return {
      status: 'disabled',
      enabled: false,
      available: false,
      reason: 'browser use is disabled by config'
    }
  }
  if (interactionRequired) {
    return {
      status: 'interaction-required',
      enabled: true,
      available: false,
      reason: reason ?? 'browser use requires a visible authenticated GUI'
    }
  }
  return hostAvailable
    ? { status: 'available', enabled: true, available: true }
    : {
        status: 'unavailable',
        enabled: true,
        available: false,
        reason: reason ?? 'browser-use host bridge is unavailable'
      }
}

export function webCapabilityState(
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

export function skillsCapabilityState(
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

export function mcpCapabilityState(
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
