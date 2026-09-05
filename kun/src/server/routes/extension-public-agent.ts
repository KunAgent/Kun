import { createHash, randomUUID } from 'node:crypto'
import { basename, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import {
  AccountSchema,
  AgentCreateRunRequestSchema,
  AgentRunEventSchema,
  AgentRunStateSchema,
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
import {
  assertOwnedAccount,
  expandProviderPermissions,
  parseBody,
  parseQuery,
  requireAccountUse,
  requirePermission,
  resolveOwnedProviderId,
  selectExtension
} from './extension-public-common.js'
import {
  agentCursorAfterSubscription,
  agentInputText,
  projectAgentEvent,
  projectAgentRun,
  projectOwnedThread,
  projectProvider
} from './extension-public-projections.js'
import {
  acceptsSse,
  buildAgentEventStream,
  parseEventQuery
} from './extension-public-streams.js'

export async function createAgentRun(
  platform: ExtensionPlatformRuntime,
  principalInput: ExtensionPrincipal,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, AgentCreateRunRequestSchema, MAX_EXTENSION_AGENT_BODY_BYTES)
  if (!body.ok) return body.response
  const principal = await expandProviderPermissions(platform, principalInput)
  let binding = body.data.providerBinding
    ? {
        ...body.data.providerBinding,
        providerId: await resolveOwnedProviderId(platform, principal, body.data.providerBinding.providerId)
      }
    : undefined
  if (!binding && body.data.profileId) {
    const entry = await platform.registry.get(principal.extensionId)
    const manifest = entry
      ? selectExtension(platform, entry, body.data.workspace ?? principal.workspaceRoots[0])?.selected.manifest
      : undefined
    const localProfileId = body.data.profileId.startsWith(`${principal.extensionId}/`)
      ? body.data.profileId.slice(principal.extensionId.length + 1)
      : body.data.profileId
    const profileBinding = manifest?.contributes.agentProfiles.find(
      (profile) => profile.id === localProfileId
    )?.providerBinding
    if (profileBinding) {
      const providerId = await resolveOwnedProviderId(platform, principal, profileBinding.providerId)
      const stored = profileBinding.accountId
        ? undefined
        : await platform.providerAccounts.getBinding(
            extensionProviderBindingScope(body.data.workspace ?? principal.workspaceRoots[0]),
            providerId
          )
      if (
        !profileBinding.accountId &&
        (!stored ||
          stored.ownerExtensionId !== principal.extensionId ||
          stored.ownerExtensionVersion !== principal.extensionVersion)
      ) {
        throw new ExtensionBrokerError(
          'validation_error',
          `Connected account binding is required for extension provider profile: ${localProfileId}`
        )
      }
      binding = {
        providerId,
        accountId: profileBinding.accountId ?? stored!.binding.accountId,
        modelId: profileBinding.modelId
      }
    }
  }
  if (binding) await platform.providerAccounts.validateBinding(binding)
  const run = await platform.agent.createRun(principal, {
    input: agentInputText(body.data.input),
    ...(body.data.threadId ? { threadId: body.data.threadId } : {}),
    ...(body.data.workspace ? { workspace: body.data.workspace } : {}),
    ...(body.data.model ? { model: body.data.model } : {}),
    ...(body.data.reasoningEffort ? { reasoningEffort: body.data.reasoningEffort } : {}),
    ...(body.data.profileId ? { profileId: body.data.profileId } : {}),
    ...(binding ? { providerBinding: binding } : {}),
    ...(body.data.budget ? {
      budget: {
        ...body.data.budget,
        ...(body.data.budget.maxEvents ? { maxRetainedEvents: body.data.budget.maxEvents } : {})
      }
    } : {}),
    ...(body.data.allowedTools ? { allowedTools: body.data.allowedTools } : {}),
    ...(body.data.visibility ? { visibility: body.data.visibility } : {})
  })
  return jsonResponse({ schemaVersion: 1, run: projectAgentRun(run), createdThread: !body.data.threadId }, 201)
}

export async function getAgentRun(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  context: RouteContext
): Promise<JsonResponse> {
  const runId = RunIdSchema.parse(context.params.runId)
  return jsonResponse({ schemaVersion: 1, run: projectAgentRun(await platform.agent.getRun(principal, runId)) })
}

export async function steerAgentRun(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const runId = RunIdSchema.parse(context.params.runId)
  const body = await parseBody(request, AgentSteerRequestSchema.omit({ runId: true }), MAX_EXTENSION_AGENT_BODY_BYTES)
  if (!body.ok) return body.response
  await platform.agent.steer(principal, runId, agentInputText(body.data.input))
  const run = await platform.agent.getRun(principal, runId)
  return jsonResponse({ schemaVersion: 1, accepted: true, run: projectAgentRun(run) })
}

export async function cancelAgentRun(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  context: RouteContext
): Promise<JsonResponse> {
  const runId = RunIdSchema.parse(context.params.runId)
  return jsonResponse({
    schemaVersion: 1,
    accepted: true,
    run: projectAgentRun(await platform.agent.cancel(principal, runId))
  })
}

export async function agentRunEvents(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  request: Request,
  context: RouteContext
): Promise<JsonResponse | Response> {
  const runId = RunIdSchema.parse(context.params.runId)
  const cursor = parseEventQuery(request)
  if (!cursor.ok) return cursor.response
  if (acceptsSse(request)) {
    return buildAgentEventStream(platform, principal, request, runId, cursor.cursor, cursor.limit)
  }
  const afterSeq = cursor.cursor - 1
  const events: AgentRunEvent[] = []
  const subscription = await platform.agent.subscribe(principal, {
    runId,
    afterSeq
  }, (event) => {
    if (events.length >= cursor.limit) return
    const projected = projectAgentEvent(event)
    if (projected) events.push(projected)
  })
  subscription.close()
  return jsonResponse({
    schemaVersion: 1,
    events,
    // Public agent event sequences are one-based while the runtime cursor is
    // zero-based. A private event still advances the runtime subscription, so
    // carry that mapped high-water mark even when there is nothing to emit.
    // A full public page must resume from its last returned event rather than
    // the subscription tail: subscribe() drains the replay before this route
    // can close it, so using that tail would skip unseen public events.
    nextCursor: events.length === cursor.limit
      ? events.at(-1)!.sequence
      : agentCursorAfterSubscription(cursor.cursor, afterSeq, subscription.lastDeliveredSeq),
    hasMore: events.length === cursor.limit
  })
}

export async function listOwnThreads(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  request: Request
): Promise<JsonResponse> {
  const parsed = parseQuery(request, z.strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(512).optional(),
    workspace: WorkspaceRootSchema.optional(),
    state: AgentRunStateSchema.optional()
  }))
  if (!parsed.ok) return parsed.response
  const page = await platform.agent.listOwnThreads(principal, parsed.data)
  return jsonResponse({
    schemaVersion: 1,
    items: page.items.map((thread) => projectOwnedThread(principal, thread)),
    page: {
      hasMore: Boolean(page.nextCursor),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
    }
  })
}

export async function getOwnThread(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  context: RouteContext
): Promise<JsonResponse> {
  const threadId = ThreadIdSchema.parse(context.params.threadId)
  return jsonResponse({
    schemaVersion: 1,
    thread: projectOwnedThread(principal, await platform.agent.getOwnThread(principal, threadId))
  })
}

export function listOwnTools(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal
): JsonResponse {
  requirePermission(principal, 'tools.register')
  return jsonResponse({
    schemaVersion: 1,
    tools: platform.tools.list(principal.extensionId).map((tool) => ({
      canonicalToolId: tool.canonicalToolId,
      modelAlias: tool.modelAlias,
      localId: tool.declaration.name,
      description: tool.declaration.description,
      inputSchema: structuredClone(tool.declaration.inputSchema),
      sideEffect: tool.declaration.sideEffect,
      idempotent: tool.declaration.idempotent ?? false
    }))
  })
}

export async function listOwnProviders(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal
): Promise<JsonResponse> {
  requirePermission(principal, 'providers.register')
  const providers = (await platform.providerAccounts.listProviders())
    .filter((provider) => provider.ownerExtensionId === principal.extensionId)
    .map(projectProvider)
  return jsonResponse({ schemaVersion: 1, providers })
}

export async function probeOwnProvider(
  platform: ExtensionPlatformRuntime,
  principalInput: ExtensionPrincipal,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  requirePermission(principalInput, 'providers.register')
  const body = await parseBody(request, ProviderProbeSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const principal = await expandProviderPermissions(platform, principalInput)
  const providerId = await resolveOwnedProviderId(platform, principal, ProviderIdSchema.parse(context.params.providerId))
  await assertOwnedAccount(platform, principal, providerId, body.data.accountId)
  requireAccountUse(principal, providerId)
  const result = await platform.modelProviders.probe(
    providerId,
    body.data.accountId,
    body.data.modelId,
    request.signal
  )
  return jsonResponse({ schemaVersion: 1, providerId, result })
}

export async function listOwnProviderModels(
  platform: ExtensionPlatformRuntime,
  principalInput: ExtensionPrincipal,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  requirePermission(principalInput, 'providers.register')
  const query = parseQuery(request, z.strictObject({ account_id: AccountIdSchema }))
  if (!query.ok) return query.response
  const principal = await expandProviderPermissions(platform, principalInput)
  const providerId = await resolveOwnedProviderId(platform, principal, ProviderIdSchema.parse(context.params.providerId))
  await assertOwnedAccount(platform, principal, providerId, query.data.account_id)
  requireAccountUse(principal, providerId)
  const models = await platform.modelProviders.listModels(providerId, query.data.account_id, request.signal)
  return jsonResponse({ schemaVersion: 1, providerId, models })
}

export async function listOwnAccounts(
  platform: ExtensionPlatformRuntime,
  principalInput: ExtensionPrincipal,
  request: Request
): Promise<JsonResponse> {
  const query = parseQuery(request, z.strictObject({ provider_id: ProviderIdSchema.optional() }))
  if (!query.ok) return query.response
  return accountListResponse(platform, principalInput, query.data.provider_id, true)
}

export async function accountListResponse(
  platform: ExtensionPlatformRuntime,
  principalInput: ExtensionPrincipal,
  providerIdInput: string | undefined,
  includeUnavailable: boolean
): Promise<JsonResponse> {
  const principal = await expandProviderPermissions(platform, principalInput)
  const providerId = providerIdInput
    ? await resolveOwnedProviderId(platform, principal, providerIdInput)
    : undefined
  const [accounts, protection] = await Promise.all([
    platform.accounts.listAccounts(principal, providerId),
    platform.credentials.protection()
  ])
  const publicProtection = protection.mode === 'primary'
    ? 'system'
    : protection.mode === 'encrypted-fallback' ? 'encrypted-fallback' : 'unavailable'
  return jsonResponse({
    schemaVersion: 1,
    accounts: accounts
      .filter((account) => includeUnavailable || account.status !== 'unavailable')
      .map((account) => AccountSchema.parse({
      id: account.id,
      providerId: account.providerId,
      label: account.label,
      authenticationType: account.authType === 'oauth-pkce'
        ? 'oauth2-pkce'
        : account.authType === 'oauth-device' ? 'device-code' : 'api-key',
      status: account.status,
      metadata: account.metadata,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      ...(account.expiresAt ? { expiresAt: account.expiresAt } : {}),
        protection: publicProtection
      })),
    protection: {
      mode: publicProtection,
      degraded: protection.degraded,
      available: protection.available
    }
  })
}
