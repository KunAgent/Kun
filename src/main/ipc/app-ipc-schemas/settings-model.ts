import { z } from 'zod'
import {
  APP_LOCALES,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_PROTOCOLS,
  IMAGE_GENERATION_RESOLUTIONS,
  MUSIC_GENERATION_PROTOCOLS,
  MODEL_ENDPOINT_FORMATS,
  MODEL_PROVIDER_INPUT_MODALITIES,
  MODEL_PROVIDER_MESSAGE_PARTS,
  MODEL_REASONING_EFFORTS,
  MODEL_REASONING_REQUEST_PROTOCOLS,
  MODEL_SERVICE_TIERS,
  MAX_MODEL_CONTEXT_WINDOW_TOKENS,
  MAX_MODEL_OUTPUT_TOKENS,
  MAX_WRITE_AUTOSAVE_DELAY_MS,
  MIN_WRITE_AUTOSAVE_DELAY_MS,
  MIN_KUN_LOCAL_PORT,
  KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION,
  KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
  MODEL_REQUEST_RETRY_DEFAULTS_VERSION,
  SCHEDULE_MODEL_IDS,
  SCHEDULE_REASONING_EFFORT_IDS,
  SPEECH_TO_TEXT_PROTOCOLS,
  TEXT_TO_SPEECH_PROTOCOLS,
  VIDEO_GENERATION_PROTOCOLS,
  WRITE_INLINE_COMPLETION_MODEL_IDS,
  WINDOW_CLOSE_ACTIONS,
  CHAT_CONTENT_MAX_WIDTH_MIN,
  CHAT_CONTENT_MAX_WIDTH_MAX,
  UI_FONT_SCALE_MIN,
  UI_FONT_SCALE_MAX,
  type ModelProviderModelProfilePatchV1
} from '../../../shared/app-settings'
import { GUI_UPDATE_CHANNELS } from '../../../shared/gui-update'
import { KEYBOARD_SHORTCUT_COMMANDS } from '../../../shared/keyboard-shortcuts'
import { LOCAL_WHISPER_DOWNLOAD_SOURCES, LOCAL_WHISPER_MODELS } from '../../../shared/local-whisper'
import type { LocalWhisperDownloadSourceId } from '../../../shared/local-whisper'
import { kunGraphPatchSchema } from './settings-graph'
import { kunLabPatchSchema } from './settings-lab'
import {
  MAX_BODY_BYTES,
  MAX_CHANNEL_TEXT_LENGTH,
  MAX_ID_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_PATH_LENGTH,
  MAX_URL_LENGTH,
  defaultPathSchema,
  optionalTrimmedString,
  trimmedString
} from './common'
export const localeSchema = z.enum(APP_LOCALES)
export const themeSchema = z.enum(['system', 'light', 'dark'])
export const uiFontScaleSchema = z.union([
  z.number().min(UI_FONT_SCALE_MIN).max(UI_FONT_SCALE_MAX),
  z.enum(['small', 'medium', 'large'])
])
export const chatContentMaxWidthSchema = z.number().min(CHAT_CONTENT_MAX_WIDTH_MIN).max(CHAT_CONTENT_MAX_WIDTH_MAX)
export const hexColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/)
export const approvalPolicySchema = z.enum(['always', 'on-request', 'untrusted', 'never', 'auto', 'suggest'])
export const sandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access', 'external-sandbox'])
export const approvalReviewerSchema = z.enum(['user', 'agent'])
export const mcpSearchModeSchema = z.enum(['direct', 'search', 'auto'])
export const kunStorageBackendSchema = z.enum(['hybrid', 'file'])
export const kunCompactionSummaryModeSchema = z.enum(['heuristic', 'model'])
export const clawRunModeSchema = z.enum(['agent', 'plan'])
export const clawImProviderSchema = z.enum(['feishu', 'weixin', 'telegram'])
export const clawScheduleKindSchema = z.enum(['manual', 'interval', 'daily', 'at'])
export const clawTaskStatusSchema = z.enum(['idle', 'queued', 'running', 'success', 'error'])
export const scheduleReasoningEffortSchema = z.enum(SCHEDULE_REASONING_EFFORT_IDS)
export const modelIdSchema = z.string().trim().min(1).max(MAX_MODEL_ID_LENGTH)
export const optionalModelIdSchema = z.string().trim().max(MAX_MODEL_ID_LENGTH).optional()
export const cursorSubscriptionDiscoveryPayloadSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(MAX_BODY_BYTES).optional(),
    providerId: modelIdSchema.optional()
  })
  .strict()
  .refine((value) => Boolean(value.apiKey || value.providerId), {
    message: 'apiKey or providerId is required'
  })
export const writeInlineCompletionModelSchema = z.union([
  z.enum(WRITE_INLINE_COMPLETION_MODEL_IDS),
  modelIdSchema
])
export const modelEndpointFormatSchema = z.enum(MODEL_ENDPOINT_FORMATS)
export const imageGenerationProtocolSchema = z.enum(IMAGE_GENERATION_PROTOCOLS)
export const imageGenerationResolutionSchema = z.enum(IMAGE_GENERATION_RESOLUTIONS)
export const imageGenerationQualitySchema = z.enum(IMAGE_GENERATION_QUALITIES)
export const speechToTextProtocolSchema = z.enum(SPEECH_TO_TEXT_PROTOCOLS)
export const localWhisperModelIdSchema = z.enum(LOCAL_WHISPER_MODELS.map((model) => model.id) as [string, ...string[]])
const localWhisperDownloadSourceIds = LOCAL_WHISPER_DOWNLOAD_SOURCES.map((source) => source.id) as [
  LocalWhisperDownloadSourceId,
  ...LocalWhisperDownloadSourceId[]
]
export const localWhisperDownloadSourceSchema = z.enum(
  localWhisperDownloadSourceIds
)
export const textToSpeechProtocolSchema = z.enum(TEXT_TO_SPEECH_PROTOCOLS)
export const musicGenerationProtocolSchema = z.enum(MUSIC_GENERATION_PROTOCOLS)
export const videoGenerationProtocolSchema = z.enum(VIDEO_GENERATION_PROTOCOLS)
export const speechToTextSettingsSchema = z.object({
  enabled: z.boolean(),
  providerId: z.string().trim().max(64),
  protocol: speechToTextProtocolSchema,
  baseUrl: z.string().trim().max(MAX_URL_LENGTH),
  apiKey: z.string().max(MAX_BODY_BYTES),
  model: z.string().trim().max(MAX_MODEL_ID_LENGTH),
  localWhisperDownloadSource: localWhisperDownloadSourceSchema,
  language: z.string().trim().max(16),
  timeoutMs: z.number().int().positive().max(600_000)
}).strict()
const modelProviderInputModalitySchema = z.enum(MODEL_PROVIDER_INPUT_MODALITIES)
const modelProviderMessagePartSchema = z.enum(MODEL_PROVIDER_MESSAGE_PARTS)
const modelReasoningEffortSchema = z.enum(MODEL_REASONING_EFFORTS)
const modelReasoningRequestProtocolSchema = z.enum(MODEL_REASONING_REQUEST_PROTOCOLS)
const modelServiceTierSchema = z.enum(MODEL_SERVICE_TIERS)
const modelProfilePatchShape = {
  aliases: z.array(modelIdSchema).max(50).optional(),
  contextWindowTokens: z.number().int().positive().max(MAX_MODEL_CONTEXT_WINDOW_TOKENS).optional(),
  maxOutputTokens: z.number().int().positive().max(MAX_MODEL_OUTPUT_TOKENS).optional(),
  inputModalities: z.array(modelProviderInputModalitySchema).max(8).optional(),
  outputModalities: z.array(modelProviderInputModalitySchema).max(8).optional(),
  supportsToolCalling: z.boolean().optional(),
  messageParts: z.array(modelProviderMessagePartSchema).max(8).optional(),
  reasoning: z.object({
    supportedEfforts: z.array(modelReasoningEffortSchema).min(1).max(8),
    defaultEffort: modelReasoningEffortSchema,
    requestProtocol: modelReasoningRequestProtocolSchema
  }).strict().optional(),
  serviceTiers: z.array(modelServiceTierSchema).min(1).max(MODEL_SERVICE_TIERS.length).optional(),
  endpointFormat: modelEndpointFormatSchema.optional(),
  responsesMode: z.literal('lite').optional()
} satisfies Record<keyof ModelProviderModelProfilePatchV1, z.ZodTypeAny>
const modelProfilePatchSchema = z.object(modelProfilePatchShape).strict()

export const modelProviderPatchSchema = z.object({
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  proxy: z.object({
    enabled: z.boolean().optional(),
    url: z.string().trim().max(MAX_URL_LENGTH).optional()
  }).strict().optional(),
  providers: z.array(z.object({
    id: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    presetSource: z.object({
      presetId: z.string().trim().min(1).max(64),
      mode: z.enum(['api', 'token-plan'])
    }).strict().optional(),
    apiKey: z.string().max(MAX_BODY_BYTES).optional(),
    baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
    endpointFormat: modelEndpointFormatSchema.optional(),
    retry: z.object({
      maxAttempts: z.number().int().min(0).max(10).optional(),
      initialDelayMs: z.number().int().min(0).max(600_000).optional(),
      httpStatusCodes: z.array(z.number().int().min(400).max(599)).max(64).optional(),
      defaultsVersion: z.number().int().min(0).max(MODEL_REQUEST_RETRY_DEFAULTS_VERSION).optional()
    }).strict().optional(),
    kind: z.enum([
      'http',
      'agent-sdk',
      'antigravity-cli',
      'gemini-cli-api',
      'cursor-sdk',
      'gemini-code-assist'
    ]).optional(),
    // Some third-party aggregators (litellm, oneapi, …) advertise 500+ chat
    // models in a single /v1/models response. The previous 200/50 caps caused
    // settings:set to silently fail with no toast (#397). Raised to leave
    // plenty of headroom while still bounding pathological payloads.
    models: z.array(modelIdSchema).max(2000).optional(),
    // 兼容旧版保存的视觉识别能力字段。当前能力已经迁移到 modelProfiles 的 inputModalities/messageParts。
    imageRecognition: z.unknown().optional(),
    modelProfiles: z.record(
      modelIdSchema,
      modelProfilePatchSchema.nullable()
    ).optional(),
    image: z.object({
      protocol: imageGenerationProtocolSchema.optional(),
      baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
      models: z.array(modelIdSchema).max(500).optional()
    }).strict().nullable().optional(),
    speech: z.object({
      protocol: speechToTextProtocolSchema.optional(),
      baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
      models: z.array(modelIdSchema).max(500).optional()
    }).strict().nullable().optional(),
    textToSpeech: z.object({
      protocol: textToSpeechProtocolSchema.optional(),
      baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
      models: z.array(modelIdSchema).max(500).optional()
    }).strict().nullable().optional(),
    music: z.object({
      protocol: musicGenerationProtocolSchema.optional(),
      baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
      models: z.array(modelIdSchema).max(500).optional()
    }).strict().nullable().optional(),
    video: z.object({
      protocol: videoGenerationProtocolSchema.optional(),
      baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
      models: z.array(modelIdSchema).max(500).optional()
    }).strict().nullable().optional()
  }).strict()).max(50).optional(),
  routePools: z.array(z.object({
    id: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    modelId: modelIdSchema.optional(),
    enabled: z.boolean().optional(),
    strategy: z.enum(['priority', 'round-robin', 'weighted-round-robin', 'least-latency', 'adaptive']).optional(),
    targets: z.array(z.object({
      id: z.string().trim().min(1).max(64),
      providerId: z.string().trim().min(1).max(64),
      modelId: modelIdSchema,
      enabled: z.boolean(),
      weight: z.number().int().min(1).max(100)
    }).strict()).max(50).optional(),
    failurePolicy: z.object({
      failoverHttpStatusCodes: z.array(z.number().int().min(400).max(599)).max(64),
      failoverOnNetworkError: z.boolean(),
      failoverOnTimeout: z.boolean(),
      failoverOnAuthError: z.boolean()
    }).strict().optional(),
    healthPolicy: z.object({
      failureThreshold: z.number().int().min(1).max(20),
      cooldownMs: z.number().int().min(1000).max(3_600_000),
      halfOpenMaxAttempts: z.number().int().min(1).max(10)
    }).strict().optional()
  }).strict()).max(100).optional(),
  localGateway: z.object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(80).optional()
  }).strict().optional()
}).strict()

// Subagent profile patch. `.passthrough()` so a field the GUI adds later is
// preserved through the strict parent instead of being dropped (which would
// silently lose a configured model/reasoning on round-trip).
const subagentProfilePatchSchema = z
  .object({
    id: z.string().min(1).max(128),
    enabled: z.boolean(),
    name: z.string().max(200),
    description: z.string().max(2000).optional(),
    color: z.string().max(32).optional(),
    mode: z.enum(['subagent', 'primary', 'all']),
    model: z.string().max(256).optional(),
    providerId: z.string().trim().max(64).optional(),
    systemPrompt: z.string().max(MAX_BODY_BYTES).optional(),
    promptPreamble: z.string().max(MAX_BODY_BYTES).optional(),
    toolPolicy: z.enum(['readOnly', 'inherit']),
    allowedTools: z.array(z.string().max(128)).max(200).optional(),
    blockedTools: z.array(z.string().max(128)).max(200).optional(),
    blockedMcpServers: z.array(z.string().max(128)).max(200).optional(),
    blockedSkills: z.array(z.string().max(128)).max(200).optional(),
    reasoningEffort: modelReasoningEffortSchema.optional(),
    builtin: z.boolean().optional()
  })
  .passthrough()

const subagentsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    useExistingAgents: z.boolean().optional(),
    maxParallel: z.number().int().positive().max(256).optional(),
    proactiveRetry: z.object({
      enabled: z.boolean().optional(),
      maxAttempts: z.number().int().min(1).max(3).optional()
    }).strict().optional(),
    // Compatibility input only. The transform below prevents old persisted or
    // renderer-supplied cumulative limits from reaching effective settings.
    maxChildRuns: z.number().int().nonnegative().max(10_000).optional(),
    defaultToolPolicy: z.enum(['readOnly', 'inherit']).optional(),
    defaultProfile: z.string().max(128).optional(),
    profiles: z.array(subagentProfilePatchSchema).max(200).optional()
  })
  .passthrough()
  .transform(({ maxChildRuns: legacyMaxChildRuns, ...effective }) => {
    void legacyMaxChildRuns
    return effective
  })

export const kunRuntimePatchSchema = z.object({
  binaryPath: defaultPathSchema,
  port: z.number().int().min(MIN_KUN_LOCAL_PORT).max(65_535).optional(),
  autoStart: z.boolean().optional(),
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  providerId: z.string().trim().max(64).optional(),
  endpointFormat: modelEndpointFormatSchema.optional(),
  retry: z.object({
    maxAttempts: z.number().int().min(0).max(10).optional(),
    initialDelayMs: z.number().int().min(0).max(600_000).optional(),
    httpStatusCodes: z.array(z.number().int().min(400).max(599)).max(64).optional(),
    defaultsVersion: z.number().int().min(0).max(MODEL_REQUEST_RETRY_DEFAULTS_VERSION).optional()
  }).strict().optional(),
  runtimeToken: z.string().max(MAX_BODY_BYTES).optional(),
  dataDir: defaultPathSchema,
  model: modelIdSchema.optional(),
  approvalPolicy: approvalPolicySchema.optional(),
  sandboxMode: sandboxModeSchema.optional(),
  approvalReviewer: approvalReviewerSchema.optional(),
  tokenEconomyMode: z.boolean().optional(),
  tokenEconomy: z.object({
    enabled: z.boolean().optional(),
    compressToolDescriptions: z.boolean().optional(),
    compressToolResults: z.boolean().optional(),
    conciseResponses: z.boolean().optional(),
    historyHygiene: z.object({
      maxToolResultLines: z.number().int().positive().max(100_000).optional(),
      maxToolResultBytes: z.number().int().positive().max(8 * 1024 * 1024).optional(),
      maxToolResultTokens: z.number().int().positive().max(256_000).optional(),
      maxToolArgumentStringBytes: z.number().int().positive().max(8 * 1024 * 1024).optional(),
      maxToolArgumentStringTokens: z.number().int().positive().max(64_000).optional(),
      maxArrayItems: z.number().int().positive().max(10_000).optional()
    }).strict().optional()
  }).strict().optional(),
  toolOutputLimits: z.object({
    maxLines: z.number().int().positive().max(1_000_000).optional(),
    maxBytes: z.number().int().positive().max(64 * 1024 * 1024).optional()
  }).strict().optional(),
  insecure: z.boolean().optional(),
  mcpSearch: z.object({
    enabled: z.boolean().optional(),
    mode: mcpSearchModeSchema.optional(),
    autoThresholdToolCount: z.number().int().positive().optional(),
    topKDefault: z.number().int().positive().optional(),
    topKMax: z.number().int().positive().optional(),
    minScore: z.number().nonnegative().optional()
  }).strict().optional(),
  projectConfig: z.object({
    grants: z.array(z.object({
      workspaceRoot: trimmedString(MAX_PATH_LENGTH),
      configDigest: z.string().trim().regex(/^[a-fA-F0-9]{64}$/)
    }).strict()).max(64).optional()
  }).strict().optional(),
  storage: z.object({
    backend: kunStorageBackendSchema.optional(),
    sqlitePath: defaultPathSchema
  }).strict().optional(),
  contextCompaction: z.object({
    defaultsVersion: z.number().int().positive().max(KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION).optional(),
    defaultSoftThreshold: z.number().int().positive().optional(),
    defaultHardThreshold: z.number().int().positive().optional(),
    summaryMode: kunCompactionSummaryModeSchema.optional(),
    summaryTimeoutMs: z.number().int().positive().max(120_000).optional(),
    summaryMaxTokens: z.number().int().positive().max(16_000).optional(),
    summaryInputMaxBytes: z.number().int().positive().max(8 * 1024 * 1024).optional(),
    summaryModel: optionalModelIdSchema,
    summaryProviderId: z.string().trim().max(64).optional()
  }).strict().optional(),
  runtimeTuning: z.object({
    defaultsVersion: z.number().int().positive().max(KUN_RUNTIME_TUNING_DEFAULTS_VERSION).optional(),
    maxConcurrentTurns: z.number().int().positive().max(256).optional(),
    maxWallTimeMs: z.number().int().positive().max(86_400_000).optional(),
    streamIdleTimeoutMs: z.number().int().min(0).max(3_600_000).optional(),
    toolStorm: z.object({
      enabled: z.boolean().optional()
    }).strict().optional(),
    toolArgumentRepair: z.object({
      maxStringBytes: z.number().int().positive().max(16 * 1024 * 1024).optional()
    }).strict().optional(),
    interruptedTurnResume: z.object({
      enabled: z.boolean().optional()
    }).strict().optional()
  }).strict().optional(),
  llmDebug: z.object({
    defaultThreadCaptureEnabled: z.boolean().optional()
  }).strict().optional(),
  quality: z.object({
    enabled: z.boolean().optional(),
    strictness: z.enum(['relaxed', 'standard', 'strict']).optional(),
    ignoreRules: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
    ignoreFiles: z.array(z.string().trim().min(1).max(256)).max(200).optional(),
    maxFindings: z.number().int().positive().max(100).optional()
  }).strict().optional(),
  imageGeneration: z.object({
    enabled: z.boolean().optional(),
    providerId: z.string().trim().max(64).optional(),
    protocol: imageGenerationProtocolSchema.optional(),
    baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
    apiKey: z.string().max(MAX_BODY_BYTES).optional(),
    model: optionalModelIdSchema,
    defaultResolution: imageGenerationResolutionSchema.optional(),
    defaultSize: z.string().trim().max(16).optional(),
    quality: imageGenerationQualitySchema.optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional()
  }).strict().optional(),
  speechToText: z.object({
    enabled: z.boolean().optional(),
    providerId: z.string().trim().max(64).optional(),
    protocol: speechToTextProtocolSchema.optional(),
    baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
    apiKey: z.string().max(MAX_BODY_BYTES).optional(),
    model: optionalModelIdSchema,
    localWhisperDownloadSource: localWhisperDownloadSourceSchema.optional(),
    language: z.string().trim().max(16).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional()
  }).strict().optional(),
  textToSpeech: z.object({
    enabled: z.boolean().optional(),
    providerId: z.string().trim().max(64).optional(),
    protocol: textToSpeechProtocolSchema.optional(),
    baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
    apiKey: z.string().max(MAX_BODY_BYTES).optional(),
    model: optionalModelIdSchema,
    voice: z.string().trim().max(128).optional(),
    format: z.string().trim().max(16).optional(),
    timeoutMs: z.number().int().positive().max(900_000).optional()
  }).strict().optional(),
  promptOptimization: z.object({
    enabled: z.boolean().optional(),
    providerId: z.string().trim().max(64).optional(),
    model: optionalModelIdSchema,
    prompt: z.string().trim().max(MAX_BODY_BYTES).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional()
  }).strict().optional(),
  musicGeneration: z.object({
    enabled: z.boolean().optional(),
    providerId: z.string().trim().max(64).optional(),
    protocol: musicGenerationProtocolSchema.optional(),
    baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
    apiKey: z.string().max(MAX_BODY_BYTES).optional(),
    model: optionalModelIdSchema,
    format: z.string().trim().max(16).optional(),
    timeoutMs: z.number().int().positive().max(1_800_000).optional()
  }).strict().optional(),
  videoGeneration: z.object({
    enabled: z.boolean().optional(),
    providerId: z.string().trim().max(64).optional(),
    protocol: videoGenerationProtocolSchema.optional(),
    baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
    apiKey: z.string().max(MAX_BODY_BYTES).optional(),
    model: optionalModelIdSchema,
    defaultDuration: z.number().int().positive().max(30).optional(),
    defaultResolution: z.string().trim().max(32).optional(),
    timeoutMs: z.number().int().positive().max(3_600_000).optional(),
    pollIntervalMs: z.number().int().positive().max(120_000).optional()
  }).strict().optional(),
  computerUse: z.object({
    enabled: z.boolean().optional(),
    mode: z.enum(['auto', 'always', 'off']).optional(),
    maxImageDimension: z.number().int().positive().max(4096).optional(),
    maxActionsPerTurn: z.number().int().positive().max(1000).optional()
  }).strict().optional(),
  browserUse: z.object({
    enabled: z.boolean().optional(),
    mode: z.enum(['public', 'local-development']).optional(),
    approvalMode: z.enum(['auto-safe', 'always-ask']).optional(),
    maxTabs: z.number().int().min(1).max(3).optional(),
    maxObservationActionsPerTurn: z.number().int().min(1).max(100).optional(),
    maxInteractionActionsPerTurn: z.number().int().min(1).max(50).optional(),
    maxSnapshotNodes: z.number().int().min(10).max(500).optional(),
    maxSnapshotTextChars: z.number().int().min(1000).max(50_000).optional(),
    maxImageDimension: z.number().int().min(320).max(2048).optional(),
    idleTimeoutMs: z.number().int().min(30_000).max(1_800_000).optional()
  }).strict().optional(),
  // 兼容旧版保存的独立视觉识别设置。当前能力已经迁移到 provider modelProfiles。
  imageRecognition: z.unknown().optional(),
  modelProfiles: z.record(
    modelIdSchema,
    modelProfilePatchSchema.nullable()
  ).optional(),
  memoryEnabled: z.boolean().optional(),
  instructions: z.object({
    enabled: z.boolean().optional()
  }).strict().optional(),
  // Global small-model slot + per-role internal-LLM model overrides (agents.kun.*).
  // Title & Summary default to smallModel, then the main conversation model.
  smallModel: optionalModelIdSchema,
  smallModelProviderId: z.string().trim().max(64).optional(),
  smallModelAccountId: z.string().trim().max(256).optional(),
  titleModel: optionalModelIdSchema,
  titleProviderId: z.string().trim().max(64).optional(),
  titleAccountId: z.string().trim().max(256).optional(),
  summaryModel: optionalModelIdSchema,
  summaryProviderId: z.string().trim().max(64).optional(),
  summaryAccountId: z.string().trim().max(256).optional(),
  codeReviewModel: optionalModelIdSchema,
  codeReviewProviderId: z.string().trim().max(64).optional(),
  codeReviewAccountId: z.string().trim().max(256).optional(),
  planModel: optionalModelIdSchema,
  planProviderId: z.string().trim().max(64).optional(),
  planAccountId: z.string().trim().max(256).optional(),
  // Per-role reasoning depth. Default 'off' is omitted by the normalizer.
  titleReasoningEffort: modelReasoningEffortSchema.optional(),
  summaryReasoningEffort: modelReasoningEffortSchema.optional(),
  codeReviewReasoningEffort: modelReasoningEffortSchema.optional(),
  graph: kunGraphPatchSchema.optional(),
  planExecution: z.object({
    useWorktreeByDefault: z.boolean().optional()
  }).strict().optional(),
  subagents: subagentsPatchSchema.optional(),
  lab: kunLabPatchSchema.optional()
}).strict()
