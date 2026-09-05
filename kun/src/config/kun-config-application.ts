import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { GeminiCodeAssistCredential } from '../contracts/gemini-code-assist.js'
import {
  ApprovalReviewerSchema,
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from '../contracts/policy.js'
import {
  AttachmentsCapabilityConfig,
  ComputerUseCapabilityConfig,
  DEFAULT_KUN_CAPABILITIES_CONFIG,
  ImageGenCapabilityConfig,
  InstructionsCapabilityConfig,
  KunCapabilitiesConfig,
  McpCapabilityConfig,
  MemoryCapabilityConfig,
  ModelCapabilityMetadata,
  ModelInputModality,
  ModelMessagePartSupport,
  ModelReasoningCapabilityMetadata,
  ModelReasoningEffort,
  MusicGenCapabilityConfig,
  SkillsCapabilityConfig,
  SpeechGenCapabilityConfig,
  SubagentsCapabilityConfig,
  VideoGenCapabilityConfig,
  WebCapabilityConfig
} from '../contracts/capabilities.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  MODEL_ENDPOINT_FORMATS,
  normalizeModelEndpointFormat
} from '../contracts/model-endpoint-format.js'
import {
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES
} from '../contracts/tool-output-limits.js'
import { HooksConfigSchema } from '../hooks/hook-config.js'
import { LocalModelGatewayConfigSchema, ModelRoutePoolConfigSchema } from '../contracts/model-route-pool.js'

import {
  ContextCompactionConfigSchema,
  GraphRuntimeConfigSchema,
  HttpUrl,
  KUN_CONFIG_FILENAME,
  ModelConfigSchema,
  ModelContextProfileConfigSchema,
  ModelRequestRetryConfigSchema,
  PositiveInt,
  RuntimeTuningConfigSchema
} from './kun-config-runtime.js'

export const DESIGN_QUALITY_STRICTNESS = ['relaxed', 'standard', 'strict'] as const

/**
 * First-party design-quality linter. When enabled, a builtin PostToolUse
 * hook scans frontend files the agent writes/edits and folds findings back
 * into the tool result so the model self-corrects on the next turn.
 */
export const QualityConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    strictness: z.enum(DESIGN_QUALITY_STRICTNESS).default('standard'),
    /** Rule ids to suppress (see the quality detector registry). */
    ignoreRules: z.array(z.string().min(1)).default([]),
    /** Glob patterns (relative paths) to skip, e.g. `**\/vendor/**`. */
    ignoreFiles: z.array(z.string().min(1)).default([]),
    /** Hard cap on findings folded into a single tool result. */
    maxFindings: z.number().int().positive().max(100).default(12)
  })
  .strict()

export const RequestHistoryHygieneConfigSchema = z
  .object({
    maxToolResultLines: PositiveInt.optional(),
    maxToolResultBytes: PositiveInt.optional(),
    maxToolResultTokens: PositiveInt.optional(),
    maxToolArgumentStringBytes: PositiveInt.optional(),
    maxToolArgumentStringTokens: PositiveInt.optional(),
    maxArrayItems: PositiveInt.optional()
  })
  .strict()

export const TokenEconomyConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    compressToolDescriptions: z.boolean().optional(),
    compressToolResults: z.boolean().optional(),
    conciseResponses: z.boolean().optional(),
    historyHygiene: RequestHistoryHygieneConfigSchema.optional()
  })
  .strict()

export const ToolOutputLimitsConfigSchema = z
  .object({
    maxLines: PositiveInt.optional(),
    maxBytes: PositiveInt.optional()
  })
  .strict()

export const DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG: Required<ToolOutputLimitsConfig> = {
  maxLines: DEFAULT_TOOL_OUTPUT_MAX_LINES,
  maxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES
}

export const StorageConfigSchema = z
  .object({
    backend: z.enum(['hybrid', 'file']).default('hybrid'),
    sqlitePath: z.string().min(1).optional()
  })
  .strict()

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  backend: 'hybrid'
}

export const ObservabilityConfigSchema = z
  .object({
    enabled: z.boolean().default(false).optional(),
    outputPath: z.string().min(1).optional(),
    exporter: z.enum(['jsonl', 'otlp-http-json']).optional(),
    endpoint: HttpUrl.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().min(1).max(300_000).optional(),
    batchSize: z.number().int().min(1).max(512).optional(),
    maxQueueSize: z.number().int().min(1).max(16_384).optional(),
    // Prompt/tool payloads remain excluded unless this explicit opt-in is set.
    includeSensitiveContent: z.boolean().default(false).optional()
  })
  .strict()

/**
 * Per-`providerId` HTTP credentials. Lets the runtime route a thread's turns
 * to a non-default provider without restart — the workflow / scheduled task
 * UI picks a provider per request, the loop puts the id on `ModelRequest`,
 * and `MultiProviderModelClient` resolves it against this map.
 */
export const ServeProviderConfigSchema = z
  .object({
    /**
     * Transport kind. `http` (default) routes turns through a CompatModelClient
     * over `baseUrl`. `agent-sdk` delegates whole turns to the embedded Claude
     * Agent SDK (Claude Pro/Max subscription billing): `baseUrl` is unused and
     * `apiKey` carries the CLAUDE_CODE_OAUTH_TOKEN (empty => rely on the host's
     * existing Claude Code login). `antigravity-cli` delegates whole turns to
     * Google's official Antigravity CLI and uses its existing subscription login.
     * `cursor-sdk` delegates whole turns to the official Cursor SDK and requires
     * the provider's Cursor API key. `gemini-cli-api` reuses the official
     * Gemini CLI OAuth login and calls Code Assist directly through Kun's
     * model loop.
     */
    kind: z.enum([
      'http',
      'agent-sdk',
      'antigravity-cli',
      'gemini-cli-api',
      'gemini-code-assist',
      'cursor-sdk'
    ]).default('http').optional(),
    apiKey: z.string().default(''),
    /** Opaque binding key resolved through the protected account store. */
    credentialSourceId: z.string().min(1).max(256).optional(),
    /** Stable built-in preset identity; independent from a multi-account id. */
    presetSource: z.string().min(1).max(128).optional(),
    /** Preserves the base or token-plan channel of the preset source. */
    presetMode: z.enum(['api', 'token-plan']).optional(),
    /** Secret-free authentication family used for capability gating. */
    authType: z.enum(['api-key', 'oauth', 'subscription']).optional(),
    baseUrl: z.string().min(1).optional(),
    endpointFormat: z
      .preprocess(normalizeModelEndpointFormat, z.enum(MODEL_ENDPOINT_FORMATS))
      .default(DEFAULT_MODEL_ENDPOINT_FORMAT)
      .optional(),
    retry: ModelRequestRetryConfigSchema.optional(),
    /** Durable Provider intent; effective routing is materialized separately. */
    useProxy: z.boolean().optional(),
    modelProxyUrl: z.string().optional(),
    modelProfiles: z.record(z.string().min(1), ModelContextProfileConfigSchema).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    /** Secret-free catalog metadata used to seed the shared model registry. */
    models: z.array(z.string().min(1).max(512)).max(500).optional(),
    /** Provider-scoped, secret-free capability metadata for the model catalog. */
    modelCapabilities: z.record(z.string().min(1).max(512), ModelCapabilityMetadata).optional(),
    selectedModel: z.string().min(1).max(512).optional()
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if ((cfg.kind ?? 'http') === 'http' && !cfg.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'baseUrl is required for http providers'
      })
    }
  })
export type ServeProviderConfig = z.infer<typeof ServeProviderConfigSchema> & {
  /** Legacy protected Code Assist material retained for forward migration. */
  geminiAuth?: GeminiCodeAssistCredential
}

export const KunServeConfigSchema = z
  .object({
    host: z.string().optional(),
    port: z.number().int().min(0).max(65_535).optional(),
    dataDir: z.string().min(1).optional(),
    runtimeToken: z.string().optional(),
    apiKey: z.string().optional(),
    /** Opaque binding key resolved through the protected account store. */
    credentialSourceId: z.string().min(1).max(256).optional(),
    baseUrl: z.string().optional(),
    modelProxyUrl: z.string().optional(),
    endpointFormat: z.preprocess(
      normalizeModelEndpointFormat,
      z.enum(MODEL_ENDPOINT_FORMATS)
    ).default(DEFAULT_MODEL_ENDPOINT_FORMAT).optional(),
    retry: ModelRequestRetryConfigSchema.optional(),
    model: z.string().min(1).optional(),
    approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY).optional(),
    sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE).optional(),
    approvalReviewer: ApprovalReviewerSchema.default(DEFAULT_APPROVAL_REVIEWER).optional(),
    tokenEconomyMode: z.boolean().optional(),
    tokenEconomy: TokenEconomyConfigSchema.optional(),
    toolOutputLimits: ToolOutputLimitsConfigSchema.optional(),
    insecure: z.boolean().optional(),
    storage: StorageConfigSchema.optional(),
    observability: ObservabilityConfigSchema.optional(),
    /**
     * Extra HTTP headers merged into every default-client model request
     * (last, so they win). Used for providers that authenticate with more
     * than a Bearer key — e.g. Codex needs `ChatGPT-Account-Id` and a
     * Codex-CLI `User-Agent` alongside the OAuth access token.
     */
    headers: z.record(z.string(), z.string()).optional(),
    /**
     * Extra providers the runtime can route to per request. Keys are
     * provider ids (matched against `ModelRequest.providerId`); values
     * hold the same HTTP credentials shape as the runtime defaults. When
     * empty/absent, the runtime stays single-provider.
     */
    providers: z.record(z.string().min(1), ServeProviderConfigSchema).optional(),
    routePools: z.array(ModelRoutePoolConfigSchema).max(100).optional(),
    localModelGateway: LocalModelGatewayConfigSchema.optional()
  })
  .strict()

/**
 * Internal-LLM role model routing. The global `smallModel` slot is the default
 * for cheap internal one-shot calls (thread title, whole-session summary). Each
 * role can override with its own model/provider. Empty/absent => fall back to
 * smallModel, then the main conversation model. Compaction is intentionally NOT
 * here: it reuses the main conversation model for prompt-cache reasons and only
 * exposes its heuristic/model toggle via contextCompaction.summaryMode.
 */
export const RolesConfigSchema = z
  .object({
    smallModel: z.string().min(1).optional(),
    smallModelProviderId: z.string().min(1).optional(),
    smallModelAccountId: z.string().min(1).optional(),
    titleModel: z.string().min(1).optional(),
    titleProviderId: z.string().min(1).optional(),
    titleAccountId: z.string().min(1).optional(),
    summaryModel: z.string().min(1).optional(),
    summaryProviderId: z.string().min(1).optional(),
    summaryAccountId: z.string().min(1).optional(),
    codeReviewModel: z.string().min(1).optional(),
    codeReviewProviderId: z.string().min(1).optional(),
    codeReviewAccountId: z.string().min(1).optional(),
    // Per-role reasoning depth. Default 'off' (the GUI omits it entirely).
    titleReasoningEffort: ModelReasoningEffort.optional(),
    summaryReasoningEffort: ModelReasoningEffort.optional(),
    codeReviewReasoningEffort: ModelReasoningEffort.optional()
  })
  .strict()
export type RolesConfig = z.infer<typeof RolesConfigSchema>

/** First-class `fast_context` tool settings. */
export const FastContextConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    model: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    reasoningEffort: ModelReasoningEffort.optional(),
    fast: z.boolean().default(false)
  })
  .strict()
  .superRefine((config, ctx) => {
    const hasModel = Boolean(config.model?.trim())
    const hasProvider = Boolean(config.providerId?.trim())
    if (hasModel === hasProvider) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasModel ? ['providerId'] : ['model'],
      message: 'fastContext model and providerId must be configured together'
    })
  })
export type FastContextConfig = z.infer<typeof FastContextConfigSchema>

/**
 * Lab `ppt_agent` tool: same shape as Fast Context (enabled + optional child
 * model route + fast). The PPT child also inherits the main session unless
 * model and providerId are configured as a pair.
 */
export const LabPptAgentConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    model: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    reasoningEffort: ModelReasoningEffort.optional(),
    fast: z.boolean().default(false),
    imageFirst: z.boolean().default(true)
  })
  .strict()
  .superRefine((config, ctx) => {
    const hasModel = Boolean(config.model?.trim())
    const hasProvider = Boolean(config.providerId?.trim())
    if (hasModel === hasProvider) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasModel ? ['providerId'] : ['model'],
      message: 'pptAgent model and providerId must be configured together'
    })
  })
export type LabPptAgentConfig = z.infer<typeof LabPptAgentConfigSchema>

export const LabConversationVisualizationConfigSchema = z.object({
  enabled: z.boolean().default(false)
}).strict()
export type LabConversationVisualizationConfig = z.infer<
  typeof LabConversationVisualizationConfigSchema
>

export const LabProjectBoardConfigSchema = z.object({
  enabled: z.boolean().default(false)
}).strict()
export type LabProjectBoardConfig = z.infer<typeof LabProjectBoardConfigSchema>

export const LabConfigSchema = z
  .object({
    pptAgent: LabPptAgentConfigSchema.default({
      enabled: true,
      fast: false,
      imageFirst: true
    }),
    conversationVisualization: LabConversationVisualizationConfigSchema.default({
      enabled: false
    }),
    projectBoard: LabProjectBoardConfigSchema.default({
      enabled: false
    })
  })
  .strict()
export type LabConfig = z.infer<typeof LabConfigSchema>

export const KunConfigSchema = z
  .object({
    serve: KunServeConfigSchema.optional(),
    models: ModelConfigSchema.optional(),
    contextCompaction: ContextCompactionConfigSchema.optional(),
    runtime: RuntimeTuningConfigSchema.optional(),
    graph: GraphRuntimeConfigSchema.optional(),
    roles: RolesConfigSchema.optional(),
    capabilities: KunCapabilitiesConfig.default(DEFAULT_KUN_CAPABILITIES_CONFIG),
    fastContext: FastContextConfigSchema.optional(),
    lab: LabConfigSchema.optional(),
    hooks: HooksConfigSchema.optional(),
    quality: QualityConfigSchema.optional()
  })
  .strict()

export type KunConfig = z.infer<typeof KunConfigSchema>
export type QualityConfig = z.infer<typeof QualityConfigSchema>
export const DEFAULT_QUALITY_CONFIG: QualityConfig = QualityConfigSchema.parse({})
export type KunServeConfig = z.infer<typeof KunServeConfigSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ContextCompactionConfig = z.infer<typeof ContextCompactionConfigSchema>
export type RuntimeTuningConfig = z.infer<typeof RuntimeTuningConfigSchema>
export type TokenEconomyConfig = z.infer<typeof TokenEconomyConfigSchema>
export type ToolOutputLimitsConfig = z.infer<typeof ToolOutputLimitsConfigSchema>
export type StorageConfig = z.infer<typeof StorageConfigSchema>
export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>

export type LoadedKunConfig = {
  path: string
  config: KunConfig
}

export function readKunConfigFile(path: string): LoadedKunConfig {
  const resolvedPath = expandHomePath(path)
  const text = readFileSync(resolvedPath, 'utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse Kun config JSON at ${resolvedPath}: ${message}`)
  }
  const normalized = migrateLegacyFastContextConfig(normalizeLegacyProviderKinds(json))
  const parsed = KunConfigSchema.safeParse(normalized)
  if (!parsed.success) {
    const compatible = parseForwardCompatibleKunConfig(normalized)
    if (compatible) {
      return { path: resolvedPath, config: compatible }
    }
    throw new Error(
      `Invalid Kun config at ${resolvedPath}: ${JSON.stringify(parsed.error.issues, null, 2)}`
    )
  }
  return { path: resolvedPath, config: parsed.data }
}

export function migrateLegacyFastContextConfig(json: unknown): unknown {
  if (!isRecord(json) || !isRecord(json.lab) || json.fastContext !== undefined || json.lab.fastContext === undefined) return json
  const { fastContext, ...lab } = json.lab
  return { ...json, fastContext, lab }
}

/**
 * Idempotently migrates known legacy provider transport kinds written by older
 * GUI builds before a provider-id/kind rename. Only `serve.providers.*.kind`
 * values that map 1:1 to a current enum member are rewritten; everything else
 * is preserved so the strict schema still reports the exact offending path.
 */
export function normalizeLegacyProviderKinds(json: unknown): unknown {
  if (!isRecord(json)) return json
  const serve = json.serve
  if (!isRecord(serve)) return json
  const providers = serve.providers
  if (!isRecord(providers)) return json
  let changed = false
  const nextProviders: Record<string, unknown> = {}
  for (const [id, provider] of Object.entries(providers)) {
    if (!isRecord(provider) || provider.kind !== 'gemini-cli-subscription') {
      nextProviders[id] = provider
      continue
    }
    nextProviders[id] = { ...provider, kind: 'gemini-cli-api' }
    changed = true
  }
  if (!changed) return json
  return { ...json, serve: { ...serve, providers: nextProviders } }
}

export const FORWARD_COMPATIBLE_TOP_LEVEL_SECTIONS = [
  ['models', ModelConfigSchema],
  ['contextCompaction', ContextCompactionConfigSchema],
  ['runtime', RuntimeTuningConfigSchema],
  ['roles', RolesConfigSchema],
  ['fastContext', FastContextConfigSchema],
  ['hooks', HooksConfigSchema],
  ['quality', QualityConfigSchema]
] as const

export const FORWARD_COMPATIBLE_CAPABILITY_SECTIONS = [
  ['mcp', McpCapabilityConfig],
  ['web', WebCapabilityConfig],
  ['instructions', InstructionsCapabilityConfig],
  ['skills', SkillsCapabilityConfig],
  ['subagents', SubagentsCapabilityConfig],
  ['attachments', AttachmentsCapabilityConfig],
  ['memory', MemoryCapabilityConfig],
  ['imageGen', ImageGenCapabilityConfig],
  ['speechGen', SpeechGenCapabilityConfig],
  ['musicGen', MusicGenCapabilityConfig],
  ['videoGen', VideoGenCapabilityConfig],
  ['computerUse', ComputerUseCapabilityConfig]
] as const

/**
 * A newer GUI may write capability metadata that an older bundled TUI does
 * not know yet. Keep startup fail-closed for the connection-critical `serve`
 * section, while preserving every independently valid section and falling
 * back to this runtime's defaults for only the newer capability fragments.
 */
export function parseForwardCompatibleKunConfig(json: unknown): KunConfig | null {
  if (!isRecord(json)) return null

  const compatible: Record<string, unknown> = {}
  if (json.serve !== undefined) {
    const serve = KunServeConfigSchema.safeParse(json.serve)
    if (!serve.success) return null
    compatible.serve = serve.data
  }

  for (const [key, schema] of FORWARD_COMPATIBLE_TOP_LEVEL_SECTIONS) {
    if (json[key] === undefined) continue
    const section = schema.safeParse(json[key])
    // Known runtime sections are executable configuration, not display-only
    // metadata. Never hide a typo or unsupported override in one of them while
    // recovering from unrelated newer GUI fields.
    if (!section.success) return null
    compatible[key] = section.data
  }

  if (isRecord(json.capabilities)) {
    const capabilities: Record<string, unknown> = {}
    for (const [key, schema] of FORWARD_COMPATIBLE_CAPABILITY_SECTIONS) {
      if (json.capabilities[key] === undefined) continue
      const section = schema.safeParse(json.capabilities[key])
      if (section.success) capabilities[key] = section.data
    }
    compatible.capabilities = capabilities
  }

  const parsed = KunConfigSchema.safeParse(compatible)
  return parsed.success ? parsed.data : null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function readOptionalKunConfigFile(path: string | undefined): LoadedKunConfig | null {
  if (!path) return null
  const resolvedPath = expandHomePath(path)
  if (!existsSync(resolvedPath)) return null
  return readKunConfigFile(resolvedPath)
}

export function kunConfigPathForDataDir(dataDir: string | undefined): string | undefined {
  const trimmed = dataDir?.trim()
  if (!trimmed) return undefined
  return join(expandHomePath(trimmed), KUN_CONFIG_FILENAME)
}

export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2).replace(/\\/g, '/'))
  }
  return path
}
