import type { AppLocale } from './app-locales'
import type { GuiUpdateChannel } from './gui-update'
import type { KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import type { LocalWhisperDownloadSourceId } from './local-whisper'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../../kun/src/contracts/policy.js'
import type { ComputerUseMode } from '../../kun/src/contracts/capabilities.js'
import type { BrowserUseMode } from './browser-use'
import type { ModelEndpointFormat } from '../../kun/src/contracts/model-endpoint-format.js'
import type { ToolOutputLimitsConfig } from '../../kun/src/contracts/tool-output-limits.js'

import {
  KunBrowserUseSettingsV1,
  KunComputerUseSettingsV1,
  KunDesignQualitySettingsV1,
  KunFastContextSettingsV1,
  KunGraphSettingsPatchV1,
  KunInstructionSettingsV1,
  KunLabSettingsPatchV1,
  KunPlanExecutionSettingsV1,
  KunRuntimeSettingsV1,
  KunSubagentsSettingsPatchV1
} from './app-settings-types-kun-runtime'
import {
  CheckpointCleanupIntervalDays,
  ImageGenerationProtocol,
  ImageGenerationQuality,
  ImageGenerationResolution,
  ModelProviderModelProfilePatchV1,
  MusicGenerationProtocol,
  ScheduleKind,
  ScheduleReasoningEffort,
  ScheduleRunMode,
  ScheduleTaskStatus,
  SpeechToTextProtocol,
  TextToSpeechProtocol,
  VideoGenerationProtocol
} from './app-settings-types-provider'

export type KunImageGenerationSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for image generation. Empty or "custom" uses the fields below. */
  providerId: string
  /** Request protocol used when providerId is custom. Provider presets override this with their image capability. */
  protocol: ImageGenerationProtocol
  /** Custom image API root, or an override for the selected provider image API root. */
  baseUrl: string
  /** Custom image API key override. Empty inherits the selected provider API key when providerId is set. */
  apiKey: string
  /** Read-only renderer projection; never contains the API key itself. */
  apiKeyConfigured?: boolean
  model: string
  /** Default resolution tier used when the model does not explicitly request one. */
  defaultResolution: ImageGenerationResolution
  /** Optional custom "WxH" override used when the model omits a resolution. Empty uses defaultResolution. */
  defaultSize: string
  /** Provider quality/precision hint. "auto" lets the provider decide. */
  quality: ImageGenerationQuality
  timeoutMs: number
}

export type KunSpeechToTextSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for speech recognition. Empty or "custom" uses the fields below. */
  providerId: string
  /** Request protocol used when providerId is custom. Provider presets override this with their speech capability. */
  protocol: SpeechToTextProtocol
  /** Custom speech API root, or an override for the selected provider speech API root. */
  baseUrl: string
  /** Custom speech API key override. Empty inherits the selected provider API key when providerId is set. */
  apiKey: string
  /** Read-only renderer projection; never contains the API key itself. */
  apiKeyConfigured?: boolean
  model: string
  /** Download source used when protocol is local-whisper. */
  localWhisperDownloadSource: LocalWhisperDownloadSourceId
  /** Language hint sent to the provider ("zh", "en", ...). Empty means auto-detect. */
  language: string
  timeoutMs: number
}

export type KunTextToSpeechSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for speech generation. Empty or "custom" uses the fields below. */
  providerId: string
  /** Request protocol used when providerId is custom. Provider presets override this with their TTS capability. */
  protocol: TextToSpeechProtocol
  /** Custom TTS API root, or an override for the selected provider TTS API root. */
  baseUrl: string
  /** Custom TTS API key override. Empty inherits the selected provider API key when providerId is set. */
  apiKey: string
  /** Read-only renderer projection; never contains the API key itself. */
  apiKeyConfigured?: boolean
  model: string
  /** Provider voice id/name. Empty means provider default. */
  voice: string
  /** Default output audio format such as mp3 or wav. */
  format: string
  timeoutMs: number
}

export type KunPromptOptimizationSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use. Empty means inherit the active Kun provider. */
  providerId: string
  /** Empty means smallModel || main conversation model. */
  model: string
  /** Empty means use DEFAULT_PROMPT_OPTIMIZATION_PROMPT. */
  prompt: string
  timeoutMs: number
}

export type KunMusicGenerationSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for music generation. Empty or "custom" uses the fields below. */
  providerId: string
  protocol: MusicGenerationProtocol
  baseUrl: string
  apiKey: string
  /** Read-only renderer projection; never contains the API key itself. */
  apiKeyConfigured?: boolean
  model: string
  /** Default output audio format such as mp3 or wav. */
  format: string
  timeoutMs: number
}

export type KunVideoGenerationSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for video generation. Empty or "custom" uses the fields below. */
  providerId: string
  protocol: VideoGenerationProtocol
  baseUrl: string
  apiKey: string
  /** Read-only renderer projection; never contains the API key itself. */
  apiKeyConfigured?: boolean
  model: string
  /** Default video duration in seconds. */
  defaultDuration: number
  /** Default provider resolution value, e.g. 1080P. */
  defaultResolution: string
  timeoutMs: number
  pollIntervalMs: number
}

export type KunMcpSearchMode = 'direct' | 'search' | 'auto'

export type KunMcpSearchSettingsV1 = {
  enabled: boolean
  mode: KunMcpSearchMode
  autoThresholdToolCount: number
  topKDefault: number
  topKMax: number
  minScore: number
}

export type KunProjectConfigGrantV1 = {
  /** Canonical real workspace path. Project files never persist this grant. */
  workspaceRoot: string
  /** SHA-256 of the normalized versioned `.kun/project.json` document. */
  configDigest: string
}

export type KunProjectConfigSettingsV1 = {
  grants: KunProjectConfigGrantV1[]
}

export type KunStorageBackend = 'hybrid' | 'file'

export type KunStorageSettingsV1 = {
  backend: KunStorageBackend
  sqlitePath: string
}

export type KunCompactionSummaryMode = 'heuristic' | 'model'

export type KunHistoryHygieneSettingsV1 = {
  maxToolResultLines: number
  maxToolResultBytes: number
  maxToolResultTokens: number
  maxToolArgumentStringBytes: number
  maxToolArgumentStringTokens: number
  maxArrayItems: number
}

export type KunTokenEconomySettingsV1 = {
  enabled: boolean
  compressToolDescriptions: boolean
  compressToolResults: boolean
  conciseResponses: boolean
  historyHygiene: KunHistoryHygieneSettingsV1
}

export type KunToolOutputLimitsSettingsV1 = Required<ToolOutputLimitsConfig>

export type KunContextCompactionSettingsV1 = {
  /** Tracks one-time migrations when the product's context-window defaults change. */
  defaultsVersion?: number
  defaultSoftThreshold: number
  defaultHardThreshold: number
  summaryMode: KunCompactionSummaryMode
  summaryTimeoutMs: number
  summaryMaxTokens: number
  summaryInputMaxBytes: number
  /** Optional model override for context compaction (empty = follow default model). */
  summaryModel?: string
  /** Provider id paired with summaryModel for per-provider routing. */
  summaryProviderId?: string
}

export type KunToolStormSettingsV1 = {
  enabled: boolean
}

export type KunToolArgumentRepairSettingsV1 = {
  maxStringBytes: number
}

export type KunInterruptedTurnResumeSettingsV1 = {
  /**
   * Auto-resume ordinary threads (no active goal) whose turn was interrupted
   * by a runtime restart or host shutdown. Defaults to true.
   */
  enabled: boolean
}

export type KunRuntimeTuningSettingsV1 = {
  /** Tracks one-time migrations when runtime tuning defaults change. */
  defaultsVersion: number
  /** Global admission cap for concurrently active turns in one Kun runtime. */
  maxConcurrentTurns: number
  /**
   * 单轮代理任务的总运行时长上限（毫秒），包含模型响应和工具执行。
   */
  maxWallTimeMs: number
  /**
   * Max idle gap (ms) between streaming chunks before a turn fails with
   * `stream_idle_timeout`. `0` disables the guard — useful for local LLM
   * servers that stay silent while prefilling a very large prompt.
   */
  streamIdleTimeoutMs: number
  toolStorm: KunToolStormSettingsV1
  toolArgumentRepair: KunToolArgumentRepairSettingsV1
  interruptedTurnResume: KunInterruptedTurnResumeSettingsV1
}

export type KunLlmDebugSettingsV1 = {
  /** Initial Agent Perspective capture state for newly created conversations. */
  defaultThreadCaptureEnabled: boolean
}

/**
 * Compatibility shell kept because persisted settings still use the
 * `agents.kun` envelope. Prefer operating on the contained
 * `KunRuntimeSettingsV1` directly in new code.
 */
export type KunSettingsEnvelopeV1 = {
  kun: KunRuntimeSettingsV1
}

/** @deprecated Use `KunSettingsEnvelopeV1`. */
export type AgentRuntimeSettingsMapV1 = KunSettingsEnvelopeV1

export type KunRuntimeTuningSettingsPatchV1 = {
  defaultsVersion?: number
  maxConcurrentTurns?: number
  maxWallTimeMs?: number
  streamIdleTimeoutMs?: number
  toolStorm?: Partial<KunToolStormSettingsV1>
  toolArgumentRepair?: Partial<KunToolArgumentRepairSettingsV1>
  interruptedTurnResume?: Partial<KunInterruptedTurnResumeSettingsV1>
}

export type KunTokenEconomySettingsPatchV1 = Partial<
  Omit<KunTokenEconomySettingsV1, 'historyHygiene'>
> & {
  historyHygiene?: Partial<KunHistoryHygieneSettingsV1>
}

export type KunRuntimeSettingsPatchV1 = Partial<
  Omit<
    KunRuntimeSettingsV1,
    'mcpSearch' | 'projectConfig' | 'storage' | 'contextCompaction' | 'runtimeTuning' | 'llmDebug' | 'tokenEconomy' | 'toolOutputLimits' | 'imageGeneration' | 'speechToText' | 'textToSpeech' | 'promptOptimization' | 'musicGeneration' | 'videoGeneration' | 'instructions' | 'computerUse' | 'browserUse' | 'quality' | 'modelProfiles' | 'subagents' | 'graph' | 'planExecution' | 'fastContext' | 'lab'
  >
> & {
  mcpSearch?: Partial<KunMcpSearchSettingsV1>
  projectConfig?: Partial<KunProjectConfigSettingsV1>
  tokenEconomy?: KunTokenEconomySettingsPatchV1
  toolOutputLimits?: Partial<KunToolOutputLimitsSettingsV1>
  storage?: Partial<KunStorageSettingsV1>
  contextCompaction?: Partial<KunContextCompactionSettingsV1>
  runtimeTuning?: KunRuntimeTuningSettingsPatchV1
  llmDebug?: Partial<KunLlmDebugSettingsV1>
  imageGeneration?: Partial<KunImageGenerationSettingsV1>
  speechToText?: Partial<KunSpeechToTextSettingsV1>
  textToSpeech?: Partial<KunTextToSpeechSettingsV1>
  promptOptimization?: Partial<KunPromptOptimizationSettingsV1>
  musicGeneration?: Partial<KunMusicGenerationSettingsV1>
  videoGeneration?: Partial<KunVideoGenerationSettingsV1>
  instructions?: Partial<KunInstructionSettingsV1>
  computerUse?: Partial<KunComputerUseSettingsV1>
  browserUse?: Partial<KunBrowserUseSettingsV1>
  quality?: Partial<KunDesignQualitySettingsV1>
  modelProfiles?: Record<string, ModelProviderModelProfilePatchV1 | null>
  subagents?: KunSubagentsSettingsPatchV1
  graph?: KunGraphSettingsPatchV1
  planExecution?: Partial<KunPlanExecutionSettingsV1>
  fastContext?: Partial<KunFastContextSettingsV1>
  lab?: KunLabSettingsPatchV1
}

export type KunSettingsEnvelopePatchV1 = {
  kun?: KunRuntimeSettingsPatchV1
}

export type LogConfigV1 = {
  enabled: boolean
  retentionDays: number
}

export type CheckpointCleanupConfigV1 = {
  /**
   * Whether to create a Git checkpoint before each user turn.
   * Defaults to off so checkpoint storage does not grow unless the user opts in.
   */
  createEnabled: boolean
  /**
   * Whether automatic cleanup runs. When enabled, unused checkpoints and
   * checkpoints older than `intervalDays` are removed on that schedule.
   */
  enabled: boolean
  /**
   * Cleanup cadence and age retention (default 3 days): scan on this interval
   * and delete checkpoints older than this many days.
   */
  intervalDays: CheckpointCleanupIntervalDays
  /**
   * Optional override for the Git checkpoint storage directory (issue #651).
   * Lets users point checkpoints at another drive with more free space instead
   * of filling the system drive under the Kun data dir. Absent = default
   * (`<dataDir>/git-checkpoints`).
   */
  directory?: string
  /**
   * One-time migration marker (issue #1156). When absent, a previously stored
   * `createEnabled: true` (persisted while creation used to default on) is
   * discarded so the new off-by-default applies to existing installs too.
   * Once written, the user's current choice is always respected.
   */
  createEnabledResetAt?: string
  /**
   * Hard cap for the total bytes consumed by checkpoint directories. Oldest
   * checkpoints (referenced or not) are evicted first when the cap is exceeded;
   * creation is skipped when the cap still cannot be met. Absent = default.
   */
  maxTotalBytes?: number
  /**
   * Skip checkpoint creation when the disk backing the checkpoints root has
   * less free space than this. Absent = default.
   */
  minFreeDiskBytes?: number
  /** Keep at most this many checkpoints per thread (oldest pruned). Absent = default 5. */
  maxPerThread?: number
}

export type NotificationConfigV1 = {
  /** Master switch for native reply-completion notifications. */
  turnComplete: boolean
  /** Main-agent completion notifications. Missing legacy values normalize to enabled. */
  mainAgentTurnComplete?: boolean
  /** Subagent side-session completion notifications. Missing legacy values normalize to disabled. */
  subagentTurnComplete?: boolean
}

export const WINDOW_CLOSE_ACTIONS = ['ask', 'tray', 'quit'] as const

export type WindowCloseAction = typeof WINDOW_CLOSE_ACTIONS[number]

export type AppBehaviorConfigV1 = {
  openAtLogin: boolean
  startMinimized: boolean
  /** Linux only. Use the desktop environment/window manager title bar after restart. */
  useSystemTitleBar?: boolean
  closeAction?: WindowCloseAction
  /** Legacy compatibility field. New code should use closeAction. */
  closeToTray: boolean
}

export type ScheduleSkillSettingsV1 = {
  defaultNames: string[]
  extraDirs: string[]
  /**
   * Discovered skill roots the user turned off. Holds common-directory ids
   * (e.g. `global-codex`) and/or normalized absolute paths for custom dirs.
   */
  disabledDirs: string[]
}

export type ScheduledTaskScheduleV1 = {
  kind: ScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
  /** IANA zone used when the user chose the wall-clock time. Execution uses atTime. */
  timeZone?: string
}

export type ScheduleTaskOrchestration = 'direct' | 'graph'

export type ScheduleTaskCreateInput = {
  title: string
  prompt: string
  workspaceRoot: string
  /** Plan artifact that owns this scheduled build. */
  sourcePlanId: string
  /** Existing GUI thread that should receive this scheduled turn. */
  sourceThreadId?: string
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
  orchestration: ScheduleTaskOrchestration
  schedule: {
    kind: 'at'
    atTime: string
    timeZone: string
  }
}

export type ScheduleTaskUpdateInput = {
  taskId: string
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  schedule: {
    kind: 'at'
    atTime: string
    timeZone: string
  }
}

export type ScheduleTaskDeleteResult =
  | { ok: true }
  | { ok: false; message: string }

export type ScheduleTaskMutationResult =
  | { ok: true; task: ScheduledTaskV1 }
  | { ok: false; message: string }

export type ScheduledTaskV1 = {
  id: string
  title: string
  enabled: boolean
  prompt: string
  workspaceRoot: string
  /** Plan artifact that owns this scheduled build. */
  sourcePlanId?: string
  /** Existing GUI thread reused by plan-scheduled builds. */
  sourceThreadId?: string
  /** Optional Claw IM channel whose persona/defaults should drive this scheduled task. */
  clawChannelId: string
  /** Selected model provider for this scheduled task. Empty means the current/default runtime provider. */
  providerId?: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
  /** Runtime orchestration for this task. Old tasks normalize to direct. */
  orchestration?: ScheduleTaskOrchestration
  priority?: number
  /** Task ids that must have completed successfully before this task runs. */
  dependsOn?: string[]
  /** Run the task in an isolated worktree from workspaceRoot. */
  useWorktree?: boolean
  schedule: ScheduledTaskScheduleV1
  createdAt: string
  updatedAt: string
  lastRunAt: string
  nextRunAt: string
  lastStatus: ScheduleTaskStatus
  lastMessage: string
  lastThreadId: string
}

export type ScheduleInternalSettingsV1 = {
  port: number
  secret: string
}

export type ScheduleSettingsV1 = {
  enabled: boolean
  defaultWorkspaceRoot: string
  /** Default model provider used when creating scheduled tasks. Empty means the current/default runtime provider. */
  providerId?: string
  model: string
  mode: ScheduleRunMode
  promptPrefix: string
  skills: ScheduleSkillSettingsV1
  keepAwake: boolean
  internal: ScheduleInternalSettingsV1
  tasks: ScheduledTaskV1[]
  /** Session-level daemon threads (long-running per-session scripts). */
  daemons: SessionDaemonSettingsV1
}

export type SessionDaemonInterpreter = 'auto' | 'python' | 'node'

export type SessionDaemonPushV1 = {
  enabled: boolean
  /** Must reference an enabled weixin Claw IM channel. */
  channelId: string
  /** Must reference a conversation owned by that channel; resolved to chatId at runtime. */
  conversationId: string
}

export type SessionDaemonV1 = {
  id: string
  title: string
  /** Per-daemon on/off. Global kill switch lives in SessionDaemonSettingsV1.enabled. */
  enabled: boolean
  workspaceRoot: string
  /** Kun thread this daemon is bound to (explicit). */
  threadId: string
  /** Workspace-relative or absolute script path. */
  scriptPath: string
  interpreter: SessionDaemonInterpreter
  heartbeatIntervalSeconds: number
  silenceTimeoutSeconds: number
  restartOnFailure: boolean
  push: SessionDaemonPushV1
  createdAt: string
  updatedAt: string
}

export type SessionDaemonSettingsV1 = {
  /** Global kill switch: off stops every daemon but keeps per-daemon config. */
  enabled: boolean
  items: SessionDaemonV1[]
}

export type DaemonProcessState = 'starting' | 'running' | 'restarting' | 'paused' | 'error'

export type DaemonPushStatusV1 = {
  /** 'sent' means the WeChat bridge accepted the send attempt, not a delivery receipt. */
  status: 'sent' | 'failed'
  at: string
  message?: string
}

export type DaemonRuntimeItemStatus = {
  id: string
  state: DaemonProcessState
  pid?: number
  startedAt?: string
  lastHeartbeatAt?: string
  lastOutputAt?: string
  restartCount: number
  lastError?: string
  logPath: string
  lastPush?: DaemonPushStatusV1
}

export type DaemonRuntimeStatus = {
  items: DaemonRuntimeItemStatus[]
  powerSaveBlockerActive: boolean
}

export type DaemonActionResult = {
  ok: boolean
  message?: string
}

export type DaemonLogPage = {
  lines: string[]
  nextCursor?: string
  eof: boolean
}
