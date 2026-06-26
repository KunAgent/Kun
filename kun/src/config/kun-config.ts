import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from '../contracts/policy.js'
import {
  DEFAULT_KUN_CAPABILITIES_CONFIG,
  KunCapabilitiesConfig,
  ModelInputModality,
  ModelMessagePartSupport,
  ModelReasoningCapabilityMetadata,
  ModelReasoningEffort
} from '../contracts/capabilities.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  MODEL_ENDPOINT_FORMATS,
  normalizeModelEndpointFormat
} from '../contracts/model-endpoint-format.js'
import { HooksConfigSchema } from '../hooks/hook-config.js'

export const KUN_CONFIG_FILENAME = 'config.json'
export const DEFAULT_KUN_MODEL = 'deepseek-v4-pro'

const PositiveInt = z.number().int().positive()
const PositiveRatio = z.number().positive().max(1)

export const ModelContextCompactionProfileConfigSchema = z
  .object({
    softRatio: PositiveRatio.optional(),
    hardRatio: PositiveRatio.optional(),
    softThreshold: PositiveInt.optional(),
    hardThreshold: PositiveInt.optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      profile.softThreshold !== undefined &&
      profile.hardThreshold !== undefined &&
      profile.hardThreshold < profile.softThreshold
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'hardThreshold must be greater than or equal to softThreshold'
      })
    }
  })

export const ModelContextProfileConfigSchema = z
  .object({
    aliases: z.array(z.string().min(1)).optional(),
    contextWindowTokens: PositiveInt.optional(),
    maxOutputTokens: PositiveInt.optional(),
    contextCompaction: ModelContextCompactionProfileConfigSchema.optional(),
    softRatio: PositiveRatio.optional(),
    hardRatio: PositiveRatio.optional(),
    softThreshold: PositiveInt.optional(),
    hardThreshold: PositiveInt.optional(),
    inputModalities: z.array(ModelInputModality).optional(),
    outputModalities: z.array(ModelInputModality).optional(),
    supportsToolCalling: z.boolean().optional(),
    messageParts: z.array(ModelMessagePartSupport).optional(),
    reasoning: ModelReasoningCapabilityMetadata.optional(),
    // Per-model wire-format override. Omitted means "inherit the
    // provider/runtime endpointFormat"; no default coercion here, otherwise
    // every model would be pinned to chat_completions.
    endpointFormat: z
      .preprocess(normalizeModelEndpointFormat, z.enum(MODEL_ENDPOINT_FORMATS))
      .optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    const hasRatio =
      profile.softRatio !== undefined ||
      profile.hardRatio !== undefined ||
      profile.contextCompaction?.softRatio !== undefined ||
      profile.contextCompaction?.hardRatio !== undefined
    if (hasRatio && profile.contextWindowTokens === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'softRatio and hardRatio require contextWindowTokens'
      })
    }
    const softThreshold = profile.contextCompaction?.softThreshold ?? profile.softThreshold
    const hardThreshold = profile.contextCompaction?.hardThreshold ?? profile.hardThreshold
    if (softThreshold !== undefined && hardThreshold !== undefined && hardThreshold < softThreshold) {
      ctx.addIssue({
        code: 'custom',
        message: 'hardThreshold must be greater than or equal to softThreshold'
      })
    }
  })

export const ModelConfigSchema = z
  .object({
    profiles: z.record(z.string().min(1), ModelContextProfileConfigSchema).optional()
  })
  .strict()

export const ContextCompactionConfigSchema = z
  .object({
    defaultSoftThreshold: PositiveInt.optional(),
    defaultHardThreshold: PositiveInt.optional(),
    summaryMode: z.enum(['heuristic', 'model']).optional(),
    summaryTimeoutMs: PositiveInt.optional(),
    summaryMaxTokens: PositiveInt.optional(),
    summaryInputMaxBytes: PositiveInt.optional(),
    summaryModel: z.string().min(1).optional(),
    summaryProviderId: z.string().min(1).optional(),
    modelProfiles: z.record(z.string().min(1), ModelContextProfileConfigSchema).optional()
  })
  .strict()
  .superRefine((config, ctx) => {
    if (
      config.defaultSoftThreshold !== undefined &&
      config.defaultHardThreshold !== undefined &&
      config.defaultHardThreshold < config.defaultSoftThreshold
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'defaultHardThreshold must be greater than or equal to defaultSoftThreshold'
      })
    }
  })

export const RuntimeTuningConfigSchema = z
  .object({
    // Max idle gap (ms) between streaming chunks before a turn fails with
    // `stream_idle_timeout`. Local LLM servers prefilling a huge prompt can
    // stay silent well past the 45s default; `0` disables the guard entirely.
    streamIdleTimeoutMs: z.number().int().min(0).optional(),
    toolStorm: z
      .object({
        enabled: z.boolean().optional(),
        windowSize: PositiveInt.optional(),
        threshold: z.number().int().min(2).optional()
      })
      .strict()
      .optional(),
    toolArgumentRepair: z
      .object({
        maxStringBytes: PositiveInt.optional()
      })
      .strict()
      .optional()
  })
  .strict()

/** Detection aggressiveness for the design-quality linter. */
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

export const StorageConfigSchema = z
  .object({
    backend: z.enum(['hybrid', 'file']).default('hybrid'),
    sqlitePath: z.string().min(1).optional()
  })
  .strict()

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  backend: 'hybrid'
}

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
     * existing Claude Code login).
     */
    kind: z.enum(['http', 'agent-sdk']).default('http').optional(),
    apiKey: z.string().default(''),
    baseUrl: z.string().min(1).optional(),
    endpointFormat: z
      .preprocess(normalizeModelEndpointFormat, z.enum(MODEL_ENDPOINT_FORMATS))
      .default(DEFAULT_MODEL_ENDPOINT_FORMAT)
      .optional(),
    modelProxyUrl: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional()
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if ((cfg.kind ?? 'http') !== 'agent-sdk' && !cfg.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'baseUrl is required for http providers'
      })
    }
  })
export type ServeProviderConfig = z.infer<typeof ServeProviderConfigSchema>

export const KunServeConfigSchema = z
  .object({
    host: z.string().optional(),
    port: z.number().int().min(0).max(65_535).optional(),
    dataDir: z.string().min(1).optional(),
    runtimeToken: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    modelProxyUrl: z.string().optional(),
    endpointFormat: z.preprocess(
      normalizeModelEndpointFormat,
      z.enum(MODEL_ENDPOINT_FORMATS)
    ).default(DEFAULT_MODEL_ENDPOINT_FORMAT).optional(),
    model: z.string().min(1).optional(),
    approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY).optional(),
    sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE).optional(),
    tokenEconomyMode: z.boolean().optional(),
    tokenEconomy: TokenEconomyConfigSchema.optional(),
    insecure: z.boolean().optional(),
    storage: StorageConfigSchema.optional(),
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
    providers: z.record(z.string().min(1), ServeProviderConfigSchema).optional()
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
    titleModel: z.string().min(1).optional(),
    titleProviderId: z.string().min(1).optional(),
    summaryModel: z.string().min(1).optional(),
    summaryProviderId: z.string().min(1).optional(),
    codeReviewModel: z.string().min(1).optional(),
    codeReviewProviderId: z.string().min(1).optional(),
    // Per-role reasoning depth. Default 'off' (the GUI omits it entirely).
    titleReasoningEffort: ModelReasoningEffort.optional(),
    summaryReasoningEffort: ModelReasoningEffort.optional(),
    codeReviewReasoningEffort: ModelReasoningEffort.optional()
  })
  .strict()
export type RolesConfig = z.infer<typeof RolesConfigSchema>

export const KunConfigSchema = z
  .object({
    serve: KunServeConfigSchema.optional(),
    models: ModelConfigSchema.optional(),
    contextCompaction: ContextCompactionConfigSchema.optional(),
    runtime: RuntimeTuningConfigSchema.optional(),
    roles: RolesConfigSchema.optional(),
    capabilities: KunCapabilitiesConfig.default(DEFAULT_KUN_CAPABILITIES_CONFIG),
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
export type StorageConfig = z.infer<typeof StorageConfigSchema>

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
  const parsed = KunConfigSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Invalid Kun config at ${resolvedPath}: ${JSON.stringify(parsed.error.issues, null, 2)}`
    )
  }
  return { path: resolvedPath, config: parsed.data }
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
