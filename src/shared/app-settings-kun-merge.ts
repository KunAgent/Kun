import {
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_IMAGE_GENERATION_RESOLUTION,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_RESOLUTIONS,
  DEFAULT_KUN_DATA_DIR,
  DEFAULT_KUN_MODEL,
  DEFAULT_KUN_PORT,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  MIN_KUN_LOCAL_PORT,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES,
  DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
  DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MODEL_REASONING_EFFORTS,
  MODEL_REASONING_REQUEST_PROTOCOLS,
  kunToolPermissionModeSettings,
  normalizeModelEndpointFormat,
  type AppSettingsV1,
  type KunComputerUseSettingsV1,
  type KunBrowserUseSettingsV1,
  type KunContextCompactionSettingsV1,
  type KunDesignQualitySettingsV1,
  type KunDesignQualityStrictness,
  type KunHistoryHygieneSettingsV1,
  type KunImageGenerationSettingsV1,
  type KunInstructionSettingsV1,
  type KunFastContextSettingsV1,
  type KunLabSettingsPatchV1,
  type KunLabSettingsV1,
  type KunSubagentsSettingsV1,
  type LegacyKunSubagentsSettingsInputV1,
  type KunLlmDebugSettingsV1,
  type ImageGenerationQuality,
  type ImageGenerationResolution,
  type KunMcpSearchSettingsV1,
  type KunProjectConfigSettingsV1,
  type KunMusicGenerationSettingsV1,
  type KunPromptOptimizationSettingsV1,
  type KunRuntimeTuningSettingsV1,
  type KunRuntimeSettingsPatchV1,
  type KunRuntimeSettingsV1,
  type KunSettingsEnvelopePatchV1,
  type KunSettingsEnvelopeV1,
  type KunSpeechToTextSettingsV1,
  type KunStorageSettingsV1,
  type KunToolOutputLimitsSettingsV1,
  type KunTextToSpeechSettingsV1,
  type KunTokenEconomySettingsV1,
  type KunVideoGenerationSettingsV1,
  type ImageGenerationProtocol,
  type MusicGenerationProtocol,
  type ModelProviderInputModality,
  type ModelProviderMessagePartSupport,
  type ModelProviderModelProfilePatchV1,
  type ModelProviderModelProfileV1,
  type ModelProviderReasoningCapabilityV1,
  type ModelReasoningEffort,
  type ModelProviderSettingsV1,
  type SpeechToTextProtocol,
  type TextToSpeechProtocol,
  type VideoGenerationProtocol,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from './app-settings-types'
import {
  defaultKunGraphSettings,
  normalizeKunGraphSettings
} from './app-settings-graph'
import {
  normalizeModelProviderSettings,
  resolveKunRuntimeSettings
} from './app-settings-provider'
import {
  LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID,
  isLocalWhisperDownloadSourceId
} from './local-whisper'

import {
  normalizeApprovalReviewer
} from './app-settings-kun-defaults'
import {
  DEFAULT_GITHUB_MCP_HOST,
  normalizeGitHubMcpSettings
} from './github-mcp-authorization'
import {
  normalizeKunBrowserUseSettings,
  normalizeKunComputerUseSettings,
  normalizeKunImageGenerationSettings,
  normalizeKunMusicGenerationSettings,
  normalizeKunPromptOptimizationSettings,
  normalizeKunSpeechToTextSettings,
  normalizeKunTextToSpeechSettings,
  normalizeKunVideoGenerationSettings
} from './app-settings-kun-media'
import {
  nonEmptyStringOrFallback,
  normalizeKunLocalPort,
  normalizeKunModelProfiles,
  normalizeKunQualitySettings
} from './app-settings-kun-migration'
import {
  normalizeKunContextCompactionSettings,
  normalizeKunLlmDebugSettings,
  normalizeKunMcpSearchSettings,
  normalizeKunProjectConfigSettings,
  normalizeKunRuntimeTuningSettings,
  normalizeKunStorageSettings,
  normalizeKunTokenEconomySettings,
  normalizeKunToolOutputLimitsSettings
} from './app-settings-kun-tuning'

export function mergeKunRuntimeSettings(
  current: KunRuntimeSettingsV1,
  patch: KunRuntimeSettingsPatchV1 | undefined
): KunRuntimeSettingsV1 {
  const currentMcpSearch = normalizeKunMcpSearchSettings(current.mcpSearch)
  const nextMcpSearch = normalizeKunMcpSearchSettings({
    ...currentMcpSearch,
    ...(patch?.mcpSearch ?? {})
  })
  const nextProjectConfig = normalizeKunProjectConfigSettings(
    patch?.projectConfig ?? current.projectConfig
  )
  const nextGitHubMcp = normalizeGitHubMcpSettings({
    ...current.githubMcp,
    ...(patch?.githubMcp ?? {}),
    authorization: patch?.githubMcp?.authorization === null
      ? undefined
      : patch?.githubMcp?.authorization ?? current.githubMcp?.authorization,
    githubHost: patch?.githubMcp?.githubHost ?? current.githubMcp?.githubHost ?? DEFAULT_GITHUB_MCP_HOST
  })
  const currentTokenEconomy = normalizeKunTokenEconomySettings(
    current.tokenEconomy,
    current.tokenEconomyMode
  )
  const patchedTokenEconomy = normalizeKunTokenEconomySettings({
    ...currentTokenEconomy,
    ...(patch?.tokenEconomy ?? {}),
    historyHygiene: {
      ...currentTokenEconomy.historyHygiene,
      ...(patch?.tokenEconomy?.historyHygiene ?? {})
    }
  }, currentTokenEconomy.enabled)
  const tokenEconomyEnabled = typeof patch?.tokenEconomy?.enabled === 'boolean'
    ? patch.tokenEconomy.enabled
    : typeof patch?.tokenEconomyMode === 'boolean'
      ? patch.tokenEconomyMode
      : patchedTokenEconomy.enabled
  const nextTokenEconomy = {
    ...patchedTokenEconomy,
    enabled: tokenEconomyEnabled
  }
  const currentToolOutputLimits = normalizeKunToolOutputLimitsSettings(current.toolOutputLimits)
  const nextToolOutputLimits = normalizeKunToolOutputLimitsSettings({
    ...currentToolOutputLimits,
    ...(patch?.toolOutputLimits ?? {})
  })
  const currentStorage = normalizeKunStorageSettings(current.storage)
  const nextStorage = normalizeKunStorageSettings({
    ...currentStorage,
    ...(patch?.storage ?? {})
  })
  const currentContextCompaction = normalizeKunContextCompactionSettings(current.contextCompaction)
  const contextCompactionPatch = patch?.contextCompaction ?? {}
  const nextContextCompactionInput = {
    ...currentContextCompaction,
    ...contextCompactionPatch
  }
  if (
    contextCompactionPatch.defaultSoftThreshold !== undefined &&
    contextCompactionPatch.defaultHardThreshold === undefined
  ) {
    nextContextCompactionInput.defaultHardThreshold = contextCompactionPatch.defaultSoftThreshold
  }
  const nextContextCompaction = normalizeKunContextCompactionSettings(nextContextCompactionInput)
  const currentImageGeneration = normalizeKunImageGenerationSettings(current.imageGeneration)
  const nextImageGeneration = normalizeKunImageGenerationSettings({
    ...currentImageGeneration,
    ...(patch?.imageGeneration ?? {})
  })
  const currentSpeechToText = normalizeKunSpeechToTextSettings(current.speechToText)
  const nextSpeechToText = normalizeKunSpeechToTextSettings({
    ...currentSpeechToText,
    ...(patch?.speechToText ?? {})
  })
  const currentTextToSpeech = normalizeKunTextToSpeechSettings(current.textToSpeech)
  const nextTextToSpeech = normalizeKunTextToSpeechSettings({
    ...currentTextToSpeech,
    ...(patch?.textToSpeech ?? {})
  })
  const currentPromptOptimization = normalizeKunPromptOptimizationSettings(current.promptOptimization)
  const nextPromptOptimization = normalizeKunPromptOptimizationSettings({
    ...currentPromptOptimization,
    ...(patch?.promptOptimization ?? {})
  })
  const currentMusicGeneration = normalizeKunMusicGenerationSettings(current.musicGeneration)
  const nextMusicGeneration = normalizeKunMusicGenerationSettings({
    ...currentMusicGeneration,
    ...(patch?.musicGeneration ?? {})
  })
  const currentVideoGeneration = normalizeKunVideoGenerationSettings(current.videoGeneration)
  const nextVideoGeneration = normalizeKunVideoGenerationSettings({
    ...currentVideoGeneration,
    ...(patch?.videoGeneration ?? {})
  })
  const currentComputerUse = normalizeKunComputerUseSettings(current.computerUse)
  const nextComputerUse = normalizeKunComputerUseSettings({
    ...currentComputerUse,
    ...(patch?.computerUse ?? {})
  })
  const currentBrowserUse = normalizeKunBrowserUseSettings(current.browserUse)
  const nextBrowserUse = normalizeKunBrowserUseSettings({
    ...currentBrowserUse,
    ...(patch?.browserUse ?? {})
  })
  const currentQuality = normalizeKunQualitySettings(current.quality)
  const nextQuality = normalizeKunQualitySettings({
    ...currentQuality,
    ...(patch?.quality ?? {})
  })
  const nextGraph = normalizeKunGraphSettings({
    ...current.graph,
    ...(patch?.graph ?? {}),
    workerModel: {
      ...current.graph?.workerModel,
      ...(patch?.graph?.workerModel ?? {})
    },
    scheduler: {
      ...current.graph?.scheduler,
      ...(patch?.graph?.scheduler ?? {})
    },
    context: {
      ...current.graph?.context,
      ...(patch?.graph?.context ?? {})
    },
    mailbox: {
      ...current.graph?.mailbox,
      ...(patch?.graph?.mailbox ?? {})
    },
    supervision: {
      ...current.graph?.supervision,
      ...(patch?.graph?.supervision ?? {})
    },
    writeIsolation: {
      ...current.graph?.writeIsolation,
      ...(patch?.graph?.writeIsolation ?? {})
    },
    routing: {
      ...current.graph?.routing,
      ...(patch?.graph?.routing ?? {})
    },
    learning: {
      ...current.graph?.learning,
      ...(patch?.graph?.learning ?? {})
    },
    retention: {
      ...current.graph?.retention,
      ...(patch?.graph?.retention ?? {})
    }
  })
  const currentRuntimeTuning = normalizeKunRuntimeTuningSettings(current.runtimeTuning)
  const nextRuntimeTuning = normalizeKunRuntimeTuningSettings({
    ...currentRuntimeTuning,
    ...(patch?.runtimeTuning
      ? {
          ...(patch.runtimeTuning.maxWallTimeMs !== undefined
            ? { maxWallTimeMs: patch.runtimeTuning.maxWallTimeMs }
            : {}),
          ...(patch.runtimeTuning.maxConcurrentTurns !== undefined
            ? { maxConcurrentTurns: patch.runtimeTuning.maxConcurrentTurns }
            : {}),
          ...(patch.runtimeTuning.streamIdleTimeoutMs !== undefined
            ? { streamIdleTimeoutMs: patch.runtimeTuning.streamIdleTimeoutMs }
            : {}),
          toolStorm: {
            ...currentRuntimeTuning.toolStorm,
            ...(patch.runtimeTuning.toolStorm ?? {})
          },
          toolArgumentRepair: {
            ...currentRuntimeTuning.toolArgumentRepair,
            ...(patch.runtimeTuning.toolArgumentRepair ?? {})
          },
          interruptedTurnResume: {
            ...currentRuntimeTuning.interruptedTurnResume,
            ...(patch.runtimeTuning.interruptedTurnResume ?? {})
          }
        }
      : {})
  })
  const nextLlmDebug = normalizeKunLlmDebugSettings({
    ...current.llmDebug,
    ...(patch?.llmDebug ?? {})
  })
  const nextModelProfiles = normalizeKunModelProfiles(current.modelProfiles, patch?.modelProfiles)
  const nextInstructions = {
    enabled: patch?.instructions?.enabled ?? current.instructions?.enabled ?? true
  }
  const nextPort = normalizeKunLocalPort(patch?.port ?? current.port, DEFAULT_KUN_PORT)
  // Optional role/small-model slots (agents.kun.*). Patch wins when the key is
  // present (even as empty string => clear); otherwise inherit current. Empty/
  // whitespace strings are dropped so the field is omitted entirely.
  const nextRoleModelSlots = mergeOptionalModelSlot(current, patch)
  const nextRoleReasoningSlots = mergeOptionalReasoningSlot(current, patch)
  const nextSubagents = mergeKunSubagentsSettings(current.subagents, patch?.subagents)
  const legacyLab = current.lab as {
    fastContext?: KunFastContextSettingsV1
    exploreAgent?: KunFastContextSettingsV1
  } | undefined
  const legacyFastContext = legacyLab?.fastContext ?? legacyLab?.exploreAgent
  const legacyFastContextPatch = (patch?.lab as {
    fastContext?: Partial<KunFastContextSettingsV1>
    exploreAgent?: Partial<KunFastContextSettingsV1>
  } | undefined)
  const nextFastContext = mergeLabAgentSettings(
    current.fastContext ?? legacyFastContext ?? defaultKunFastContextSettings(),
    patch?.fastContext ?? legacyFastContextPatch?.fastContext ?? legacyFastContextPatch?.exploreAgent
  )
  const nextLab = mergeKunLabSettings(current.lab, patch?.lab)
  const nextPlanExecution = {
    useWorktreeByDefault: patch?.planExecution?.useWorktreeByDefault
      ?? current.planExecution?.useWorktreeByDefault
      ?? true
  }
  // Do not let the nested partial patch leak through the broad object spread;
  // `nextSubagents` below is the fully materialized authoritative value.
  // Primary `model` is handled separately: empty strings must not wipe the
  // chat model (settings:set rejects model: '' via modelIdSchema.min(1)).
  const {
    subagents: _subagentsPatch,
    projectConfig: _projectConfigPatch,
    graph: _graphPatch,
    planExecution: _planExecutionPatch,
    llmDebug: _llmDebugPatch,
    lab: _labPatch,
    model: _modelPatch,
    ...flatPatch
  } = patch ?? {}
  void _subagentsPatch
  void _projectConfigPatch
  void _graphPatch
  void _planExecutionPatch
  void _llmDebugPatch
  void _labPatch
  void _modelPatch
  const nextModel = nonEmptyStringOrFallback(
    patch?.model,
    nonEmptyStringOrFallback(current.model, DEFAULT_KUN_MODEL)
  )
  // NOTE: approvalPolicy/sandboxMode/reviewer are merged through verbatim from
  // the patch. The three-mode UI selector resolves a deliberate selection to
  // its complete authority snapshot before dispatching the patch. We must NOT
  // re-canonicalize here: the projection is lossy for legacy raw combinations,
  // so round-tripping it would silently broaden or otherwise rewrite them.
  const merged: KunRuntimeSettingsV1 = {
    ...current,
    ...flatPatch,
    model: nextModel,
    approvalReviewer: normalizeApprovalReviewer(
      patch?.approvalReviewer ?? current.approvalReviewer
    ),
    port: nextPort,
    tokenEconomyMode: nextTokenEconomy.enabled,
    tokenEconomy: nextTokenEconomy,
    toolOutputLimits: nextToolOutputLimits,
    mcpSearch: nextMcpSearch,
    githubMcp: nextGitHubMcp,
    projectConfig: nextProjectConfig,
    storage: nextStorage,
    contextCompaction: nextContextCompaction,
    runtimeTuning: nextRuntimeTuning,
    llmDebug: nextLlmDebug,
    imageGeneration: nextImageGeneration,
    speechToText: nextSpeechToText,
    textToSpeech: nextTextToSpeech,
    promptOptimization: nextPromptOptimization,
    musicGeneration: nextMusicGeneration,
    videoGeneration: nextVideoGeneration,
    modelProfiles: nextModelProfiles,
    memoryEnabled: patch?.memoryEnabled ?? current.memoryEnabled ?? false,
    instructions: nextInstructions,
    computerUse: nextComputerUse,
    browserUse: nextBrowserUse,
    quality: nextQuality,
    graph: nextGraph,
    planExecution: nextPlanExecution,
    fastContext: nextFastContext,
    lab: nextLab,
    ...(nextSubagents !== undefined ? { subagents: nextSubagents } : {})
  }
  // Optional model slots are authoritative from mergeOptionalModelSlot: strip any
  // verbatim copies leaked by the spreads above, then re-apply only the non-empty
  // ones so a cleared (empty-string) patch value removes the field entirely.
  for (const key of OPTIONAL_MODEL_SLOT_KEYS) delete merged[key]
  for (const key of OPTIONAL_REASONING_SLOT_KEYS) delete merged[key]
  return { ...merged, ...nextRoleModelSlots, ...nextRoleReasoningSlots }
}

export function mergeKunSubagentsSettings(
  current: KunRuntimeSettingsV1['subagents'],
  patch: KunRuntimeSettingsPatchV1['subagents']
): KunRuntimeSettingsV1['subagents'] {
  const effectiveCurrent = stripLegacyChildRunLimit(current)
  const effectivePatch = stripLegacyChildRunLimit(patch)
  if (effectiveCurrent === undefined && effectivePatch === undefined) return undefined
  return {
    ...(effectiveCurrent ?? { enabled: true, useExistingAgents: true, profiles: [] }),
    ...effectivePatch,
    enabled: effectivePatch?.enabled ?? effectiveCurrent?.enabled ?? true,
    useExistingAgents: effectivePatch?.useExistingAgents ?? effectiveCurrent?.useExistingAgents ?? true,
    proactiveRetry: {
      enabled: effectivePatch?.proactiveRetry?.enabled
        ?? effectiveCurrent?.proactiveRetry?.enabled
        ?? true,
      maxAttempts: effectivePatch?.proactiveRetry?.maxAttempts
        ?? effectiveCurrent?.proactiveRetry?.maxAttempts
        ?? 3
    },
    // A roster diff is an intentional whole-array replacement (including []
    // for deleting every custom profile). Omitting it keeps the current roster.
    profiles: effectivePatch?.profiles !== undefined
      ? [...effectivePatch.profiles]
      : [...(effectiveCurrent?.profiles ?? [])]
  }
}

function stripLegacyChildRunLimit(
  input: LegacyKunSubagentsSettingsInputV1 | undefined
): Partial<KunSubagentsSettingsV1> | undefined {
  if (input === undefined) return undefined
  const { maxChildRuns: _legacyMaxChildRuns, ...effective } = input
  void _legacyMaxChildRuns
  return effective
}

export function defaultKunFastContextSettings(): KunFastContextSettingsV1 {
  return {
    enabled: true,
    model: '',
    providerId: '',
    fast: false
  }
}

export function defaultKunLabSettings(): KunLabSettingsV1 {
  return {
    pptAgent: {
      enabled: true,
      model: '',
      providerId: '',
      fast: false,
      imageFirst: true
    },
    conversationVisualization: {
      enabled: false
    },
    autoPlanBuild: {
      enabled: false,
      confirmation: 'always',
      defaultBuildMode: 'direct',
      useWorktreeByDefault: true,
      scheduledDefaults: {
        providerId: '',
        model: '',
        reasoningEffort: 'auto',
        timeZone: ''
      }
    },
    projectBoard: {
      enabled: false
    }
  }
}

/**
 * Merge the experimental Lab section. Nested fields merge field-by-field;
 * a half-configured model override (only one of model/providerId set) is
 * treated as "follow the main session" and dropped, mirroring the pairing
 * rule enforced by the Kun runtime config schema.
 */
export function mergeKunLabSettings(
  current: KunLabSettingsV1 | undefined,
  patch: KunLabSettingsPatchV1 | undefined
): KunLabSettingsV1 {
  const defaults = defaultKunLabSettings()
  const legacyCurrent = current as Partial<KunLabSettingsV1> | undefined
  const legacyAutomatic = legacyCurrent?.autoPlanBuild
  const legacyScheduled = legacyAutomatic?.scheduledDefaults
  const base: KunLabSettingsV1 = {
    pptAgent: legacyCurrent?.pptAgent ?? defaults.pptAgent,
    conversationVisualization:
      legacyCurrent?.conversationVisualization ?? defaults.conversationVisualization,
    autoPlanBuild: {
      enabled: legacyAutomatic?.enabled ?? defaults.autoPlanBuild.enabled,
      confirmation: legacyAutomatic?.confirmation === 'defaults' ? 'defaults' : 'always',
      defaultBuildMode: legacyAutomatic?.defaultBuildMode === 'scheduled' ? 'scheduled' : 'direct',
      useWorktreeByDefault: legacyAutomatic?.useWorktreeByDefault
        ?? defaults.autoPlanBuild.useWorktreeByDefault,
      scheduledDefaults: {
        providerId: stringOrFallback(legacyScheduled?.providerId, '').trim(),
        model: stringOrFallback(legacyScheduled?.model, '').trim(),
        reasoningEffort: isModelReasoningEffortValue(legacyScheduled?.reasoningEffort)
          ? legacyScheduled.reasoningEffort
          : defaults.autoPlanBuild.scheduledDefaults.reasoningEffort,
        timeZone: stringOrFallback(legacyScheduled?.timeZone, '').trim()
      }
    },
    projectBoard: {
      enabled: legacyCurrent?.projectBoard?.enabled ?? defaults.projectBoard.enabled
    }
  }
  if (!patch) return base
  return {
    pptAgent: {
      ...mergeLabAgentSettings(base.pptAgent, patch.pptAgent),
      imageFirst: patch.pptAgent?.imageFirst ?? base.pptAgent.imageFirst
    },
    conversationVisualization: {
      enabled: patch.conversationVisualization?.enabled
        ?? base.conversationVisualization.enabled
    },
    autoPlanBuild: {
      enabled: patch.autoPlanBuild?.enabled ?? base.autoPlanBuild.enabled,
      confirmation: patch.autoPlanBuild?.confirmation === 'defaults' ||
        patch.autoPlanBuild?.confirmation === 'always'
        ? patch.autoPlanBuild.confirmation
        : base.autoPlanBuild.confirmation,
      defaultBuildMode: patch.autoPlanBuild?.defaultBuildMode === 'scheduled' ||
        patch.autoPlanBuild?.defaultBuildMode === 'direct'
        ? patch.autoPlanBuild.defaultBuildMode
        : base.autoPlanBuild.defaultBuildMode,
      useWorktreeByDefault: patch.autoPlanBuild?.useWorktreeByDefault
        ?? base.autoPlanBuild.useWorktreeByDefault,
      scheduledDefaults: {
        providerId: stringOrFallback(
          patch.autoPlanBuild?.scheduledDefaults?.providerId,
          base.autoPlanBuild.scheduledDefaults.providerId
        ).trim(),
        model: stringOrFallback(
          patch.autoPlanBuild?.scheduledDefaults?.model,
          base.autoPlanBuild.scheduledDefaults.model
        ).trim(),
        reasoningEffort: isModelReasoningEffortValue(
          patch.autoPlanBuild?.scheduledDefaults?.reasoningEffort
        )
          ? patch.autoPlanBuild.scheduledDefaults.reasoningEffort
          : base.autoPlanBuild.scheduledDefaults.reasoningEffort,
        timeZone: stringOrFallback(
          patch.autoPlanBuild?.scheduledDefaults?.timeZone,
          base.autoPlanBuild.scheduledDefaults.timeZone
        ).trim()
      }
    },
    projectBoard: {
      enabled: patch.projectBoard?.enabled ?? base.projectBoard.enabled
    }
  }
}

/** Shared merge for model-routed agent feature blocks. */
export function mergeLabAgentSettings<
  T extends { enabled: boolean; model: string; providerId: string; reasoningEffort?: ModelReasoningEffort; fast: boolean }
>(
  base: T,
  patch: Partial<T> | undefined
): T {
  if (!patch) return base
  const rawModel = stringOrFallback(patch.model, base.model).trim()
  const rawProviderId = stringOrFallback(patch.providerId, base.providerId).trim()
  const paired = rawModel !== '' && rawProviderId !== ''
  return {
    ...base,
    enabled: patch.enabled ?? base.enabled,
    model: paired ? rawModel : '',
    providerId: paired ? rawProviderId : '',
    ...(patch.reasoningEffort !== undefined
      ? isModelReasoningEffortValue(patch.reasoningEffort)
        ? { reasoningEffort: patch.reasoningEffort }
        : base.reasoningEffort !== undefined
          ? { reasoningEffort: base.reasoningEffort }
          : {}
      : base.reasoningEffort !== undefined
        ? { reasoningEffort: base.reasoningEffort }
        : {}),
    fast: patch.fast ?? base.fast
  }
}

export function stringOrFallback(value: string | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

export function isModelReasoningEffortValue(value: unknown): value is ModelReasoningEffort {
  return typeof value === 'string' && MODEL_REASONING_EFFORTS.includes(value as ModelReasoningEffort)
}

export const OPTIONAL_MODEL_SLOT_KEYS = [
  'smallModel',
  'smallModelProviderId',
  'smallModelAccountId',
  'titleModel',
  'titleProviderId',
  'titleAccountId',
  'summaryModel',
  'summaryProviderId',
  'summaryAccountId',
  'codeReviewModel',
  'codeReviewProviderId',
  'codeReviewAccountId',
  'planModel',
  'planProviderId',
  'planAccountId'
] as const

export type OptionalModelSlotKey = (typeof OPTIONAL_MODEL_SLOT_KEYS)[number]

export function mergeOptionalModelSlot(
  current: KunRuntimeSettingsV1,
  patch: KunRuntimeSettingsPatchV1 | undefined
): Partial<Record<OptionalModelSlotKey, string>> {
  const out: Partial<Record<OptionalModelSlotKey, string>> = {}
  for (const key of OPTIONAL_MODEL_SLOT_KEYS) {
    const source = patch && key in patch ? patch[key] : current[key]
    const trimmed = typeof source === 'string' ? source.trim() : ''
    if (trimmed) out[key] = trimmed
  }
  return out
}

// Per-role reasoning-depth slots (agents.kun.*ReasoningEffort). Validated against
// the ModelReasoningEffort enum; default 'off' is omitted so the field stays absent
// unless the user opts into a deeper level. Must be stripped + re-applied exactly
// like the model slots to avoid settings-sync round-trip drift.
export const OPTIONAL_REASONING_SLOT_KEYS = [
  'titleReasoningEffort',
  'summaryReasoningEffort',
  'codeReviewReasoningEffort'
] as const

export type OptionalReasoningSlotKey = (typeof OPTIONAL_REASONING_SLOT_KEYS)[number]

export function mergeOptionalReasoningSlot(
  current: KunRuntimeSettingsV1,
  patch: KunRuntimeSettingsPatchV1 | undefined
): Partial<Record<OptionalReasoningSlotKey, ModelReasoningEffort>> {
  const out: Partial<Record<OptionalReasoningSlotKey, ModelReasoningEffort>> = {}
  for (const key of OPTIONAL_REASONING_SLOT_KEYS) {
    const source = patch && key in patch ? patch[key] : current[key]
    const normalized = normalizeReasoningEffortOrUndefined(source)
    // Omit 'off' (the default) and undefined so the field stays absent.
    if (normalized && normalized !== 'off') out[key] = normalized
  }
  return out
}

export function normalizeReasoningEffortOrUndefined(
  value: unknown
): ModelReasoningEffort | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim() as ModelReasoningEffort
  return MODEL_REASONING_EFFORTS.includes(trimmed) ? trimmed : undefined
}
