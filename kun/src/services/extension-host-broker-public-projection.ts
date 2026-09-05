import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  AccountSchema,
  ArtifactHostActionRequestSchema,
  ArtifactHostActionResultSchema,
  AgentCancelRequestSchema,
  AgentCreateRunRequestSchema,
  AgentRunEventSchema,
  AgentRunSchema,
  AgentSteerRequestSchema,
  AgentSubscribeRequestSchema,
  AuthenticatedFetchRequestSchema,
  CreateAccountSessionRequestSchema,
  ExtensionToolDeclarationSchema,
  JsonObjectSchema,
  JsonValueSchema,
  ListAccountsRequestSchema,
  ListOwnThreadsRequestSchema,
  JobCancelRequestSchema,
  JobGetRequestSchema,
  JobListRequestSchema,
  JobSnapshotSchema,
  MediaAudioAnalysisCapabilitiesSchema,
  MediaAnalyzeVisualFramesRequestSchema,
  MediaAnalyzeVisualFramesResultSchema,
  MediaEmbedVisualQueryRequestSchema,
  MediaEmbedVisualQueryResultSchema,
  MediaInstallVisualModelRequestSchema,
  MediaMetadataSchema,
  MediaCapabilitiesSchema,
  MediaCreateCacheTargetRequestSchema,
  MediaCreateCacheTargetResultSchema,
  MediaOpenViewResourceRequestSchema,
  MediaPickFilesRequestSchema,
  MediaPickFilesResultSchema,
  MediaPickSaveTargetRequestSchema,
  MediaPickSaveTargetResultSchema,
  MediaProbeRequestSchema,
  MediaProbeResultSchema,
  MediaReadTextRequestSchema,
  MediaReadTextResultSchema,
  MediaReleaseRequestSchema,
  MediaResourceLeaseSchema,
  MediaStartFfmpegJobRequestSchema,
  MediaStartAudioAnalysisJobRequestSchema,
  MediaStartAudioAnalysisJobResultSchema,
  MediaStartArchiveJobRequestSchema,
  MediaStartArchiveJobResultSchema,
  MediaVisualModelStatusSchema,
  ModelProviderDeclarationSchema,
  ModelProviderStreamEventSchema,
  NetworkRequestSchema,
  ProviderBindingSchema,
  RevealSecretRequestSchema,
  ToolProgressSchema,
  ToolResultSchema,
  WorkspaceFileSchema,
  type Account,
  type AccountSession,
  type AgentRun,
  type AgentRunEvent,
  type AuthenticationProviderDeclaration,
  type CommandContribution,
  type ExtensionManifest,
  type JsonValue as PublicJsonValue,
  type ModelProviderAdapter,
  type ModelProviderRequest,
  type ModelProviderStreamEvent,
  type ProviderBinding
} from '@kun/extension-api'
import type { ExtensionModelProviderRegistry } from '../adapters/model/extension-model-provider.js'
import type { ExtensionToolRegistry } from '../adapters/tool/extension-tool-provider.js'
import type { ToolExecutionUpdate } from '../ports/tool-host.js'
import type {
  ExtensionBrokerRequest,
  ExtensionPrincipal as HostExtensionPrincipal
} from '../extensions/host-process.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { JsonValue } from '../extensions/types.js'
import type { ExtensionStateStore } from '../extensions/state-store.js'
import {
  assertBrokeredNetworkUrl,
  createSafeNetworkFetch,
  normalizedBrokerHostname
} from '../extensions/safe-network-fetch.js'
import {
  extensionProviderBindingScope,
  extensionProviderId,
  type ExtensionProviderAccountStore
} from './extension-provider-account-store.js'
import type { ExtensionAccountBroker } from './extension-account-broker.js'
import type { ExtensionCredentialStore } from './extension-credential-store.js'
import type { ExtensionConfigurationService } from './extension-configuration-service.js'
import type { ExtensionArtifactService } from './extension-artifact-service.js'
import type { ExtensionMediaHandleService, MediaHandleProjection } from './extension-media-handle-service.js'
import type { ExtensionMediaProcessService } from './extension-media-process-service.js'
import type { ExtensionMediaJobService } from './extension-media-job-service.js'
import type { ExtensionAudioAnalysisJobService } from './extension-audio-analysis-job-service.js'
import type { ExtensionMediaArchiveJobService } from './extension-media-archive-job-service.js'
import type { ExtensionVisualAnalysisService } from './extension-visual-analysis-service.js'
import type { ExtensionJobService } from './extension-job-service.js'
import type { ExtensionJobSubscription } from './extension-job-subscription.js'
import type {
  ExtensionAgentEvent,
  ExtensionAgentRun,
  ExtensionAgentService,
  ExtensionAgentSubscription,
  ExtensionOwnedThread,
  ExtensionPrincipal
} from './extension-agent-service.js'
import type { ExtensionAgentProfileRegistry } from './extension-agent-profile-registry.js'
import {
  compileExtensionJsonSchema,
  type ExtensionJsonSchemaValidator
} from '../extensions/json-schema-validator.js'
import { extensionError } from '../extensions/errors.js'
import { RegistrationIdSchema, RegistrationRequestSchema, RunIdSchema, ThreadIdSchema, SubscriptionIdSchema, StorageRequestSchema, StorageKeysRequestSchema, StorageSetRequestSchema, ConfigurationSectionSchema, ConfigurationRequestSchema, ConfigurationUpdateRequestSchema, CommandRegisterSchema, CommandExecuteSchema, ModelStreamNotificationSchema, ModelStreamEnvelopePayloadSchema, DEFAULT_PROVIDER_STREAM_QUEUE_EVENTS, DEFAULT_PROVIDER_STREAM_QUEUE_BYTES, type ExtensionHostBrokerOptions, type ToolRegistration, type ProviderRegistration, type AgentSubscription, type JobSubscription, type CommandRegistration, type StoredAccountSession, type ExtensionBrokerDispatchRequest, type ProviderStreamEntry, hostPrincipal, boundedError, providerCapabilities, resolveAuthentication, effectiveAuthenticationScopes, internalAuthenticationType, toolSideEffect, activationEventFor, requireManifestContribution, assertManifestDeclarationMatches, canonicalizeJson, expandProviderPermissions, requiredWorkspaceKey, viewStateKey, confinedWorkspacePath, verifyWorkspaceTarget, inside, assertNetworkPermission, responseProjection, readBoundedResponseBody, linkedAbortController, agentInputText, cancellationSignal, providerStreamKey, providerQueueLimitError, serializedQueueBytes, positiveQueueLimit, safeJsonObject, toPublicJson, toJson, isObject, AsyncEventQueue } from './extension-host-broker-core.js'

/** Fast pre-gate for fixed permissions. Dynamic account/network scopes are checked by the broker. */
export function requiredExtensionBrokerPermission(method: string, params: JsonValue): string | undefined {
  if (method.startsWith('commands.')) return 'commands.register'
  if (method.startsWith('agent.')) return 'agent.run'
  if (method.startsWith('threads.')) return 'agent.threads.readOwn'
  if (method.startsWith('tools.')) return 'tools.register'
  if (method.startsWith('modelProviders.')) return 'providers.register'
  if (method === 'authentication.listAccounts') return 'accounts.read'
  if (method === 'workspace.writeFile') return 'workspace.write'
  if (method.startsWith('workspace.')) return 'workspace.read'
  if (method === 'media.pickSaveTarget') return 'media.export'
  if (method === 'media.startArchiveJob') return 'media.export'
  if (method === 'media.createCacheTarget') return 'media.process'
  if (
    method === 'media.getCapabilities' ||
    method === 'media.getAudioAnalysisCapabilities' ||
    method === 'media.getVisualModelStatus' ||
    method === 'media.installVisualModel' ||
    method === 'media.analyzeVisualFrames' ||
    method === 'media.embedVisualQuery' ||
    method === 'media.probe' ||
    method === 'media.startFfmpegJob' ||
    method === 'media.startAudioAnalysisJob'
  ) return 'media.process'
  if (
    method === 'media.pickFiles' ||
    method === 'media.stat' ||
    method === 'media.readText' ||
    method === 'media.openViewResource' ||
    method === 'media.performArtifactAction'
  ) {
    return 'media.read'
  }
  if (method.startsWith('jobs.')) return 'jobs.manage'
  if (method.startsWith('secrets.')) return 'storage.secrets'
  if (method.startsWith('storage.global')) return 'storage.global'
  if (method.startsWith('storage.workspace')) return 'storage.workspace'
  if (method.startsWith('storage.')) {
    const scope = isObject(params) && params.scope === 'global' ? 'global' : 'workspace'
    return `storage.${scope}`
  }
  if (method.startsWith('configuration.')) return 'ui.actions'
  if (method === 'ui.showNotification') return 'ui.notifications'
  if (method === 'ui.attachComposerContext') return 'ui.actions'
  if (method.startsWith('ui.')) return 'ui.views'
  return undefined
}

export function publicMediaMetadata(
  handle: MediaHandleProjection,
  includeWorkspaceLocation = true
) {
  const kind = handle.mimeType.startsWith('video/')
    ? 'video'
    : handle.mimeType.startsWith('audio/')
      ? 'audio'
      : handle.mimeType.startsWith('image/')
        ? 'image'
        : handle.mimeType === 'text/vtt' || handle.mimeType === 'application/x-subrip'
          ? 'subtitle'
          : handle.mimeType === 'application/octet-stream'
            ? 'unknown'
            : 'data'
  return MediaMetadataSchema.parse({
    handleId: handle.id,
    mode: handle.mode === 'write' ? 'export' : 'read',
    kind,
    displayName: handle.displayName,
    mimeType: handle.mimeType,
    ...(handle.byteSize !== undefined ? { byteSize: handle.byteSize } : {}),
    ...(handle.modifiedAt ? { modifiedAt: handle.modifiedAt } : {}),
    ...(handle.mode === 'read' && handle.lastAccessedAt
      ? { lastAccessedAt: handle.lastAccessedAt }
      : {}),
    ...(handle.completionIdentity ? { completionIdentity: handle.completionIdentity } : {}),
    ...(includeWorkspaceLocation && handle.workspaceRelativePath
      ? { workspaceRelativeDisplayLocation: handle.workspaceRelativePath }
      : {}),
    revoked: !handle.available
  })
}

export function cacheFormat(format: 'png' | 'jpeg' | 'mp4' | 'webm' | 'wav'): {
  extension: string
  mimeType: string
} {
  switch (format) {
    case 'png': return { extension: 'png', mimeType: 'image/png' }
    case 'jpeg': return { extension: 'jpg', mimeType: 'image/jpeg' }
    case 'mp4': return { extension: 'mp4', mimeType: 'video/mp4' }
    case 'webm': return { extension: 'webm', mimeType: 'video/webm' }
    case 'wav': return { extension: 'wav', mimeType: 'audio/wav' }
  }
}

export function publicMediaCapability(capability: {
  name: 'ffprobe' | 'ffmpeg'
  available: boolean
  version?: string
  features?: string[]
}) {
  return {
    name: capability.name,
    available: capability.available,
    ...(capability.version ? { version: capability.version.slice(0, 512) } : {}),
    features: capability.features ?? []
  }
}

export function jobCaller(principal: ExtensionPrincipal) {
  return {
    extensionId: principal.extensionId,
    workspaceIds: principal.workspaceRoots.map(extensionWorkspaceKey)
  }
}

export function hostOwnsRegistration(
  principal: ExtensionPrincipal,
  entry: { extensionId: string; hostLifecycleNonce?: string } | undefined
): boolean {
  return Boolean(
    entry &&
    principal.hostLifecycleNonce &&
    entry.extensionId === principal.extensionId &&
    entry.hostLifecycleNonce === principal.hostLifecycleNonce
  )
}

export function registrationOwnedByPrincipal(
  entry: {
    extensionId: string
    hostLifecycleNonce?: string
    viewSessionId?: string
  } | undefined,
  principal: ExtensionPrincipal
): boolean {
  if (!entry || entry.extensionId !== principal.extensionId) return false
  if (principal.viewSessionId !== undefined) {
    return entry.viewSessionId === principal.viewSessionId
  }
  return hostOwnsRegistration(principal, entry)
}

export function normalizedRegistrationWorkspaceRoots(workspaceRoots: readonly string[]): string[] {
  return [...new Set(workspaceRoots.map((root) => resolve(root)))].sort()
}

export function registrationIncludesWorkspace(
  entry: { workspaceRoots: readonly string[] },
  workspaceId: string
): boolean {
  return entry.workspaceRoots.some((root) => extensionWorkspaceKey(root) === workspaceId)
}

export function sameRegistrationWorkspace(
  left: readonly string[],
  right: readonly string[]
): boolean {
  const normalizedLeft = normalizedRegistrationWorkspaceRoots(left)
  const normalizedRight = normalizedRegistrationWorkspaceRoots(right)
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((root, index) => root === normalizedRight[index])
}

export function publicAgentRun(run: ExtensionAgentRun): AgentRun {
  const providerBinding = run.providerBinding.accountId
    ? ProviderBindingSchema.parse({ ...run.providerBinding, accountId: run.providerBinding.accountId })
    : undefined
  return AgentRunSchema.parse({
    id: run.id,
    threadId: run.threadId,
    ownerExtensionId: run.ownerExtensionId,
    ownerExtensionVersion: run.ownerExtensionVersion,
    ...(run.providerBinding.accountId ? { accountId: run.providerBinding.accountId } : {}),
    extensionVisibility: run.visibility,
    ...(run.profile ? {
      extensionProfile: {
        id: run.profile.id,
        instructionDigest: run.profile.instructionDigest,
        ...(providerBinding ? { providerBinding } : {}),
        allowedTools: run.profile.allowedToolScopes,
        budget: publicBudget(run.effectiveBudget)
      }
    } : {}),
    extensionBudget: publicBudget(run.effectiveBudget),
    toolCatalogEpoch: run.toolCatalogEpoch?.id ?? 'epoch:none',
    state: publicRunState(run.status),
    model: run.providerBinding.modelId,
    ...(providerBinding ? { providerBinding } : {}),
    ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
    ...(run.usage ? { usage: publicUsage(run.usage) } : {}),
    createdAt: run.createdAt,
    updatedAt: run.finishedAt ?? run.createdAt,
    ...(run.finishedAt ? { terminalAt: run.finishedAt } : {}),
    ...(run.error ? { error: { code: 'agent_run_failed', message: run.error.slice(0, 4096) } } : {})
  })
}

export function publicAgentEvent(event: ExtensionAgentEvent): AgentRunEvent {
  const base = {
    runId: event.runId,
    threadId: event.threadId,
    sequence: event.seq + 1,
    timestamp: event.timestamp
  }
  if (
    typeof event.payload.messageId === 'string' &&
    (event.payload.role === 'user' || event.payload.role === 'assistant' || event.payload.role === 'tool') &&
    (event.payload.phase === 'delta' || event.payload.phase === 'replace' || event.payload.phase === 'complete')
  ) {
    return AgentRunEventSchema.parse({
      ...base,
      type: 'message',
      messageId: event.payload.messageId,
      role: event.payload.role,
      phase: event.payload.phase,
      content: toPublicJson(event.payload.content)
    })
  }
  if (event.type === 'turn_started') return AgentRunEventSchema.parse({ ...base, type: 'state', state: 'running' })
  if (event.type === 'approval_requested') return AgentRunEventSchema.parse({ ...base, type: 'state', state: 'waiting-approval' })
  if (event.type === 'user_input_requested') return AgentRunEventSchema.parse({ ...base, type: 'state', state: 'waiting-user-input' })
  if (event.type === 'approval_resolved' || event.type === 'user_input_resolved') {
    return AgentRunEventSchema.parse({ ...base, type: 'state', state: 'running' })
  }
  if (event.type === 'turn_completed') return AgentRunEventSchema.parse({ ...base, type: 'terminal', state: 'completed' })
  if (event.type === 'turn_aborted') return AgentRunEventSchema.parse({ ...base, type: 'terminal', state: 'cancelled' })
  if (event.type === 'turn_failed') return AgentRunEventSchema.parse({
    ...base,
    type: 'terminal',
    state: 'failed',
    error: isObject(event.payload.error) ? safeJsonObject(event.payload.error) : { code: 'agent_run_failed', message: 'Agent run failed' }
  })
  if (event.type === 'usage') {
    const usage = isObject(event.payload.usage) ? publicUsage(event.payload.usage as never) : {}
    return AgentRunEventSchema.parse({ ...base, type: 'usage', usage })
  }
  if (event.type === 'subscription_overflow') {
    return AgentRunEventSchema.parse({
      ...base,
      type: 'progress',
      message: 'subscription_overflow',
      data: {
        resumeAfterSequence: typeof event.payload.resumeAfterSeq === 'number'
          ? event.payload.resumeAfterSeq + 1
          : base.sequence
      }
    })
  }
  return AgentRunEventSchema.parse({
    ...base,
    type: 'progress',
    message: typeof event.payload.message === 'string' ? event.payload.message : event.type,
    ...(event.payload.data !== undefined ? { data: toPublicJson(event.payload.data) } : {})
  })
}

export function publicOwnedThread(principal: ExtensionPrincipal, thread: ExtensionOwnedThread) {
  return {
    id: thread.id,
    title: thread.title,
    ownerExtensionId: principal.extensionId,
    ownerExtensionVersion: thread.ownerExtensionVersion,
    extensionVisibility: thread.visibility,
    workspace: thread.workspace,
    ...(thread.latestRun ? { latestRun: publicAgentRun(thread.latestRun) } : {}),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt
  }
}

export function publicBudget(budget: ExtensionAgentRun['effectiveBudget']) {
  return {
    maxTokens: budget.maxTokens,
    maxElapsedMs: budget.maxElapsedMs,
    maxModelRequests: budget.maxModelRequests,
    maxToolInvocations: budget.maxToolInvocations,
    maxEvents: budget.maxRetainedEvents
  }
}

export function publicUsage(usage: {
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cachedTokens?: number
  cacheWriteTokens?: number
  costUsd?: number
  costCny?: number
  costByCurrency?: Record<string, number>
}) {
  const reportedCosts = usage.costByCurrency ?? (
    usage.costUsd !== undefined ? { USD: usage.costUsd } :
      usage.costCny !== undefined ? { CNY: usage.costCny } : {}
  )
  const costEntries = Object.entries(reportedCosts)
  return {
    ...(usage.promptTokens !== undefined ? { inputTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens !== undefined ? { outputTokens: usage.completionTokens } : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(usage.cachedTokens !== undefined ? { cacheReadTokens: usage.cachedTokens } : {}),
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(costEntries.length === 1
      ? { cost: costEntries[0]![1], currency: costEntries[0]![0] }
      : {})
  }
}

export function publicRunState(status: ExtensionAgentRun['status']) {
  if (status === 'cancelled') return 'cancelled' as const
  if (status === 'budget-exhausted') return 'budget-exhausted' as const
  return status
}

export function publicAccount(account: {
  id: string
  providerId: string
  label: string
  authType: 'api-key' | 'oauth-pkce' | 'oauth-device'
  status: string
  metadata: Record<string, string | number | boolean | null>
  createdAt: string
  updatedAt: string
  expiresAt?: string
}, protection: Account['protection'] | undefined): Account {
  return {
    id: account.id,
    providerId: account.providerId,
    label: account.label,
    authenticationType: account.authType === 'oauth-pkce'
      ? 'oauth2-pkce'
      : account.authType === 'oauth-device' ? 'device-code' : 'api-key',
    status: account.status as Account['status'],
    metadata: account.metadata,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    ...(account.expiresAt ? { expiresAt: account.expiresAt } : {}),
    ...(protection ? { protection } : {})
  }
}

export function publicAccountSession(
  session: StoredAccountSession,
  exposeInteractiveMaterial = false
): AccountSession {
  const {
    extensionId: _extensionId,
    lastTouchedAt: _lastTouchedAt,
    transactionId: _transactionId,
    providerId: _providerId,
    kind: _kind,
    ...value
  } = session
  if (exposeInteractiveMaterial && session.status === 'pending') return structuredClone(value)
  const {
    verificationUrl: _verificationUrl,
    userCode: _userCode,
    ...redacted
  } = value
  if (session.status === 'pending') {
    redacted.message = 'Interaction required. Continue in Kun Settings > Extensions > Provider accounts.'
  }
  return structuredClone(redacted)
}
