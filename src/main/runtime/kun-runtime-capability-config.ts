import type { KunRuntimeSettingsV1 } from '../../shared/app-settings'
import type { WritePaperModeSearchSettingsV1 } from '../../shared/app-settings-types-paper-mode'
import { resolveCodexOAuthApiKey } from '../codex-auth'
import { resolveGrokMediaOAuthApiKey } from '../grok-auth'

export function graphConfigForRuntime(
  value: Pick<KunRuntimeSettingsV1, 'graph'>['graph']
): KunRuntimeSettingsV1['graph'] {
  return {
    ...value,
    workerModel: { ...value.workerModel },
    scheduler: { ...value.scheduler },
    context: { ...value.context },
    mailbox: { ...value.mailbox },
    supervision: { ...value.supervision },
    writeIsolation: { ...value.writeIsolation },
    routing: { ...value.routing },
    learning: { ...value.learning },
    retention: { ...value.retention }
  }
}

export function computerUseConfigForRuntime(
  value: Pick<KunRuntimeSettingsV1, 'computerUse'>['computerUse'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existing,
    enabled: value.enabled,
    mode: value.mode,
    maxImageDimension: value.maxImageDimension,
    maxActionsPerTurn: value.maxActionsPerTurn
  }
}

export function browserUseConfigForRuntime(
  value: Pick<KunRuntimeSettingsV1, 'browserUse'>['browserUse'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existing,
    enabled: value.enabled,
    mode: value.mode,
    approvalMode: value.approvalMode,
    maxTabs: value.maxTabs,
    maxObservationActionsPerTurn: value.maxObservationActionsPerTurn,
    maxInteractionActionsPerTurn: value.maxInteractionActionsPerTurn,
    maxSnapshotNodes: value.maxSnapshotNodes,
    maxSnapshotTextChars: value.maxSnapshotTextChars,
    maxImageDimension: value.maxImageDimension,
    idleTimeoutMs: value.idleTimeoutMs
  }
}

export function imageGenConfigForRuntime(
  value: Pick<KunRuntimeSettingsV1, 'imageGeneration'>['imageGeneration'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...existing,
    enabled: value.enabled,
    timeoutMs: value.timeoutMs
  }
  const providerId = value.providerId.trim()
  const resolvedApiKey = value.protocol === 'grok-imagine-image'
    ? resolveGrokMediaOAuthApiKey(value.apiKey)
    : resolveCodexOAuthApiKey(value.apiKey)
  applyTrimmedFields(next, {
    protocol: value.protocol,
    providerId,
    baseUrl: value.baseUrl,
    apiKey: providerId ? '' : resolvedApiKey.apiKey,
    model: value.model,
    defaultResolution: value.defaultResolution,
    defaultSize: value.defaultSize,
    quality: value.quality
  })
  if (!providerId && resolvedApiKey.headers) next.headers = resolvedApiKey.headers
  else delete next.headers
  return next
}

export function speechGenConfigForRuntime(
  value: Pick<KunRuntimeSettingsV1, 'textToSpeech'>['textToSpeech'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...existing,
    enabled: value.enabled,
    timeoutMs: value.timeoutMs,
    format: value.format
  }
  const providerId = value.providerId.trim()
  applyTrimmedFields(next, {
    protocol: value.protocol,
    providerId,
    baseUrl: value.baseUrl,
    apiKey: providerId ? '' : value.apiKey,
    model: value.model,
    voice: value.voice
  })
  return next
}

export function musicGenConfigForRuntime(
  value: Pick<KunRuntimeSettingsV1, 'musicGeneration'>['musicGeneration'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...existing,
    enabled: value.enabled,
    timeoutMs: value.timeoutMs,
    format: value.format
  }
  const providerId = value.providerId.trim()
  applyTrimmedFields(next, {
    protocol: value.protocol,
    providerId,
    baseUrl: value.baseUrl,
    apiKey: providerId ? '' : value.apiKey,
    model: value.model
  })
  return next
}

export function videoGenConfigForRuntime(
  value: Pick<KunRuntimeSettingsV1, 'videoGeneration'>['videoGeneration'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...existing,
    enabled: value.enabled,
    defaultDuration: value.defaultDuration,
    timeoutMs: value.timeoutMs,
    pollIntervalMs: value.pollIntervalMs
  }
  const providerId = value.providerId.trim()
  const resolvedApiKey = value.protocol === 'grok-imagine-video'
    ? resolveGrokMediaOAuthApiKey(value.apiKey)
    : { apiKey: value.apiKey }
  applyTrimmedFields(next, {
    protocol: value.protocol,
    providerId,
    baseUrl: value.baseUrl,
    apiKey: providerId ? '' : resolvedApiKey.apiKey,
    model: value.model,
    defaultResolution: value.defaultResolution
  })
  if (!providerId && resolvedApiKey.headers) next.headers = resolvedApiKey.headers
  else delete next.headers
  return next
}

export function runtimeTuningConfigForRuntime(
  value: Pick<KunRuntimeSettingsV1, 'runtimeTuning'>['runtimeTuning'],
  existing: Record<string, unknown>,
  llmDebug: Pick<KunRuntimeSettingsV1, 'llmDebug'>['llmDebug']
): Record<string, unknown> {
  return {
    ...existing,
    turnLimits: {
      ...objectValue(existing.turnLimits),
      maxConcurrentTurns: value.maxConcurrentTurns,
      maxWallTimeMs: value.maxWallTimeMs
    },
    streamIdleTimeoutMs: value.streamIdleTimeoutMs,
    llmDebug: {
      ...objectValue(existing.llmDebug),
      enabled: objectValue(existing.llmDebug).enabled !== false,
      defaultThreadCaptureEnabled: llmDebug.defaultThreadCaptureEnabled
    },
    toolStorm: {
      ...objectValue(existing.toolStorm),
      enabled: value.toolStorm.enabled
    },
    toolArgumentRepair: {
      ...objectValue(existing.toolArgumentRepair),
      maxStringBytes: value.toolArgumentRepair.maxStringBytes
    },
    interruptedTurnResume: {
      ...objectValue(existing.interruptedTurnResume),
      enabled: value.interruptedTurnResume.enabled
    }
  }
}

export function qualityConfigForRuntime(
  value: Pick<KunRuntimeSettingsV1, 'quality'>['quality'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existing,
    enabled: value.enabled,
    strictness: value.strictness,
    ignoreRules: [...value.ignoreRules],
    ignoreFiles: [...value.ignoreFiles],
    maxFindings: value.maxFindings
  }
}

function applyTrimmedFields(
  target: Record<string, unknown>,
  fields: Record<string, string>
): void {
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value.trim()
    if (trimmed) target[key] = trimmed
    else delete target[key]
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * `capabilities.paperSearch` for the persisted config: source allow-list and
 * polite-pool identifiers only. API keys never land in kun.config.json — the
 * hot-apply body and launch env carry them in process memory instead.
 */
export function paperSearchConfigForRuntime(
  search: WritePaperModeSearchSettingsV1 | undefined,
  fallbackMailto: string,
  existing: Record<string, unknown>
): Record<string, unknown> {
  if (!search) return existing
  return {
    ...existing,
    enabledSources: [...search.enabledSources],
    openAlexMailto: search.openAlexMailto || fallbackMailto,
    unpaywallEmail: search.unpaywallEmail
  }
}

/** In-memory secret fields injected into the hot-apply body only. */
export function paperSearchSecretsForRuntime(
  search: WritePaperModeSearchSettingsV1 | undefined,
  scholarApiKey: string
): Record<string, unknown> {
  if (!search) return {}
  return {
    semanticScholarApiKey: search.semanticScholarApiKey || scholarApiKey,
    coreApiKey: search.coreApiKey
  }
}
