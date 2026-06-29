import { z } from 'zod'
import {
  KUN_APPROVAL_TEMPLATE,
  KUN_ATTACHMENT_CONTENT_TEMPLATE,
  KUN_ATTACHMENT_DIAGNOSTICS_TEMPLATE,
  KUN_ATTACHMENTS_TEMPLATE,
  KUN_ATTACHMENT_TEMPLATE,
  KUN_HEALTH_TEMPLATE,
  KUN_MEMORY_DIAGNOSTICS_TEMPLATE,
  KUN_MEMORY_RECORD_TEMPLATE,
  KUN_MEMORY_TEMPLATE,
  KUN_RUNTIME_INFO_TEMPLATE,
  KUN_RUNTIME_TOOLS_TEMPLATE,
  KUN_SESSION_RESUME_TEMPLATE,
  KUN_SKILLS_TEMPLATE,
  KUN_THREADS_TEMPLATE,
  KUN_THREAD_COMPACT_TEMPLATE,
  KUN_THREAD_FORK_TEMPLATE,
  KUN_THREAD_GOAL_TEMPLATE,
  KUN_THREAD_REVIEW_TEMPLATE,
  KUN_THREAD_REWIND_TEMPLATE,
  KUN_THREAD_TODOS_TEMPLATE,
  KUN_THREAD_INTERRUPT_TEMPLATE,
  KUN_THREAD_STEER_TEMPLATE,
  KUN_THREAD_TURNS_TEMPLATE,
  KUN_THREAD_TEMPLATE,
  KUN_USER_INPUT_TEMPLATE,
  KUN_USAGE_TEMPLATE,
  KUN_DEBUG_LLM_ROUNDS_TEMPLATE,
  KUN_BACKGROUND_SHELLS_TEMPLATE,
  KUN_BACKGROUND_SHELL_TEMPLATE
} from '../../shared/kun-endpoints'
import {
  IMAGE_GENERATION_PROTOCOLS,
  MUSIC_GENERATION_PROTOCOLS,
  MODEL_ENDPOINT_FORMATS,
  MODEL_PROVIDER_INPUT_MODALITIES,
  MODEL_PROVIDER_MESSAGE_PARTS,
  MODEL_REASONING_EFFORTS,
  MODEL_REASONING_REQUEST_PROTOCOLS,
  MIN_KUN_LOCAL_PORT,
  SCHEDULE_MODEL_IDS,
  SCHEDULE_REASONING_EFFORT_IDS,
  SPEECH_TO_TEXT_PROTOCOLS,
  TEXT_TO_SPEECH_PROTOCOLS,
  VIDEO_GENERATION_PROTOCOLS,
  WRITE_INLINE_COMPLETION_MODEL_IDS
} from '../../shared/app-settings'
import { DESKTOP_COMMANDS } from '../../shared/kun-gui-api'
import { GUI_UPDATE_CHANNELS } from '../../shared/gui-update'
import { WINDOW_CLOSE_ACTIONS, CHAT_CONTENT_MAX_WIDTH_MIN, CHAT_CONTENT_MAX_WIDTH_MAX, UI_FONT_SCALE_MIN, UI_FONT_SCALE_MAX } from '../../shared/app-settings'
import { KEYBOARD_SHORTCUT_COMMANDS } from '../../shared/keyboard-shortcuts'
import { WRITE_EXPORT_FORMATS } from '../../shared/write-export'
import { WRITE_INFOGRAPHIC_MAX_TEXT_CHARS } from '../../shared/write-infographic'
import { SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS, SPEECH_TRANSCRIPTION_MAX_DURATION_MS } from '../../shared/speech-to-text'
import { LOCAL_WHISPER_DOWNLOAD_SOURCES, LOCAL_WHISPER_MODELS } from '../../shared/local-whisper'
import type { LocalWhisperDownloadSourceId } from '../../shared/local-whisper'
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_CWD_LENGTH,
  TERMINAL_MAX_DATA_WRITE_BYTES,
  TERMINAL_MAX_ROWS,
  TERMINAL_MAX_SESSION_ID_LENGTH
} from '../../shared/terminal'

const MAX_BODY_BYTES = 2_000_000
const MAX_PATH_LENGTH = 4_096
const MAX_URL_LENGTH = 4_096
const MAX_ID_LENGTH = 256
// Provider catalogs can expose routed model ids longer than local object ids.
const MAX_MODEL_ID_LENGTH = 512
const MAX_BRANCH_LENGTH = 255
const MAX_EDITOR_ID_LENGTH = 64
const MAX_NOTIFICATION_TITLE_LENGTH = 200
const MAX_NOTIFICATION_BODY_LENGTH = 5_000
const MAX_CHANNEL_TEXT_LENGTH = 100_000
const MAX_SKILL_FILE_BYTES = 1_000_000
const MAX_CONFIG_FILE_BYTES = 2_000_000
const MAX_DEVICE_CODE_LENGTH = 8_192
const MAX_EDITOR_COMPLETION_TEXT = 200_000
const MAX_SAVE_FILE_BASE64_BYTES = 64 * 1024 * 1024

const SAFE_OPEN_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function trimmedString(max: number): z.ZodString {
  return z.string().trim().min(1).max(max)
}

function optionalTrimmedString(max: number): z.ZodOptional<z.ZodString> {
  return z.string().trim().max(max).optional()
}

export function isSafeOpenExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return SAFE_OPEN_EXTERNAL_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

export const defaultPathSchema = optionalTrimmedString(MAX_PATH_LENGTH)

export const confirmDialogPayloadSchema = z
  .object({
    message: trimmedString(4_000),
    detail: z.string().max(8_000).optional(),
    confirmLabel: z.string().trim().max(200).optional(),
    cancelLabel: z.string().trim().max(200).optional()
  })
  .strict()

export const legacySessionImportPayloadSchema = z
  .object({
    sourceDir: defaultPathSchema
  })
  .strict()

export const providerProbePayloadSchema = z
  .object({
    baseUrl: trimmedString(MAX_URL_LENGTH),
    apiKey: z.string().max(8_192),
    endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS)
  })
  .strict()

interface EndpointTemplate {
  /** Compiled path matcher. */
  match(path: string): boolean
  allowedMethods: readonly string[]
}

function compileEndpoint(
  template: string,
  allowedMethods: readonly string[]
): EndpointTemplate {
  // Build a regex from the template by escaping the literal parts and
  // substituting the `{id}` / `{turn}` placeholders with `[^/]+`. The
  // template fragments are URL-encoded by the path helpers, so they
  // contain only characters that are safe to escape directly.
  const pattern = template.replace(/[.+*?^$()|[\]\\]/g, '\\$&').replace(/\{(?:id|turn)\}/g, '[^/]+')
  const regex = new RegExp(`^${pattern}$`)
  return {
    match: (path: string) => regex.test(path),
    allowedMethods
  }
}

const ENDPOINTS: readonly EndpointTemplate[] = [
  compileEndpoint(KUN_HEALTH_TEMPLATE, ['GET']),
  compileEndpoint(KUN_RUNTIME_INFO_TEMPLATE, ['GET']),
  compileEndpoint(KUN_RUNTIME_TOOLS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_SKILLS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_ATTACHMENTS_TEMPLATE, ['POST']),
  compileEndpoint(KUN_ATTACHMENT_DIAGNOSTICS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_ATTACHMENT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_ATTACHMENT_CONTENT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_MEMORY_TEMPLATE, ['GET', 'POST']),
  compileEndpoint(KUN_MEMORY_DIAGNOSTICS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_MEMORY_RECORD_TEMPLATE, ['PATCH', 'DELETE']),
  compileEndpoint(KUN_THREADS_TEMPLATE, ['GET', 'POST']),
  compileEndpoint(KUN_THREAD_TEMPLATE, ['GET', 'PATCH', 'DELETE']),
  compileEndpoint(KUN_THREAD_FORK_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_GOAL_TEMPLATE, ['GET', 'POST', 'DELETE']),
  compileEndpoint(KUN_THREAD_TODOS_TEMPLATE, ['GET', 'POST', 'DELETE']),
  compileEndpoint(KUN_THREAD_COMPACT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_REVIEW_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_REWIND_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_TURNS_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_STEER_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_INTERRUPT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_APPROVAL_TEMPLATE, ['POST']),
  compileEndpoint(KUN_USER_INPUT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_SESSION_RESUME_TEMPLATE, ['POST']),
  compileEndpoint(KUN_USAGE_TEMPLATE, ['GET']),
  compileEndpoint(KUN_DEBUG_LLM_ROUNDS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_BACKGROUND_SHELLS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_BACKGROUND_SHELL_TEMPLATE, ['GET']),
  compileEndpoint(`${KUN_BACKGROUND_SHELL_TEMPLATE}/stop`, ['POST'])
]

function isAllowedRuntimeRequest(value: { path: string; method?: string }): boolean {
  try {
    const url = new URL(value.path, 'http://localhost')
    const path = url.pathname
    const method = value.method ?? 'GET'
    for (const endpoint of ENDPOINTS) {
      if (endpoint.match(path)) {
        return endpoint.allowedMethods.includes(method)
      }
    }
    return false
  } catch {
    return false
  }
}

export const runtimeRequestPayloadSchema = z
  .object({
    path: trimmedString(MAX_URL_LENGTH).transform((value) =>
      value.startsWith('/') ? value : `/${value}`
    ),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    body: z.string().max(MAX_BODY_BYTES).optional()
  })
  .refine((payload) => isAllowedRuntimeRequest(payload), {
    message: 'runtime request path is not allowed'
  })
  .strict()

const localeSchema = z.enum(['en', 'zh'])
const themeSchema = z.enum(['system', 'light', 'dark'])
const uiFontScaleSchema = z.union([
  z.number().min(UI_FONT_SCALE_MIN).max(UI_FONT_SCALE_MAX),
  z.enum(['small', 'medium', 'large'])
])
const chatContentMaxWidthSchema = z.number().min(CHAT_CONTENT_MAX_WIDTH_MIN).max(CHAT_CONTENT_MAX_WIDTH_MAX)
const hexColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/)
const approvalPolicySchema = z.enum(['always', 'on-request', 'untrusted', 'never', 'auto', 'suggest'])
const sandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access', 'external-sandbox'])
const mcpSearchModeSchema = z.enum(['direct', 'search', 'auto'])
const kunStorageBackendSchema = z.enum(['hybrid', 'file'])
const kunCompactionSummaryModeSchema = z.enum(['heuristic', 'model'])
const clawRunModeSchema = z.enum(['agent', 'plan'])
const clawImProviderSchema = z.enum(['feishu', 'weixin', 'telegram'])
const clawScheduleKindSchema = z.enum(['manual', 'interval', 'daily', 'at'])
const clawTaskStatusSchema = z.enum(['idle', 'queued', 'running', 'success', 'error'])
const scheduleReasoningEffortSchema = z.enum(SCHEDULE_REASONING_EFFORT_IDS)
const modelIdSchema = z.string().trim().min(1).max(MAX_MODEL_ID_LENGTH)
const optionalModelIdSchema = z.string().trim().max(MAX_MODEL_ID_LENGTH).optional()
const writeInlineCompletionModelSchema = z.union([
  z.enum(WRITE_INLINE_COMPLETION_MODEL_IDS),
  modelIdSchema
])
const modelEndpointFormatSchema = z.enum(MODEL_ENDPOINT_FORMATS)
const imageGenerationProtocolSchema = z.enum(IMAGE_GENERATION_PROTOCOLS)
const speechToTextProtocolSchema = z.enum(SPEECH_TO_TEXT_PROTOCOLS)
const localWhisperModelIdSchema = z.enum(LOCAL_WHISPER_MODELS.map((model) => model.id) as [string, ...string[]])
const localWhisperDownloadSourceIds = LOCAL_WHISPER_DOWNLOAD_SOURCES.map((source) => source.id) as [
  LocalWhisperDownloadSourceId,
  ...LocalWhisperDownloadSourceId[]
]
const localWhisperDownloadSourceSchema = z.enum(
  localWhisperDownloadSourceIds
)
const textToSpeechProtocolSchema = z.enum(TEXT_TO_SPEECH_PROTOCOLS)
const musicGenerationProtocolSchema = z.enum(MUSIC_GENERATION_PROTOCOLS)
const videoGenerationProtocolSchema = z.enum(VIDEO_GENERATION_PROTOCOLS)
const speechToTextSettingsSchema = z.object({
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
const modelProfilePatchSchema = z.object({
  aliases: z.array(modelIdSchema).max(50).optional(),
  contextWindowTokens: z.number().int().positive().max(10_000_000).optional(),
  maxOutputTokens: z.number().int().positive().max(1_000_000).optional(),
  inputModalities: z.array(modelProviderInputModalitySchema).max(8).optional(),
  outputModalities: z.array(modelProviderInputModalitySchema).max(8).optional(),
  supportsToolCalling: z.boolean().optional(),
  messageParts: z.array(modelProviderMessagePartSchema).max(8).optional(),
  reasoning: z.object({
    supportedEfforts: z.array(modelReasoningEffortSchema).min(1).max(8),
    defaultEffort: modelReasoningEffortSchema,
    requestProtocol: modelReasoningRequestProtocolSchema
  }).strict().optional(),
  endpointFormat: modelEndpointFormatSchema.optional()
}).strict()

const modelProviderPatchSchema = z.object({
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  proxy: z.object({
    enabled: z.boolean().optional(),
    url: z.string().trim().max(MAX_URL_LENGTH).optional()
  }).strict().optional(),
  providers: z.array(z.object({
    id: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    apiKey: z.string().max(MAX_BODY_BYTES).optional(),
    baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
    endpointFormat: modelEndpointFormatSchema.optional(),
    kind: z.enum(['http', 'agent-sdk']).optional(),
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
  }).strict()).max(50).optional()
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
    maxParallel: z.number().int().nonnegative().max(64).optional(),
    maxChildRuns: z.number().int().nonnegative().max(10_000).optional(),
    defaultToolPolicy: z.enum(['readOnly', 'inherit']).optional(),
    defaultProfile: z.string().max(128).optional(),
    profiles: z.array(subagentProfilePatchSchema).max(200).optional()
  })
  .passthrough()

const kunRuntimePatchSchema = z.object({
  binaryPath: defaultPathSchema,
  port: z.number().int().min(MIN_KUN_LOCAL_PORT).max(65_535).optional(),
  autoStart: z.boolean().optional(),
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  providerId: z.string().trim().max(64).optional(),
  endpointFormat: modelEndpointFormatSchema.optional(),
  runtimeToken: z.string().max(MAX_BODY_BYTES).optional(),
  dataDir: defaultPathSchema,
  model: modelIdSchema.optional(),
  approvalPolicy: approvalPolicySchema.optional(),
  sandboxMode: sandboxModeSchema.optional(),
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
  insecure: z.boolean().optional(),
  mcpSearch: z.object({
    enabled: z.boolean().optional(),
    mode: mcpSearchModeSchema.optional(),
    autoThresholdToolCount: z.number().int().positive().optional(),
    topKDefault: z.number().int().positive().optional(),
    topKMax: z.number().int().positive().optional(),
    minScore: z.number().nonnegative().optional()
  }).strict().optional(),
  storage: z.object({
    backend: kunStorageBackendSchema.optional(),
    sqlitePath: defaultPathSchema
  }).strict().optional(),
  contextCompaction: z.object({
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
    streamIdleTimeoutMs: z.number().int().min(0).max(3_600_000).optional(),
    toolStorm: z.object({
      enabled: z.boolean().optional(),
      windowSize: z.number().int().positive().max(128).optional(),
      threshold: z.number().int().min(2).max(128).optional()
    }).strict().optional(),
    toolArgumentRepair: z.object({
      maxStringBytes: z.number().int().positive().max(16 * 1024 * 1024).optional()
    }).strict().optional()
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
    defaultSize: z.string().trim().max(16).optional(),
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
  // 兼容旧版保存的独立视觉识别设置。当前能力已经迁移到 provider modelProfiles。
  imageRecognition: z.unknown().optional(),
  modelProfiles: z.record(
    modelIdSchema,
    modelProfilePatchSchema.nullable()
  ).optional(),
  memoryEnabled: z.boolean().optional(),
  // Global small-model slot + per-role internal-LLM model overrides (agents.kun.*).
  // Title & Summary default to smallModel, then the main conversation model.
  smallModel: optionalModelIdSchema,
  smallModelProviderId: z.string().trim().max(64).optional(),
  titleModel: optionalModelIdSchema,
  titleProviderId: z.string().trim().max(64).optional(),
  summaryModel: optionalModelIdSchema,
  summaryProviderId: z.string().trim().max(64).optional(),
  codeReviewModel: optionalModelIdSchema,
  codeReviewProviderId: z.string().trim().max(64).optional(),
  // Per-role reasoning depth. Default 'off' is omitted by the normalizer.
  titleReasoningEffort: modelReasoningEffortSchema.optional(),
  summaryReasoningEffort: modelReasoningEffortSchema.optional(),
  codeReviewReasoningEffort: modelReasoningEffortSchema.optional(),
  subagents: subagentsPatchSchema.optional()
}).strict()

const logPatchSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(365).optional()
}).strict()

const checkpointCleanupPatchSchema = z.object({
  enabled: z.boolean().optional(),
  intervalDays: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(5),
    z.literal(10)
  ]).optional()
}).strict()

const notificationsPatchSchema = z.object({
  turnComplete: z.boolean().optional()
}).strict()

const appBehaviorPatchSchema = z.object({
  openAtLogin: z.boolean().optional(),
  startMinimized: z.boolean().optional(),
  closeAction: z.enum(WINDOW_CLOSE_ACTIONS).optional(),
  closeToTray: z.boolean().optional()
}).strict()

const keyboardShortcutCommandIds = KEYBOARD_SHORTCUT_COMMANDS.map((command) => command.id) as [
  typeof KEYBOARD_SHORTCUT_COMMANDS[number]['id'],
  ...Array<typeof KEYBOARD_SHORTCUT_COMMANDS[number]['id']>
]

const keyboardShortcutsPatchSchema = z.object({
  bindings: z.partialRecord(
    z.enum(keyboardShortcutCommandIds),
    z.array(z.string().trim().max(64)).max(4)
  ).optional()
}).strict()

const writeInlineCompletionPatchSchema = z.object({
  enabled: z.boolean().optional(),
  retrievalEnabled: z.boolean().optional(),
  longCompletionEnabled: z.boolean().optional(),
  inheritProvider: z.boolean().optional(),
  providerId: z.string().trim().max(64).optional(),
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  inheritModel: z.boolean().optional(),
  model: writeInlineCompletionModelSchema.optional(),
  debounceMs: z.number().int().min(150).max(5_000).optional(),
  longDebounceMs: z.number().int().min(1_000).max(15_000).optional(),
  minAcceptScore: z.number().min(0.1).max(0.95).optional(),
  longMinAcceptScore: z.number().min(0.1).max(0.95).optional(),
  maxTokens: z.number().int().min(16).max(512).optional(),
  longMaxTokens: z.number().int().min(64).max(1_024).optional()
}).strict()

const writeQuickActionSchema = z.object({
  id: trimmedString(64),
  label: z.string().max(64).optional(),
  prompt: z.string().max(4_000).optional(),
  mode: z.enum(['edit', 'chat']).optional()
}).strict()

const writeSelectionAssistPatchSchema = z.object({
  infographicPrompt: z.string().max(4_000).optional(),
  designDraftPrompt: z.string().max(4_000).optional(),
  prototypePrompt: z.string().max(4_000).optional(),
  quickActions: z.array(writeQuickActionSchema).max(24).optional()
}).strict()

const writeTypographyPatchSchema = z.object({
  fontPreset: z.string().max(32).optional(),
  customFontFamily: z.string().max(200).optional(),
  fontSizePx: z.number().optional(),
  lineHeight: z.number().optional()
}).strict()

const writeAgentPresetSchema = z.object({
  id: trimmedString(64),
  name: z.string().max(64).optional(),
  emoji: z.string().max(16).optional(),
  persona: z.string().max(4_000).optional()
}).strict()

const writeSettingsPatchSchema = z.object({
  defaultWorkspaceRoot: defaultPathSchema,
  activeWorkspaceRoot: defaultPathSchema,
  workspaces: z.array(trimmedString(MAX_PATH_LENGTH)).max(256).optional(),
  inlineCompletion: writeInlineCompletionPatchSchema.optional(),
  selectionAssist: writeSelectionAssistPatchSchema.optional(),
  typography: writeTypographyPatchSchema.optional(),
  agentPresets: z.array(writeAgentPresetSchema).max(24).optional()
}).strict()

const terminalColorPatchSchema = z.object({
  colorMode: z.enum(['native', 'none', 'custom']).optional(),
  foreground: z.string().max(64).optional(),
  background: z.string().max(64).optional(),
  cursor: z.string().max(64).optional(),
  selectionBackground: z.string().max(64).optional(),
  black: z.string().max(64).optional(),
  red: z.string().max(64).optional(),
  green: z.string().max(64).optional(),
  yellow: z.string().max(64).optional(),
  blue: z.string().max(64).optional(),
  magenta: z.string().max(64).optional(),
  cyan: z.string().max(64).optional(),
  white: z.string().max(64).optional(),
  brightBlack: z.string().max(64).optional(),
  brightRed: z.string().max(64).optional(),
  brightGreen: z.string().max(64).optional(),
  brightYellow: z.string().max(64).optional(),
  brightBlue: z.string().max(64).optional(),
  brightMagenta: z.string().max(64).optional(),
  brightCyan: z.string().max(64).optional(),
  brightWhite: z.string().max(64).optional()
}).strict()

const terminalSettingsPatchSchema = z.object({
  colors: terminalColorPatchSchema.optional()
}).strict()

const clawSkillPatchSchema = z.object({
  defaultNames: z.array(trimmedString(128)).max(128).optional(),
  extraDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional(),
  disabledDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional(),
  promptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

const clawImPatchSchema = z.object({
  enabled: z.boolean().optional(),
  provider: clawImProviderSchema.optional(),
  port: z.number().int().min(MIN_KUN_LOCAL_PORT).max(65_535).optional(),
  path: trimmedString(MAX_PATH_LENGTH).optional(),
  secret: z.string().max(MAX_BODY_BYTES).optional(),
  weixinBridgeUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  openClawGatewayUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  providerId: z.string().trim().max(64).optional(),
  model: modelIdSchema.optional(),
  mode: clawRunModeSchema.optional(),
  responseTimeoutMs: z.number().int().min(5_000).max(600_000).optional()
}).strict()

const clawImAgentProfilePatchSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2_000).optional(),
  identity: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  personality: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  userContext: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  replyRules: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

const clawImPlatformCredentialPatchSchema = z.union([
  z.object({
    kind: z.literal('feishu').optional(),
    appId: z.string().max(512).optional(),
    appSecret: z.string().max(MAX_BODY_BYTES).optional(),
    domain: z.string().max(512).optional(),
    createdAt: z.string().max(128).optional()
  }).strict(),
  z.object({
    kind: z.literal('weixin'),
    accountId: z.string().max(512).optional(),
    sessionKey: z.string().max(MAX_BODY_BYTES).optional(),
    createdAt: z.string().max(128).optional()
  }).strict(),
  z.object({
    kind: z.literal('telegram'),
    botToken: z.string().max(MAX_BODY_BYTES).optional(),
    allowedChatIds: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    botUsername: z.string().trim().max(128).optional(),
    createdAt: z.string().max(128).optional()
  }).strict()
])

const clawImRemoteSessionPatchSchema = z.object({
  chatId: z.string().max(MAX_ID_LENGTH).optional(),
  messageId: z.string().max(MAX_ID_LENGTH).optional(),
  threadId: z.string().max(MAX_ID_LENGTH).optional(),
  senderId: z.string().max(MAX_ID_LENGTH).optional(),
  senderName: z.string().max(512).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const clawImConversationPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  chatId: z.string().max(MAX_ID_LENGTH).optional(),
  remoteThreadId: z.string().max(MAX_ID_LENGTH).optional(),
  latestMessageId: z.string().max(MAX_ID_LENGTH).optional(),
  senderId: z.string().max(MAX_ID_LENGTH).optional(),
  senderName: z.string().max(512).optional(),
  localThreadId: z.string().max(MAX_ID_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const clawImChannelPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  provider: clawImProviderSchema.optional(),
  label: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  providerId: z.string().trim().max(64).optional(),
  model: modelIdSchema.optional(),
  threadId: z.string().max(MAX_ID_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  agentProfile: clawImAgentProfilePatchSchema.optional(),
  platformCredential: clawImPlatformCredentialPatchSchema.optional(),
  remoteSession: clawImRemoteSessionPatchSchema.optional(),
  conversations: z.array(clawImConversationPatchSchema).max(512).optional(),
  welcomeSentAt: z.string().max(128).optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional(),
  feishuStream: z.boolean().optional()
}).strict()

const clawTaskSchedulePatchSchema = z.object({
  kind: clawScheduleKindSchema.optional(),
  everyMinutes: z.number().int().min(1).max(10_080).optional(),
  timeOfDay: z.string().max(16).optional(),
  atTime: z.string().max(128).optional()
}).strict()

const clawTaskPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  title: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  clawChannelId: z.string().trim().max(MAX_ID_LENGTH).optional(),
  providerId: z.string().trim().max(64).optional(),
  model: modelIdSchema.optional(),
  reasoningEffort: scheduleReasoningEffortSchema.optional(),
  mode: clawRunModeSchema.optional(),
  schedule: clawTaskSchedulePatchSchema.optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional(),
  lastRunAt: z.string().max(128).optional(),
  nextRunAt: z.string().max(128).optional(),
  lastStatus: clawTaskStatusSchema.optional(),
  lastMessage: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  lastThreadId: z.string().max(MAX_ID_LENGTH).optional()
}).strict()

const clawSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  skills: clawSkillPatchSchema.optional(),
  im: clawImPatchSchema.optional(),
  channels: z.array(clawImChannelPatchSchema).max(512).optional(),
  tasks: z.array(clawTaskPatchSchema).max(512).optional()
}).strict()

const scheduleSkillPatchSchema = z.object({
  defaultNames: z.array(trimmedString(128)).max(128).optional(),
  extraDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional(),
  disabledDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional()
}).strict()

const scheduleInternalPatchSchema = z.object({
  port: z.number().int().min(MIN_KUN_LOCAL_PORT).max(65_535).optional(),
  secret: z.string().max(MAX_BODY_BYTES).optional()
}).strict()

const scheduledTaskSchedulePatchSchema = z.object({
  kind: clawScheduleKindSchema.optional(),
  everyMinutes: z.number().int().min(1).max(10_080).optional(),
  timeOfDay: z.string().max(16).optional(),
  atTime: z.string().max(128).optional()
}).strict()

const scheduledTaskPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  title: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  clawChannelId: z.string().trim().max(MAX_ID_LENGTH).optional(),
  providerId: z.string().trim().max(64).optional(),
  model: modelIdSchema.optional(),
  reasoningEffort: scheduleReasoningEffortSchema.optional(),
  mode: clawRunModeSchema.optional(),
  priority: z.number().int().min(0).max(100).optional(),
  dependsOn: z.array(z.string().trim().min(1).max(MAX_ID_LENGTH)).max(32).optional(),
  useWorktree: z.boolean().optional(),
  schedule: scheduledTaskSchedulePatchSchema.optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional(),
  lastRunAt: z.string().max(128).optional(),
  nextRunAt: z.string().max(128).optional(),
  lastStatus: clawTaskStatusSchema.optional(),
  lastMessage: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  lastThreadId: z.string().max(MAX_ID_LENGTH).optional()
}).strict()

const scheduleSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  defaultWorkspaceRoot: defaultPathSchema,
  providerId: z.string().trim().max(64).optional(),
  model: z.union([z.enum(SCHEDULE_MODEL_IDS), modelIdSchema]).optional(),
  mode: clawRunModeSchema.optional(),
  promptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  skills: scheduleSkillPatchSchema.optional(),
  keepAwake: z.boolean().optional(),
  internal: scheduleInternalPatchSchema.optional(),
  tasks: z.array(scheduledTaskPatchSchema).max(512).optional()
}).strict()

// --- Workflow (node-based automation) ---

const workflowScheduleKindSchema = z.enum(['manual', 'interval', 'daily', 'at', 'cron'])
const workflowConditionOperatorSchema = z.enum([
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'gte',
  'lt',
  'lte'
])
const workflowHttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const workflowNodeRunStatusSchema = z.enum(['pending', 'running', 'success', 'error', 'skipped'])

const workflowPositionSchema = z
  .object({ x: z.number(), y: z.number() })
  .strict()

const workflowScheduleSchema = z
  .object({
    kind: workflowScheduleKindSchema.optional(),
    everyMinutes: z.number().int().min(1).max(10_080).optional(),
    timeOfDay: z.string().max(16).optional(),
    atTime: z.string().max(128).optional(),
    cron: z.string().max(256).optional()
  })
  .strict()

const workflowAiAgentConfigSchema = z
  .object({
    prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    workspaceRoot: defaultPathSchema,
    providerId: z.string().trim().max(64).optional(),
    model: optionalModelIdSchema,
    reasoningEffort: scheduleReasoningEffortSchema.optional(),
    mode: clawRunModeSchema.optional()
  })
  .strict()

const workflowGenerateImageConfigSchema = z
  .object({
    prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    providerId: z.string().max(MAX_ID_LENGTH).optional(),
    model: optionalModelIdSchema,
    size: z.string().max(32).optional(),
    outputDir: z.string().max(1024).optional()
  })
  .strict()

const workflowConditionConfigSchema = z
  .object({
    leftExpr: z.string().max(2_000).optional(),
    operator: workflowConditionOperatorSchema.optional(),
    rightValue: z.string().max(4_000).optional(),
    caseSensitive: z.boolean().optional()
  })
  .strict()

const workflowHttpHeaderSchema = z
  .object({
    key: z.string().max(256),
    value: z.string().max(4_000)
  })
  .strict()

const workflowHttpRequestConfigSchema = z
  .object({
    method: workflowHttpMethodSchema.optional(),
    url: z.string().max(MAX_URL_LENGTH).optional(),
    headers: z.array(workflowHttpHeaderSchema).max(50).optional(),
    body: z.string().max(MAX_BODY_BYTES).optional(),
    timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    parseJson: z.boolean().optional()
  })
  .strict()

const workflowDelayConfigSchema = z
  .object({ delayMs: z.number().int().min(0).max(86_400_000).optional() })
  .strict()

const workflowCustomConfigSchema = z
  .object({
    moduleId: z.string().max(MAX_ID_LENGTH).optional(),
    values: z.record(z.string(), z.string().max(MAX_BODY_BYTES)).optional()
  })
  .strict()

const workflowTemplateConfigSchema = z
  .object({
    template: z.string().max(MAX_BODY_BYTES).optional(),
    outputMode: z.enum(['text', 'json']).optional()
  })
  .strict()

const workflowJsonConfigSchema = z
  .object({
    mode: z.enum(['parse', 'stringify']).optional(),
    strict: z.boolean().optional()
  })
  .strict()

const workflowOutputConfigSchema = z
  .object({
    mode: z.enum(['auto', 'text', 'json']).optional(),
    textTemplate: z.string().max(MAX_BODY_BYTES).optional(),
    jsonPath: z.string().max(2_000).optional()
  })
  .strict()

const workflowFieldSchema = z
  .object({ key: z.string().max(256), value: z.string().max(MAX_BODY_BYTES) })
  .strict()

const workflowSetFieldsConfigSchema = z
  .object({
    fields: z.array(workflowFieldSchema).max(50).optional(),
    keepIncoming: z.boolean().optional(),
    scope: z.enum(['payload', 'run']).optional()
  })
  .strict()

const workflowSwitchRuleSchema = z
  .object({
    leftExpr: z.string().max(2_000),
    operator: workflowConditionOperatorSchema,
    rightValue: z.string().max(4_000),
    caseSensitive: z.boolean()
  })
  .partial()
  .strict()

const workflowSwitchConfigSchema = z
  .object({
    rules: z.array(workflowSwitchRuleSchema).max(20).optional(),
    fallback: z.boolean().optional()
  })
  .strict()

const workflowCodeConfigSchema = z
  .object({
    language: z.enum(['javascript', 'python', 'bash']).optional(),
    code: z.string().max(MAX_BODY_BYTES).optional()
  })
  .strict()

const workflowMergeConfigSchema = z.object({ mode: z.enum(['array', 'object']).optional() }).strict()

const workflowFilterConfigSchema = z
  .object({
    leftExpr: z.string().max(2_000).optional(),
    operator: workflowConditionOperatorSchema.optional(),
    rightValue: z.string().max(4_000).optional(),
    caseSensitive: z.boolean().optional()
  })
  .strict()

const workflowSortConfigSchema = z
  .object({
    field: z.string().max(256).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    numeric: z.boolean().optional()
  })
  .strict()

const workflowLimitConfigSchema = z
  .object({ count: z.number().int().min(1).max(100_000).optional(), from: z.enum(['first', 'last']).optional() })
  .strict()

const workflowAggregateConfigSchema = z
  .object({
    mode: z.enum(['count', 'sum', 'collect', 'join']).optional(),
    field: z.string().max(256).optional(),
    separator: z.string().max(32).optional()
  })
  .strict()

const workflowSubWorkflowConfigSchema = z
  .object({ workflowId: z.string().max(MAX_ID_LENGTH).optional() })
  .strict()

const workflowLoopConfigSchema = z
  .object({
    workflowId: z.string().max(MAX_ID_LENGTH).optional(),
    mode: z.enum(['condition', 'foreach']).optional(),
    arraySource: z.string().max(2_000).optional(),
    execution: z.enum(['sequential', 'parallel']).optional(),
    concurrency: z.number().int().min(1).max(8).optional(),
    continueOnError: z.boolean().optional(),
    maxIterations: z.number().int().min(1).max(100).optional(),
    leftExpr: z.string().max(2_000).optional(),
    operator: workflowConditionOperatorSchema.optional(),
    rightValue: z.string().max(4_000).optional(),
    caseSensitive: z.boolean().optional()
  })
  .strict()

const workflowWebhookTriggerConfigSchema = z
  .object({
    path: z.string().max(256).optional(),
    method: z.enum(['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    workspaceRoot: defaultPathSchema
  })
  .strict()

const workflowNodeBaseShape = {
  id: z.string().max(MAX_ID_LENGTH),
  name: z.string().max(512).optional(),
  position: workflowPositionSchema.optional(),
  disabled: z.boolean().optional(),
  onError: z.enum(['fail', 'continue', 'fallback']).optional(),
  retries: z.number().int().min(0).max(10).optional(),
  retryDelayMs: z.number().int().min(0).max(600_000).optional(),
  fallbackJson: z.string().max(MAX_BODY_BYTES).optional(),
  inputs: z
    .array(
      z
        .object({
          key: z.string().max(128),
          type: z.enum(['text', 'number', 'boolean', 'json']),
          source: z.string().max(4_000)
        })
        .strict()
    )
    .max(30)
    .optional()
}

const workflowInputFieldSchema = z
  .object({
    key: z.string().max(128),
    label: z.string().max(200).optional(),
    type: z.enum(['text', 'paragraph', 'number', 'boolean', 'select', 'json']).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().max(500)).max(50).optional(),
    defaultValue: z.string().max(MAX_BODY_BYTES).optional(),
    description: z.string().max(500).optional()
  })
  .strict()

const workflowParameterExtractorConfigSchema = z
  .object({
    source: z.string().max(MAX_BODY_BYTES).optional(),
    instruction: z.string().max(MAX_BODY_BYTES).optional(),
    fields: z.array(workflowInputFieldSchema).max(50).optional(),
    providerId: z.string().trim().max(64).optional(),
    model: optionalModelIdSchema,
    reasoningEffort: scheduleReasoningEffortSchema.optional()
  })
  .strict()

const workflowQuestionClassifierConfigSchema = z
  .object({
    source: z.string().max(MAX_BODY_BYTES).optional(),
    instruction: z.string().max(MAX_BODY_BYTES).optional(),
    categories: z
      .array(z.object({ id: z.string().max(64).optional(), label: z.string().max(200).optional() }).strict())
      .max(20)
      .optional(),
    providerId: z.string().trim().max(64).optional(),
    model: optionalModelIdSchema,
    reasoningEffort: scheduleReasoningEffortSchema.optional()
  })
  .strict()

const workflowHumanApprovalConfigSchema = z
  .object({
    title: z.string().max(200).optional(),
    instruction: z.string().max(MAX_BODY_BYTES).optional(),
    timeoutMs: z.number().int().min(0).max(86_400_000).optional(),
    onTimeout: z.enum(['approved', 'rejected']).optional()
  })
  .strict()

const workflowNodePatchSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...workflowNodeBaseShape,
      type: z.literal('manual-trigger'),
      config: z
        .object({
          workspaceRoot: defaultPathSchema,
          inputSchema: z.array(workflowInputFieldSchema).max(50).optional()
        })
        .strict()
        .optional()
    })
    .strict(),
  z
    .object({
      ...workflowNodeBaseShape,
      type: z.literal('schedule-trigger'),
      config: z
        .object({ schedule: workflowScheduleSchema.optional(), workspaceRoot: defaultPathSchema })
        .strict()
        .optional()
    })
    .strict(),
  z
    .object({
      ...workflowNodeBaseShape,
      type: z.literal('webhook-trigger'),
      config: workflowWebhookTriggerConfigSchema.optional()
    })
    .strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('ai-agent'), config: workflowAiAgentConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('generate-image'), config: workflowGenerateImageConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('condition'), config: workflowConditionConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('switch'), config: workflowSwitchConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('filter'), config: workflowFilterConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('set-fields'), config: workflowSetFieldsConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('code'), config: workflowCodeConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('sort'), config: workflowSortConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('limit'), config: workflowLimitConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('aggregate'), config: workflowAggregateConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('http-request'), config: workflowHttpRequestConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('merge'), config: workflowMergeConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('subworkflow'), config: workflowSubWorkflowConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('loop'), config: workflowLoopConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('delay'), config: workflowDelayConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('template'), config: workflowTemplateConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('json'), config: workflowJsonConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('output'), config: workflowOutputConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('parameter-extractor'), config: workflowParameterExtractorConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('question-classifier'), config: workflowQuestionClassifierConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('human-approval'), config: workflowHumanApprovalConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('custom'), config: workflowCustomConfigSchema.optional() }).strict()
])

const workflowConnectionPatchSchema = z
  .object({
    id: z.string().max(MAX_ID_LENGTH).optional(),
    source: z.string().max(MAX_ID_LENGTH),
    sourceHandle: z.string().max(64).optional(),
    target: z.string().max(MAX_ID_LENGTH),
    targetHandle: z.string().max(64).optional()
  })
  .strict()

const workflowNodeResultPatchSchema = z
  .object({
    nodeId: z.string().max(MAX_ID_LENGTH).optional(),
    status: workflowNodeRunStatusSchema.optional(),
    startedAt: z.string().max(128).optional(),
    finishedAt: z.string().max(128).optional(),
    message: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    outputJson: z.string().max(MAX_BODY_BYTES).optional(),
    inputJson: z.string().max(MAX_BODY_BYTES).optional(),
    retries: z.number().int().min(0).max(100).optional(),
    threadId: z.string().max(MAX_ID_LENGTH).optional(),
    error: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
  })
  .strict()

const workflowRunPatchSchema = z
  .object({
    id: z.string().max(MAX_ID_LENGTH).optional(),
    trigger: z.string().max(128).optional(),
    status: clawTaskStatusSchema.optional(),
    startedAt: z.string().max(128).optional(),
    finishedAt: z.string().max(128).optional(),
    message: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    nodeResults: z.array(workflowNodeResultPatchSchema).max(200).optional()
  })
  .strict()

const workflowPatchSchema = z
  .object({
    id: z.string().max(MAX_ID_LENGTH).optional(),
    name: z.string().max(512).optional(),
    enabled: z.boolean().optional(),
    callableByAgent: z.boolean().optional(),
    env: z
      .array(
        z
          .object({
            key: z.string().max(128),
            value: z.string().max(MAX_BODY_BYTES),
            type: z.enum(['string', 'number', 'boolean', 'secret'])
          })
          .strict()
      )
      .max(100)
      .optional(),
    nodes: z.array(workflowNodePatchSchema).max(200).optional(),
    connections: z.array(workflowConnectionPatchSchema).max(512).optional(),
    createdAt: z.string().max(128).optional(),
    updatedAt: z.string().max(128).optional(),
    lastRunAt: z.string().max(128).optional(),
    nextRunAt: z.string().max(128).optional(),
    lastStatus: clawTaskStatusSchema.optional(),
    lastMessage: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    runs: z.array(workflowRunPatchSchema).max(50).optional()
  })
  .strict()

const workflowModuleFieldSchema = z
  .object({
    key: z.string().max(128),
    label: z.string().max(200).optional(),
    type: z.enum(['text', 'textarea', 'number', 'boolean', 'select']).optional(),
    defaultValue: z.string().max(MAX_BODY_BYTES).optional(),
    options: z.array(z.string().max(200)).max(50).optional(),
    placeholder: z.string().max(200).optional()
  })
  .strict()

const workflowCustomModuleSchema = z
  .object({
    id: z.string().max(MAX_ID_LENGTH),
    name: z.string().max(200).optional(),
    description: z.string().max(2_000).optional(),
    icon: z.string().max(64).optional(),
    language: z.enum(['javascript', 'python', 'bash']).optional(),
    fields: z.array(workflowModuleFieldSchema).max(50).optional(),
    code: z.string().max(MAX_BODY_BYTES).optional()
  })
  .strict()

// Lenient: nodeType / config are re-validated per kind by normalizeNodePreset.
const workflowNodePresetSchema = z
  .object({
    id: z.string().max(MAX_ID_LENGTH),
    label: z.string().max(200),
    icon: z.string().max(64).optional(),
    nodeType: z.string().max(64),
    nodeName: z.string().max(200).optional(),
    config: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

const workflowSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultWorkspaceRoot: defaultPathSchema,
    providerId: z.string().trim().max(64).optional(),
    model: optionalModelIdSchema,
    mode: clawRunModeSchema.optional(),
    keepAwake: z.boolean().optional(),
    webhookPort: z.number().int().min(MIN_KUN_LOCAL_PORT).max(65_535).optional(),
    webhookSecret: z.string().max(MAX_BODY_BYTES).optional(),
    workflows: z.array(workflowPatchSchema).max(200).optional(),
    presets: z.array(workflowNodePresetSchema).max(100).optional(),
    modules: z.array(workflowCustomModuleSchema).max(100).optional(),
    hookTriggers: z
      .array(
        z
          .object({
            id: z.string().max(MAX_ID_LENGTH).optional(),
            enabled: z.boolean().optional(),
            workflowId: z.string().max(MAX_ID_LENGTH).optional(),
            phase: z.enum(['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'TurnStart', 'TurnEnd', 'PreCompact']).optional(),
            toolNames: z.array(z.string().max(128)).max(50).optional(),
            mode: z.enum(['observe', 'block', 'rewrite']).optional(),
            timeoutMs: z.number().int().min(0).max(3_600_000).optional()
          })
          .strict()
      )
      .max(50)
      .optional()
  })
  .strict()

export const workflowRunNodePayloadSchema = z
  .object({
    workflowId: trimmedString(MAX_ID_LENGTH),
    nodeId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const workflowTestNodePayloadSchema = z
  .object({
    workflowId: trimmedString(MAX_ID_LENGTH),
    nodeId: trimmedString(MAX_ID_LENGTH),
    mockJson: z.string().max(MAX_BODY_BYTES)
  })
  .strict()

export const workflowResolveApprovalPayloadSchema = z
  .object({
    token: trimmedString(MAX_ID_LENGTH),
    decision: z.enum(['approved', 'rejected'])
  })
  .strict()

export const workflowCodeCheckPayloadSchema = z
  .object({
    language: z.enum(['javascript', 'python', 'bash']),
    code: z.string().max(MAX_BODY_BYTES)
  })
  .strict()
const designSettingsPatchSchema = z.object({
  defaultWorkspaceRoot: defaultPathSchema,
  brandColor: z.string().trim().max(32).optional(),
  tone: z.array(trimmedString(32)).max(12).optional(),
  designSystemPreset: z
    .enum([
      'none', 'shadcn', 'radix', 'material', 'ios', 'fluent', 'ant',
      'chakra', 'carbon', 'polaris', 'bootstrap', 'geist', 'brutalism', 'editorial'
    ])
    .optional(),
  designType: z.enum(['', 'brand', 'product']).optional(),
  designGuidelines: z.string().max(4000).optional(),
  radius: z.enum(['', 'sharp', 'soft', 'rounded', 'pill']).optional(),
  density: z.enum(['', 'compact', 'cozy', 'spacious']).optional(),
  fontStyle: z.enum(['', 'system', 'geometric', 'humanist', 'serif', 'mono']).optional(),
  model: z.string().trim().max(128).optional(),
  providerId: z.string().trim().max(128).optional(),
  reasoningEffort: z.string().trim().max(32).optional(),
  generationPrompt: z.string().max(6000).optional(),
  implementStackHint: z.string().trim().max(200).optional(),
  injectIntoCode: z.boolean().optional(),
  publishDesignSystem: z.boolean().optional(),
  defaultViewport: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  defaultCanvasView: z.enum(['preview', 'code']).optional(),
  canvasBackground: z.enum(['light', 'dark']).optional(),
  liveRefresh: z.boolean().optional(),
  deviceFrame: z.boolean().optional()
}).strict()

function stripLegacySettingsPatchKeys(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload
  const source = payload as Record<string, unknown>
  const next: Record<string, unknown> = { ...source }

  delete next.agentProvider
  delete next.deepseek
  delete next.reasonix
  delete next.quickChat

  if (typeof next.agents === 'object' && next.agents !== null && !Array.isArray(next.agents)) {
    const agents = { ...(next.agents as Record<string, unknown>) }
    delete agents.codewhale
    delete agents.reasonix
    delete agents.quickChat
    next.agents = agents
  }

  return next
}

const settingsPatchObjectSchema = z.object({
  version: z.literal(1).optional(),
  locale: localeSchema.optional(),
  theme: themeSchema.optional(),
  uiFontScale: uiFontScaleSchema.optional(),
  chatContentMaxWidthPx: chatContentMaxWidthSchema.optional(),
  cursorSpotlight: z.boolean().optional(),
  cursorSpotlightColor: hexColorSchema.optional(),
  provider: modelProviderPatchSchema.optional(),
  agents: z.object({
    kun: kunRuntimePatchSchema.optional()
  }).strict().optional(),
  workspaceRoot: defaultPathSchema,
  conversationWorkspaceRoot: defaultPathSchema,
  log: logPatchSchema.optional(),
  checkpointCleanup: checkpointCleanupPatchSchema.optional(),
  notifications: notificationsPatchSchema.optional(),
  appBehavior: appBehaviorPatchSchema.optional(),
  keyboardShortcuts: keyboardShortcutsPatchSchema.optional(),
  write: writeSettingsPatchSchema.optional(),
  claw: clawSettingsPatchSchema.optional(),
  schedule: scheduleSettingsPatchSchema.optional(),
  workflow: workflowSettingsPatchSchema.optional(),
  design: designSettingsPatchSchema.optional(),
  terminal: terminalSettingsPatchSchema.optional(),
  guiUpdate: z.object({
    channel: z.enum(GUI_UPDATE_CHANNELS).optional()
  }).strict().optional(),
  codePromptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  disabledSkillIds: z.array(trimmedString(128)).max(512).optional()
}).strict()

export const settingsPatchSchema = z.preprocess(stripLegacySettingsPatchKeys, settingsPatchObjectSchema)

export const skillSaveFilePayloadSchema = z
  .object({
    rootPath: trimmedString(MAX_PATH_LENGTH),
    skillName: trimmedString(128),
    content: z.string().max(MAX_SKILL_FILE_BYTES),
    manifestContent: z.string().max(MAX_SKILL_FILE_BYTES).optional()
  })
  .strict()

export const skillGithubImportPayloadSchema = z
  .object({
    rootPath: trimmedString(MAX_PATH_LENGTH),
    // Defense-in-depth: reject any explicit non-https scheme at the IPC
    // boundary (http/file/javascript/data/etc.). Scheme-less input is allowed
    // because the importer normalizes it to https before parsing; only the
    // host-check inside `importSkillsFromGitHub` is authoritative, but barring
    // dangerous schemes here narrows what ever reaches the importer.
    url: z
      .string()
      .trim()
      .min(1)
      .max(MAX_URL_LENGTH)
      .refine((value) => !/^[a-z][a-z0-9+.-]*:/i.test(value) || /^https:\/\//i.test(value), {
        message: 'GitHub skill import URL must use https.'
      })
  })
  .strict()

export const skillListPayloadSchema = z
  .object({
    workspaceRoot: z.string().trim().max(MAX_PATH_LENGTH).optional()
  })
  .strict()

export const rootPathSchema = trimmedString(MAX_PATH_LENGTH)
export const localPdfTextTargetPayloadSchema = z
  .object({
    path: rootPathSchema
  })
  .strict()
export const deepseekConfigContentSchema = z.string().max(MAX_CONFIG_FILE_BYTES)

export const workspaceRootSchema = trimmedString(MAX_PATH_LENGTH)
export const gitBranchPayloadSchema = z
  .object({
    workspaceRoot: workspaceRootSchema,
    branch: trimmedString(MAX_BRANCH_LENGTH)
  })
  .strict()

export const gitCheckpointCreatePayloadSchema = z
  .object({
    workspaceRoot: workspaceRootSchema,
    threadId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const gitCheckpointRestorePayloadSchema = z
  .object({
    checkpointId: trimmedString(MAX_ID_LENGTH * 4)
  })
  .strict()

export const worktreeOptionalRootSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH),
  poolIndex: z.number().int().min(0).max(2),
  taskId: trimmedString(MAX_BRANCH_LENGTH),
  force: z.boolean().optional(),
  worktreeRoot: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreePoolSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH),
  worktreeRoot: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreePoolIndexSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH),
  poolIndex: z.number().int().min(0).max(2),
  worktreeRoot: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreeMergeSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH),
  poolIndex: z.number().int().min(0).max(2),
  commitMessage: optionalTrimmedString(4_000),
  worktreeRoot: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreePathSchema = z.object({
  worktreePath: trimmedString(MAX_PATH_LENGTH)
}).strict()

export const gitWorktreeRemoveSchema = z.object({
  workspaceRoot: workspaceRootSchema,
  worktreePath: trimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreeProjectPathSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH)
}).strict()

export const worktreeContinueMergeSchema = z.object({
  projectPath: trimmedString(MAX_PATH_LENGTH),
  message: optionalTrimmedString(4_000)
}).strict()

export const worktreeCommitSchema = z.object({
  worktreePath: trimmedString(MAX_PATH_LENGTH),
  message: trimmedString(4_000)
}).strict()

export const openEditorPathPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    editorId: optionalTrimmedString(MAX_EDITOR_ID_LENGTH),
    line: z.number().int().positive().max(1_000_000).optional(),
    column: z.number().int().positive().max(1_000_000).optional()
  })
  .strict()

export const workspaceFileTargetPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    line: z.number().int().positive().max(1_000_000).optional(),
    column: z.number().int().positive().max(1_000_000).optional()
  })
  .strict()

export const workspaceDirectoryTargetPayloadSchema = z
  .object({
    path: optionalTrimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceFileWritePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES)
  })
  .strict()

export const workspaceFileSaveAsPayloadSchema = z
  .object({
    suggestedName: optionalTrimmedString(255),
    sourcePath: optionalTrimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    dataBase64: z.string().max(MAX_SAVE_FILE_BASE64_BYTES).optional(),
    mimeType: optionalTrimmedString(255)
  })
  .strict()
  .refine((payload) => Boolean(payload.sourcePath || payload.dataBase64), {
    message: 'Either sourcePath or dataBase64 is required.'
  })

export const workspaceFileCreatePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES).optional()
  })
  .strict()

export const workspaceDirectoryCreatePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceClipboardImageSavePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    currentFilePath: trimmedString(MAX_PATH_LENGTH),
    imageDirectory: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceImagePickPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    currentFilePath: optionalTrimmedString(MAX_PATH_LENGTH),
    imageDirectory: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceImageBytesSavePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    dataBase64: z.string().max(MAX_SAVE_FILE_BASE64_BYTES),
    mimeType: optionalTrimmedString(255),
    imageDirectory: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceEntryRenamePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    newName: trimmedString(255)
  })
  .strict()

export const workspaceEntryDeletePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceFileWatchPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const writeRetrievalPayloadSchema = z
  .object({
    workspaceRoot: defaultPathSchema,
    currentFilePath: defaultPathSchema,
    query: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    maxSnippets: z.number().int().min(1).max(8).optional(),
    includeCurrentFile: z.boolean().optional()
  })
  .strict()

export const writeExportPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    format: z.enum(WRITE_EXPORT_FORMATS),
    content: z.string().max(MAX_BODY_BYTES)
  })
  .strict()

export const designExportPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    format: z.enum(['html', 'pdf']),
    filename: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const writeRichClipboardPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES)
  })
  .strict()

const writeInlineEditRecentEditSchema = z
  .object({
    source: z.enum(['user', 'inline-edit']),
    ageMs: z.number().int().min(0).max(24 * 60 * 60 * 1_000),
    filePath: optionalTrimmedString(MAX_PATH_LENGTH),
    from: z.number().int().min(0).max(MAX_BODY_BYTES),
    to: z.number().int().min(0).max(MAX_BODY_BYTES),
    deletedText: z.string().max(8_000),
    insertedText: z.string().max(8_000),
    beforeContext: z.string().max(4_000),
    afterContext: z.string().max(4_000),
    instruction: z.string().trim().min(1).max(10_000).optional(),
    scopeKind: z.enum(['selection', 'paragraph']).optional()
  })
  .strict()
  .refine((edit) => edit.to >= edit.from, {
    message: 'Recent edit end must be greater than or equal to start.'
  })

const writeInlineCompletionEditCandidateSchema = z
  .object({
    kind: z.enum(['selection', 'paragraph']),
    from: z.number().int().min(0).max(MAX_BODY_BYTES),
    to: z.number().int().min(0).max(MAX_BODY_BYTES),
    startLine: z.number().int().positive().max(1_000_000),
    startColumn: z.number().int().positive().max(1_000_000),
    endLine: z.number().int().positive().max(1_000_000),
    endColumn: z.number().int().positive().max(1_000_000),
    original: z.string().max(MAX_EDITOR_COMPLETION_TEXT),
    selectedText: z.string().max(50_000).optional()
  })
  .strict()
  .refine((scope) => scope.to >= scope.from, {
    message: 'Completion edit candidate end must be greater than or equal to start.'
  })

export const writeInlineCompletionPayloadSchema = z
  .object({
    prefix: z.string().max(MAX_EDITOR_COMPLETION_TEXT),
    suffix: z.string().max(MAX_EDITOR_COMPLETION_TEXT),
    mode: z.enum(['short', 'long', 'edit']).optional(),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    currentFilePath: optionalTrimmedString(MAX_PATH_LENGTH),
    cursor: z
      .object({
        line: z.number().int().positive().max(1_000_000),
        column: z.number().int().min(0).max(1_000_000)
      })
      .strict(),
    context: z
      .object({
        language: trimmedString(64),
        currentLinePrefix: z.string().max(20_000),
        currentLineSuffix: z.string().max(20_000),
        previousLine: z.string().max(20_000),
        previousNonEmptyLine: z.string().max(20_000),
        nextLine: z.string().max(20_000),
        indentation: z.string().max(2_000),
        signals: z
          .object({
            list: z.boolean(),
            quote: z.boolean(),
            heading: z.boolean(),
            table: z.boolean(),
            atLineEnd: z.boolean(),
            endsWithSentencePunctuation: z.boolean(),
            previousLineEndsWithSentencePunctuation: z.boolean(),
            prefersNewLineCompletion: z.boolean(),
            paragraphBreakOpportunity: z.boolean()
          })
          .strict()
      })
      .strict(),
    policy: z
      .object({
        name: trimmedString(128),
        instruction: z.string().max(50_000),
        acceptanceCriteria: z.array(z.string().max(5_000)).max(12),
        rejectionCriteria: z.array(z.string().max(5_000)).max(12)
      })
      .strict(),
    preview: z
      .object({
        local: z.string().max(5_000),
        documentTail: z.string().max(20_000)
      })
      .strict(),
    editCandidate: writeInlineCompletionEditCandidateSchema.optional(),
    recentEdits: z.array(writeInlineEditRecentEditSchema).max(12).optional(),
    model: optionalModelIdSchema
  })
  .strict()

export const writeInfographicPayloadSchema = z
  .object({
    text: trimmedString(WRITE_INFOGRAPHIC_MAX_TEXT_CHARS),
    filePath: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    imageDir: optionalTrimmedString(MAX_PATH_LENGTH),
    kind: z.enum(['infographic', 'design']).optional(),
    referenceImagePath: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const writePrototypeFilePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const speechTranscribePayloadSchema = z
  .object({
    audioBase64: z.string().min(1).max(SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS),
    mimeType: trimmedString(64),
    durationMs: z.number().int().positive().max(SPEECH_TRANSCRIPTION_MAX_DURATION_MS).optional(),
    speechToText: speechToTextSettingsSchema.optional()
  })
  .strict()

export const localWhisperModelIdPayloadSchema = localWhisperModelIdSchema.optional()
export const localWhisperDownloadPayloadSchema = z
  .object({
    modelId: localWhisperModelIdSchema.optional(),
    sourceId: localWhisperDownloadSourceSchema.optional()
  })
  .strict()
export const localWhisperSourceStatusPayloadSchema = z
  .object({
    modelId: localWhisperModelIdSchema.optional()
  })
  .strict()

export const shellOpenExternalUrlSchema = trimmedString(MAX_URL_LENGTH).refine(
  isSafeOpenExternalUrl,
  { message: 'Only http, https, and mailto URLs are allowed.' }
)

export const notificationPayloadSchema = z
  .object({
    threadId: optionalTrimmedString(MAX_ID_LENGTH),
    title: trimmedString(MAX_NOTIFICATION_TITLE_LENGTH),
    body: trimmedString(MAX_NOTIFICATION_BODY_LENGTH)
  })
  .strict()

export const guiUpdateChannelSchema = z.enum(GUI_UPDATE_CHANNELS).optional()

export const desktopCommandSchema = z.enum(DESKTOP_COMMANDS)

export const computerUsePermissionKindSchema = z.enum(['accessibility', 'screenRecording'])


export const logErrorPayloadSchema = z
  .object({
    category: trimmedString(128),
    message: trimmedString(2_000),
    detail: z.unknown().optional()
  })
  .strict()

export const clawMirrorPayloadSchema = z
  .object({
    threadId: trimmedString(MAX_ID_LENGTH),
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    direction: z.enum(['user', 'assistant'])
  })
  .strict()

export const clawTaskFromTextPayloadSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    channelId: z.string().trim().min(1).max(MAX_ID_LENGTH).nullable().optional(),
    providerId: z.string().trim().max(64).nullable().optional(),
    modelHint: modelIdSchema.nullable().optional(),
    reasoningEffort: scheduleReasoningEffortSchema.nullable().optional(),
    mode: z.enum(['agent', 'plan']).nullable().optional()
  })
  .strict()

export const scheduleTaskFromTextPayloadSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    workspaceRoot: defaultPathSchema,
    clawChannelId: z.string().trim().min(1).max(MAX_ID_LENGTH).nullable().optional(),
    providerId: z.string().trim().max(64).nullable().optional(),
    modelHint: modelIdSchema.nullable().optional(),
    reasoningEffort: scheduleReasoningEffortSchema.nullable().optional(),
    mode: z.enum(['agent', 'plan']).nullable().optional()
  })
  .strict()

export const clawImInstallPollPayloadSchema = z
  .object({
    provider: clawImProviderSchema,
    deviceCode: trimmedString(MAX_DEVICE_CODE_LENGTH)
  })
  .strict()

export const clawImTelegramTokenPayloadSchema = z
  .object({
    botToken: z.string().trim().min(1),
    allowedChatIds: z.string().trim().optional().default('')
  })
  .strict()

export const sseStartPayloadSchema = z
  .object({
    threadId: trimmedString(MAX_ID_LENGTH),
    sinceSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    streamId: optionalTrimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const streamIdSchema = trimmedString(MAX_ID_LENGTH)

export const uiPluginIdPayloadSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,39}$/)
  })
  .strict()

export const terminalSessionIdSchema = trimmedString(TERMINAL_MAX_SESSION_ID_LENGTH)

export const terminalCreatePayloadSchema = z
  .object({
    sessionId: trimmedString(TERMINAL_MAX_SESSION_ID_LENGTH),
    cwd: optionalTrimmedString(TERMINAL_MAX_CWD_LENGTH),
    cols: z.number().int().min(1).max(TERMINAL_MAX_COLS).optional(),
    rows: z.number().int().min(1).max(TERMINAL_MAX_ROWS).optional()
  })
  .strict()

export const terminalWritePayloadSchema = z
  .object({
    sessionId: trimmedString(TERMINAL_MAX_SESSION_ID_LENGTH),
    data: z.string().min(1).max(TERMINAL_MAX_DATA_WRITE_BYTES)
  })
  .strict()

export const terminalResizePayloadSchema = z
  .object({
    sessionId: trimmedString(TERMINAL_MAX_SESSION_ID_LENGTH),
    cols: z.number().int().min(1).max(TERMINAL_MAX_COLS).default(TERMINAL_DEFAULT_COLS),
    rows: z.number().int().min(1).max(TERMINAL_MAX_ROWS).default(TERMINAL_DEFAULT_ROWS)
  })
  .strict()
