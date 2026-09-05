import { createHash, randomUUID } from 'node:crypto'
import { basename, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import {
  AccountSchema,
  AgentCreateRunRequestSchema,
  AgentRunSchema,
  AgentSteerRequestSchema,
  ExtensionContributionsSchema,
  ExtensionIdSchema,
  EXTENSION_VIEW_SAFE_METHODS,
  HostMessageSchema,
  JsonValueSchema,
  LocaleSchema,
  MANIFEST_CONTRIBUTION_PERMISSION_REQUIREMENTS,
  ManifestLocaleTagSchema,
  MediaMetadataSchema,
  ProviderBindingSchema,
  ThemeSchema,
  hasPermission,
  resolveExtensionManifestLocale,
  type AgentRun,
  type AgentRunEvent,
  type ExtensionContributions,
  type ExtensionManifest,
  type JsonValue,
  type ModelProviderDeclaration,
  type ProviderModel
} from '@kun/extension-api'
import { redactSecretText } from '../../config/secret-redaction.js'
import type { ExtensionProviderDefinition } from '../../contracts/extension-providers.js'
import type {
  DevelopmentExtensionRecord,
  ExtensionRegistryEntry,
  InstalledExtensionVersion
} from '../../extensions/index.js'
import {
  extensionProviderBindingScope,
  extensionProviderId
} from '../../services/extension-provider-account-store.js'
import { requiredExtensionBrokerPermission } from '../../services/extension-host-broker.js'
import { publicAgentEvent } from '../../services/extension-host-broker-public-projection.js'
import { ExtensionConfigurationConflictError } from '../../services/extension-configuration-service.js'
import {
  ExtensionMediaHandleError,
  type MediaHandleProjection
} from '../../services/extension-media-handle-service.js'
import {
  ExtensionBrokerError,
  type ExtensionAgentEvent,
  type ExtensionAgentRun,
  type ExtensionAgentSubscription,
  type ExtensionOwnedThread,
  type ExtensionPrincipal
} from '../../services/extension-agent-service.js'
import {
  ExtensionViewSessionError,
  type ExtensionViewSessionEvent,
  type ExtensionViewSessionTarget
} from '../../services/extension-view-session-service.js'
import { bearerToken, isRuntimeTokenAuthorized } from '../auth.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { Router, type RouteContext, type RouteHandler } from '../router.js'
import type { ExtensionPlatformRuntime, ServerRuntime } from './server-runtime.js'
import { ERRORS } from './runtime-error.js'
import {
  EXTENSION_SESSION_ID_HEADER,
  EXTENSION_SESSION_NONCE_HEADER,
  MAX_EXTENSION_VIEW_BODY_BYTES,
  MAX_EXTENSION_AGENT_BODY_BYTES,
  DEFAULT_EVENT_LIMIT,
  MAX_EVENT_LIMIT,
  HEARTBEAT_INTERVAL_MS,
  SessionIdSchema,
  RunIdSchema,
  ThreadIdSchema,
  ProviderIdSchema,
  LocalProviderIdSchema,
  AccountIdSchema,
  WorkspaceRootSchema,
  CreateViewSessionSchema,
  QualifiedSettingContributionSchema,
  ConfigurationSnapshotRequestSchema,
  ConfigurationUpdateRequestSchema,
  WorkbenchEnvironmentSchema,
  ViewBrokerRequestSchema,
  ViewRequestIdSchema,
  InvokeExtensionCommandSchema,
  ManagedAccountSessionSchema,
  ManagedProviderCatalogQuerySchema,
  ManagedProviderModelsQuerySchema,
  ManagedProviderBindingSchema,
  ManagedAccountSessionActionSchema,
  ManagedAccountSessionCompletionSchema,
  ManagedApiKeyAccountSchema,
  ManagedDeleteAccountSchema,
  ManagedRenameAccountSchema,
  ManagedReplaceApiKeyAccountSchema,
  SecretRevealDecisionSchema,
  WorkbenchNotificationResponseSchema,
  WorkbenchNotificationIdSchema,
  ProtectedMediaViewBindingSchema,
  ProtectedMediaSelectionRegistrationSchema,
  ProtectedMediaLeaseResolutionSchema,
  ProtectedArtifactResolutionSchema,
  VIEW_BROKER_METHODS,
  ProviderProbeSchema,
  WORKBENCH_CONTRIBUTION_KEYS,
  VIEW_CONTRIBUTION_KEYS,
  SelectedExtension
} from './extension-public-schemas.js'
import { isObject } from './extension-public-common.js'

export function projectProvider(provider: ExtensionProviderDefinition) {
  return {
    id: provider.id,
    displayName: provider.displayName,
    description: provider.description,
    authenticationTypes: [...provider.authTypes],
    capabilities: structuredClone(provider.capabilities),
    ownerExtensionId: provider.ownerExtensionId,
    ownerExtensionVersion: provider.ownerExtensionVersion,
    updatedAt: provider.updatedAt
  }
}

export function projectAgentRun(run: ExtensionAgentRun): AgentRun {
  const binding = run.providerBinding.accountId
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
        ...(binding ? { providerBinding: binding } : {}),
        allowedTools: run.profile.allowedToolScopes,
        budget: publicBudget(run.effectiveBudget)
      }
    } : {}),
    extensionBudget: publicBudget(run.effectiveBudget),
    toolCatalogEpoch: run.toolCatalogEpoch?.id ?? 'epoch:none',
    state: run.status,
    model: run.providerBinding.modelId,
    ...(binding ? { providerBinding: binding } : {}),
    ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
    ...(run.usage ? { usage: publicUsage(run.usage) } : {}),
    createdAt: run.createdAt,
    updatedAt: run.finishedAt ?? run.createdAt,
    ...(run.finishedAt ? { terminalAt: run.finishedAt } : {}),
    ...(run.error ? { error: { code: 'agent_run_failed', message: run.error.slice(0, 4096) } } : {})
  })
}

export function projectAgentEvent(event: ExtensionAgentEvent): AgentRunEvent | undefined {
  if (isInternalGoalContextEvent(event)) return undefined
  return publicAgentEvent(event)
}

/**
 * ExtensionAgentService is the primary boundary, but keep the HTTP/SSE
 * projection defensive for legacy persisted records and future producers.
 */
export function isInternalGoalContextEvent(event: ExtensionAgentEvent): boolean {
  const item = event.payload.item
  return isObject(item) && item.kind === 'goal_context'
}

/** Map an internal runtime high-water mark to the one-based public cursor. */
export function agentCursorAfterSubscription(
  cursor: number,
  afterSeq: number,
  lastDeliveredSeq: number
): number {
  // `lastDeliveredSeq` starts at `afterSeq`, so only map it when subscribe()
  // actually consumed another runtime event. This preserves cursor=0 for an
  // empty stream while still advancing private-only replay to seq + 1.
  return lastDeliveredSeq > afterSeq ? Math.max(cursor, lastDeliveredSeq + 1) : cursor
}

export function projectOwnedThread(principal: ExtensionPrincipal, thread: ExtensionOwnedThread) {
  return {
    id: thread.id,
    title: thread.title,
    ownerExtensionId: principal.extensionId,
    ownerExtensionVersion: thread.ownerExtensionVersion,
    extensionVisibility: thread.visibility,
    workspace: thread.workspace,
    ...(thread.latestRun ? { latestRun: projectAgentRun(thread.latestRun) } : {}),
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
  cachedTokens?: number
  costUsd?: number
  costCny?: number
}) {
  return {
    ...(usage.promptTokens !== undefined ? { inputTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens !== undefined ? { outputTokens: usage.completionTokens } : {}),
    ...(usage.cachedTokens !== undefined ? { cacheReadTokens: usage.cachedTokens } : {}),
    ...(usage.costUsd !== undefined
      ? { cost: usage.costUsd, currency: 'USD' }
      : usage.costCny !== undefined ? { cost: usage.costCny, currency: 'CNY' } : {})
  }
}

export function agentInputText(input: z.infer<typeof AgentCreateRunRequestSchema>['input']): string {
  if (typeof input === 'string') return input
  return input.content.map((part) => {
    if (part.type === 'text') return part.text
    return `[${part.type}${'name' in part && part.name ? `: ${part.name}` : ''}; ${part.mimeType}]`
  }).join('\n')
}
