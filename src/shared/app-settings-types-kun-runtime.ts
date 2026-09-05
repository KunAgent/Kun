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
import type { KunGitHubMcpSettingsV1 } from './github-mcp-authorization'

import {
  KunContextCompactionSettingsV1,
  KunImageGenerationSettingsV1,
  KunLlmDebugSettingsV1,
  KunMcpSearchSettingsV1,
  KunMusicGenerationSettingsV1,
  KunProjectConfigSettingsV1,
  KunPromptOptimizationSettingsV1,
  KunRuntimeTuningSettingsV1,
  KunSpeechToTextSettingsV1,
  KunStorageSettingsV1,
  KunTextToSpeechSettingsV1,
  KunTokenEconomySettingsV1,
  KunToolOutputLimitsSettingsV1,
  KunVideoGenerationSettingsV1
} from './app-settings-types-kun-services'
import {
  ModelProviderModelProfileV1,
  ModelReasoningEffort,
  ModelRequestRetrySettingsV1,
  ScheduleReasoningEffort
} from './app-settings-types-provider'

export type KunSubagentSurfaceV1 = 'shared' | 'code' | 'write' | 'design'

export type KunSubagentProfileV1 = {
  /** Stable key; becomes the Record key in kun SubagentsCapabilityConfig.profiles. */
  id: string
  enabled: boolean
  name: string
  description?: string
  /** Hex color for the GUI avatar chip. */
  color?: string
  /** 'subagent' = delegate_task only; 'primary' = session persona only; 'all' = both. */
  mode: 'subagent' | 'primary' | 'all'
  /** `shared` is inherited by Code, Write, and Design. Empty disables routing. */
  surfaces?: KunSubagentSurfaceV1[]
  model?: string
  providerId?: string
  /** Appended to the base system prompt (augment, not replace). */
  systemPrompt?: string
  /** Prepended to the user prompt body to steer the child without changing the system fingerprint. */
  promptPreamble?: string
  /** 'readOnly' restricts child to read/grep/find/ls; 'inherit' passes all tools. */
  toolPolicy: 'readOnly' | 'inherit'
  /** Explicit allow-list; overrides toolPolicy when set. */
  allowedTools?: string[]
  /** Built-in tool names switched off for this profile (deny-list, layered on inherit). Empty/undefined = inherit all. */
  blockedTools?: string[]
  /** MCP server ids switched off for this profile (deny-list; the whole server toolset is hidden). */
  blockedMcpServers?: string[]
  /** Skill ids switched off for this profile (deny-list; default inherits every available skill). */
  blockedSkills?: string[]
  /** Reasoning depth applied to this profile's child model requests. Default 'off'. */
  reasoningEffort?: ModelReasoningEffort
}

export type KunSubagentsSettingsV1 = {
  enabled: boolean
  /** Defaults to true when absent for settings written by older app versions. */
  useExistingAgents?: boolean
  maxParallel?: number
  /** Main-agent continuation policy for failed ordinary delegate_task children. */
  proactiveRetry?: {
    enabled: boolean
    maxAttempts: number
  }
  defaultToolPolicy?: 'readOnly' | 'inherit'
  defaultProfile?: string
  profiles: KunSubagentProfileV1[]
}

/**
 * Compatibility-only shape for settings written before cumulative child-run
 * limits were removed. Normalization accepts `maxChildRuns` but never carries
 * it into effective settings or newly saved patches.
 */
export type LegacyKunSubagentsSettingsInputV1 = Partial<KunSubagentsSettingsV1> & {
  maxChildRuns?: unknown
}

/**
 * Partial settings patch for the subagent roster. Scalar fields merge with the
 * current settings, while an explicitly supplied `profiles` array replaces the
 * roster as a whole (so deleting a profile can be represented unambiguously).
 */
export type KunSubagentsSettingsPatchV1 = Partial<
  Omit<KunSubagentsSettingsV1, 'profiles'>
> & {
  profiles?: KunSubagentProfileV1[]
}

/** Formal assistant settings for the first-class `fast_context` tool. */
export type KunFastContextSettingsV1 = {
  /** Master switch for the fast_context tool. Default true. */
  enabled: boolean
  /** Optional child model override. Empty = follow the main session model. */
  model: string
  /** Provider id paired with model. Empty = follow the main session provider. */
  providerId: string
  /** Optional reasoning depth for fast_context child requests. Empty = follow the main session. */
  reasoningEffort?: ModelReasoningEffort
  /** Codex fast mode (serviceTier = priority). Only effective for Codex models that advertise priority. */
  fast: boolean
}

/** Experimental Lab feature settings for the first-class `ppt_agent` tool. */
export type KunLabPptAgentSettingsV1 = {
  /** Master switch for the ppt_agent tool. Default true. */
  enabled: boolean
  /** Optional child model override. Empty = follow the main session model. */
  model: string
  /** Provider id paired with model. Empty = follow the main session provider. */
  providerId: string
  /** Optional reasoning depth for ppt_agent child requests. Empty = follow the main session. */
  reasoningEffort?: ModelReasoningEffort
  /** Codex fast mode (serviceTier = priority). Only effective for Codex models that advertise priority. */
  fast: boolean
  /** Generate and review a complete visual slide set before building the editable deck. Default true. */
  imageFirst: boolean
}

/** Experimental Lab feature settings for inline conversation visualizations. */
export type KunLabConversationVisualizationSettingsV1 = {
  /** Master switch. Default false while the feature is experimental. */
  enabled: boolean
}

/** Experimental Lab feature settings for the project board sidebar entry. */
export type KunLabProjectBoardSettingsV1 = {
  /** Master switch. Default false while the feature is experimental. */
  enabled: boolean
}

export type KunLabAutoPlanBuildMode = 'direct' | 'scheduled'
export type KunLabAutoPlanBuildConfirmation = 'always' | 'defaults'

export type KunLabAutoPlanBuildScheduledDefaultsV1 = {
  /** Empty values inherit the active composer/runtime selection. */
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  /** Empty uses the host system time zone. Exact date/time is never persisted here. */
  timeZone: string
}

/** GUI-only Laboratory defaults for the Automatic (plan + build) composer mode. */
export type KunLabAutoPlanBuildSettingsV1 = {
  enabled: boolean
  confirmation: KunLabAutoPlanBuildConfirmation
  defaultBuildMode: KunLabAutoPlanBuildMode
  useWorktreeByDefault: boolean
  scheduledDefaults: KunLabAutoPlanBuildScheduledDefaultsV1
}

/** Experimental Lab feature settings written into Kun config `lab`. */
export type KunLabSettingsV1 = {
  pptAgent: KunLabPptAgentSettingsV1
  conversationVisualization: KunLabConversationVisualizationSettingsV1
  autoPlanBuild: KunLabAutoPlanBuildSettingsV1
  projectBoard: KunLabProjectBoardSettingsV1
}

/** Partial settings patch for the Lab section. Nested fields merge with current values. */
export type KunLabSettingsPatchV1 = {
  pptAgent?: Partial<KunLabPptAgentSettingsV1>
  conversationVisualization?: Partial<KunLabConversationVisualizationSettingsV1>
  autoPlanBuild?: Partial<Omit<KunLabAutoPlanBuildSettingsV1, 'scheduledDefaults'>> & {
    scheduledDefaults?: Partial<KunLabAutoPlanBuildScheduledDefaultsV1>
  }
  projectBoard?: Partial<KunLabProjectBoardSettingsV1>
}

export const KUN_GRAPH_ROLLOUT_STAGES = [
  'experimental',
  'alpha',
  'beta',
  'learning-preview',
  'stable'
] as const

export type KunGraphRolloutStage = (typeof KUN_GRAPH_ROLLOUT_STAGES)[number]

export const KUN_GRAPH_LEARNING_MODES = ['off', 'suggest', 'auto_candidate'] as const

export type KunGraphLearningMode = (typeof KUN_GRAPH_LEARNING_MODES)[number]

export type KunGraphSchedulerSettingsV1 = {
  maxNodes: number
  maxEdges: number
  maxConcurrentRuns: number
  maxConcurrentNodes: number
  maxConcurrentNodesPerRun: number
  maxAttemptsPerNode: number
  maxRevisions: number
  maxLoopIterations: number
  maxRunWallTimeMs: number
  maxNodeWallTimeMs: number
  maxArtifactBytes: number
  budgetWarningRatio: number
}

export type KunGraphContextSettingsV1 = {
  maxWorkerContextBytes: number
  maxDependencySummaryBytes: number
  maxInputArtifacts: number
  maxInputMessages: number
  maxInlineEventBytes: number
}

export type KunGraphMailboxSettingsV1 = {
  maxMessagesPerNode: number
  maxMessagesPerRun: number
  maxMessageBytes: number
  maxArtifactRefsPerMessage: number
  maxMessagesPerMinute: number
  defaultTtlMs: number
  blockingReplyTimeoutMs: number
}

export type KunGraphSupervisionSettingsV1 = {
  enabled: boolean
  autoStart: boolean
  coalesceWindowMs: number
  stallTimeoutMs: number
  repeatedFailureThreshold: number
  requireFinalReview: boolean
  requireHumanForCriticalRisk: boolean
}

export type KunGraphWriteIsolationSettingsV1 = {
  mode: 'serialize' | 'lease' | 'worktree'
  allowWorktrees: boolean
  leaseTtlMs: number
  preserveFailedWorktrees: boolean
}

export type KunGraphRoutingSettingsV1 = {
  recallLimit: number
  minTaskFit: number
  minConfidence: number
  explorationRatio: number
  dormantMissedOpportunityThreshold: number
}

export type KunGraphLearningSettingsV1 = {
  mode: KunGraphLearningMode
  minimumDistinctSessions: number
  minimumVerifiedEpisodes: number
  consolidationIntervalMs: number
  maxEpisodesPerJob: number
  probationMinimumRuns: number
  allowReadOnlyExploration: boolean
}

export type KunGraphRetentionSettingsV1 = {
  graphDays: number
  artifactDays: number
  episodeDays: number
  auditDays: number
  snapshotEveryEvents: number
  compactAfterEvents: number
}

export type KunGraphWorkerModelSettingsV1 =
  | {
      mode: 'inherit'
    }
  | {
      mode: 'fixed'
      providerId: string
      model: string
      reasoningEffort?: ModelReasoningEffort
    }

export type KunGraphSettingsV1 = {
  enabled: boolean
  defaultStrategy: 'direct' | 'graph'
  rolloutStage: KunGraphRolloutStage
  workerModel: KunGraphWorkerModelSettingsV1
  scheduler: KunGraphSchedulerSettingsV1
  context: KunGraphContextSettingsV1
  mailbox: KunGraphMailboxSettingsV1
  supervision: KunGraphSupervisionSettingsV1
  writeIsolation: KunGraphWriteIsolationSettingsV1
  routing: KunGraphRoutingSettingsV1
  learning: KunGraphLearningSettingsV1
  retention: KunGraphRetentionSettingsV1
}

export type KunGraphSettingsPatchV1 = Partial<
  Omit<
    KunGraphSettingsV1,
    | 'scheduler'
    | 'context'
    | 'mailbox'
    | 'supervision'
    | 'writeIsolation'
    | 'routing'
    | 'learning'
    | 'retention'
    | 'workerModel'
  >
> & {
  workerModel?: {
    mode?: 'inherit' | 'fixed'
    providerId?: string
    model?: string
    reasoningEffort?: ModelReasoningEffort
  }
  scheduler?: Partial<KunGraphSchedulerSettingsV1>
  context?: Partial<KunGraphContextSettingsV1>
  mailbox?: Partial<KunGraphMailboxSettingsV1>
  supervision?: Partial<KunGraphSupervisionSettingsV1>
  writeIsolation?: Partial<KunGraphWriteIsolationSettingsV1>
  routing?: Partial<KunGraphRoutingSettingsV1>
  learning?: Partial<KunGraphLearningSettingsV1>
  retention?: Partial<KunGraphRetentionSettingsV1>
}

export type KunPlanExecutionSettingsV1 = {
  /** Default Direct plan builds to an Agent-managed worktree. */
  useWorktreeByDefault: boolean
}

export type KunRuntimeSettingsV1 = {
  binaryPath: string
  port: number
  autoStart: boolean
  /** Optional override. Leave empty to inherit the General model provider API key. */
  apiKey: string
  /** Optional override. Leave empty to inherit the General model provider Base URL. */
  baseUrl: string
  /** Selected General model provider profile. Empty or missing means the default provider. */
  providerId: string
  /** Effective model request format. Resolved from the selected model provider. */
  endpointFormat: ModelEndpointFormat
  /** 当前生效的模型请求重试策略,由所选模型供应商解析得到。 */
  retry: ModelRequestRetrySettingsV1
  runtimeToken: string
  dataDir: string
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalReviewer: ApprovalReviewer
  /** Compress safe tool context before each model call. */
  tokenEconomyMode: boolean
  /** Detailed token-saving behavior used when building Kun model requests. */
  tokenEconomy: KunTokenEconomySettingsV1
  /** Model-visible output caps for builtin read/bash-style tools. */
  toolOutputLimits: KunToolOutputLimitsSettingsV1
  /** When true, the runtime skips bearer-token auth. Local dev only. */
  insecure: boolean
  /** GUI-managed MCP progressive discovery/search settings written into Kun config.json. */
  mcpSearch: KunMcpSearchSettingsV1
  /** Explicit opt-in and non-secret policy for the managed read-only GitHub MCP connector. */
  githubMcp: KunGitHubMcpSettingsV1
  /** User-local, digest-bound grants for repository `.kun/project.json` MCP declarations. */
  projectConfig: KunProjectConfigSettingsV1
  /** Persistent store backend used by Kun. */
  storage: KunStorageSettingsV1
  /** Fallback compaction thresholds and summary behavior. Per-model thresholds live in Kun config models.profiles. */
  contextCompaction: KunContextCompactionSettingsV1
  /** Low-level loop guards and model argument repair tuning. */
  runtimeTuning: KunRuntimeTuningSettingsV1
  /** Local Agent Perspective capture defaults. */
  llmDebug: KunLlmDebugSettingsV1
  /** OpenAI-compatible image generation provider shared by chat agents and Write image tools. */
  imageGeneration: KunImageGenerationSettingsV1
  /** Speech-to-text provider used for voice input in the composer. */
  speechToText: KunSpeechToTextSettingsV1
  /** Text-to-speech provider exposed to agents as generate_speech. */
  textToSpeech: KunTextToSpeechSettingsV1
  /** Model + prompt used by the composer prompt optimization button. */
  promptOptimization: KunPromptOptimizationSettingsV1
  /** Music generation provider exposed to agents as generate_music. */
  musicGeneration: KunMusicGenerationSettingsV1
  /** Video generation provider exposed to agents as generate_video. */
  videoGeneration: KunVideoGenerationSettingsV1
  /** GUI-owned model capability profiles written into Kun `models.profiles`. */
  modelProfiles: Record<string, ModelProviderModelProfileV1>
  /** Whether long-term memory is enabled in the Kun runtime. */
  memoryEnabled: boolean
  /** Native Kun AGENTS.md instructions injected into every turn. */
  instructions: KunInstructionSettingsV1
  /** Host computer-use (screenshot + mouse/keyboard control) settings. */
  computerUse: KunComputerUseSettingsV1
  /** Supervised temporary first-party browser automation settings. */
  browserUse: KunBrowserUseSettingsV1
  /** First-party design-quality linter applied to frontend output. */
  quality: KunDesignQualitySettingsV1
  /** GUI-managed subagent profiles written into kun SubagentsCapabilityConfig. */
  subagents?: KunSubagentsSettingsV1
  /** Host-owned Graph orchestration, project-agent routing, and learning policy. */
  graph: KunGraphSettingsV1
  /** Host-owned defaults for executing reviewed GUI plans. */
  planExecution: KunPlanExecutionSettingsV1
  /** Formal Fast Context settings. Enabled by default. */
  fastContext: KunFastContextSettingsV1
  /** Experimental Lab features that remain in Laboratory. */
  lab: KunLabSettingsV1
  /** Global small-model slot. Title & Summary default to this. Empty = follow main model. */
  smallModel?: string
  /** Provider id paired with smallModel for per-provider routing. */
  smallModelProviderId?: string
  /** Opaque account id paired with smallModelProviderId. */
  smallModelAccountId?: string
  /** Optional model override for thread title generation. Empty = smallModel || main model. */
  titleModel?: string
  /** Provider id paired with titleModel. */
  titleProviderId?: string
  titleAccountId?: string
  /** Optional model override for whole-session summary generation. Empty = smallModel || main model. */
  summaryModel?: string
  /** Provider id paired with summaryModel. */
  summaryProviderId?: string
  summaryAccountId?: string
  /** Optional model override for the code-review subagent. Empty = smallModel || main model. */
  codeReviewModel?: string
  /** Provider id paired with codeReviewModel. */
  codeReviewProviderId?: string
  codeReviewAccountId?: string
  /** Optional model override for Plan-mode turns. Empty = the main conversation model. */
  planModel?: string
  /** Provider id paired with planModel. */
  planProviderId?: string
  /** Opaque account id paired with planProviderId. */
  planAccountId?: string
  /** Reasoning depth for thread-title generation. Default 'off'. */
  titleReasoningEffort?: ModelReasoningEffort
  /** Reasoning depth for whole-session summary generation. Default 'off'. */
  summaryReasoningEffort?: ModelReasoningEffort
  /** Reasoning depth for the code-review subagent model call. Default 'off'. */
  codeReviewReasoningEffort?: ModelReasoningEffort
}

export type KunInstructionSettingsV1 = {
  enabled: boolean
}

/** Detection aggressiveness for the design-quality linter. */
export type KunDesignQualityStrictness = 'relaxed' | 'standard' | 'strict'

export type KunDesignQualitySettingsV1 = {
  /** Master switch. Off means the builtin design-quality hook never fires. */
  enabled: boolean
  strictness: KunDesignQualityStrictness
  /** Rule ids to suppress. */
  ignoreRules: string[]
  /** Relative-path glob patterns to skip. */
  ignoreFiles: string[]
  /** Cap on findings folded into a single tool result. */
  maxFindings: number
}

export type KunComputerUseSettingsV1 = {
  /** Master switch. Off means the computer_use tool is never registered. */
  enabled: boolean
  /**
   * `auto`: advertise only to vision (image-capable) models — a vision
   * model turns it on for itself. `always`: advertise to every model.
   * `off`: never advertise even when enabled.
   */
  mode: ComputerUseMode
  /** Longest screenshot edge (px); larger captures are downscaled for grounding. */
  maxImageDimension: number
  /** Hard cap on computer_use actions per turn. */
  maxActionsPerTurn: number
}

export type KunBrowserUseSettingsV1 = {
  /** Master switch. Enabled by default; disabling removes browser_use. */
  enabled: boolean
  /** Public internet and exact-loopback development sessions never mix. */
  mode: BrowserUseMode
  /**
   * `auto-safe` automatically grants public origins and executes validated
   * low-risk interactions. `always-ask` preserves per-origin/per-action consent.
   */
  approvalMode: 'auto-safe' | 'always-ask'
  maxTabs: number
  maxObservationActionsPerTurn: number
  maxInteractionActionsPerTurn: number
  maxSnapshotNodes: number
  maxSnapshotTextChars: number
  maxImageDimension: number
  idleTimeoutMs: number
}
