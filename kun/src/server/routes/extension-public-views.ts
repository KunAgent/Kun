import { createHash, randomUUID } from 'node:crypto'
import { basename, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import {
  AccountSchema,
  AgentCreateRunRequestSchema,
  AgentRunEventSchema,
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
  activationEvent,
  authenticateSession,
  parseBody,
  parseQualifiedContributionId,
  resolveViewTarget,
  viewActivationOptions
} from './extension-public-common.js'
import {
  acceptsSse,
  buildViewEventStream,
  parseEventQuery
} from './extension-public-streams.js'

export async function createViewSession(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, CreateViewSessionSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const identity = parseQualifiedContributionId(body.data.contributionId)
  // Do not bind a session while an install, permission, or enablement change is
  // between its lifecycle fence and durable registry commit.
  await platform.packageManager.waitForPendingOperation(identity.extensionId)
  return createActivatedViewSession(
    platform,
    body.data.contributionId,
    workspaceRoot,
    MAX_CANCELLED_ACTIVATION_RETRIES
  )
}

const MAX_CANCELLED_ACTIVATION_RETRIES = 3

async function createActivatedViewSession(
  platform: ExtensionPlatformRuntime,
  contributionId: string,
  workspaceRoot: string | undefined,
  cancelledActivationRetries: number
): Promise<JsonResponse> {
  const target = await resolveViewTarget(platform, contributionId, workspaceRoot)
  // Create the runtime-owned session first. Its synchronous lifecycle event
  // cancels a pending idle deactivation before asynchronous Host activation.
  const session = platform.viewSessions.create(target.target)
  try {
    if (target.manifest.main) {
      const event = activationEvent(target.manifest, target.target.localContributionId, 'onView')
      await platform.manager.activate(
        target.target.extensionId,
        event,
        viewActivationOptions(platform, target.target)
      )
    }
    return jsonResponse(session, 201)
  } catch (error) {
    platform.viewSessions.disposeSession(session.sessionId)
    if (cancelledActivationRetries > 0 && isActivationCancelled(error)) {
      // Permission, enablement, and version changes are serialized by the
      // package manager. Wait for the transaction that fenced this Host, then
      // resolve a new target so the replacement session cannot retain stale
      // workspace grants or package metadata.
      await platform.packageManager.waitForPendingOperation(target.target.extensionId)
      return createActivatedViewSession(
        platform,
        contributionId,
        workspaceRoot,
        cancelledActivationRetries - 1
      )
    }
    throw error
  }
}

function isActivationCancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    (error as { code?: unknown }).code === 'EXTENSION_ACTIVATION_CANCELLED'
}

export async function setWorkbenchEnvironment(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, WorkbenchEnvironmentSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const changed = platform.viewSessions.setWorkbenchEnvironment(body.data)
  if (changed.themeChanged || changed.localeChanged) {
    const registry = await platform.registry.read()
    const notifications: Array<Promise<void>> = []
    for (const extensionId of Object.keys(registry.extensions)) {
      if (changed.themeChanged) {
        notifications.push(platform.manager.notify(
          extensionId,
          'ui.themeChanged',
          body.data.theme as JsonValue
        ).catch(() => undefined))
      }
      if (changed.localeChanged) {
        notifications.push(platform.manager.notify(
          extensionId,
          'ui.localeChanged',
          body.data.locale as JsonValue
        ).catch(() => undefined))
      }
    }
    await Promise.all(notifications)
  }
  return jsonResponse({ schemaVersion: 1, accepted: true })
}

export function disposeViewSession(
  runtime: ServerRuntime,
  request: Request,
  context: RouteContext
): JsonResponse {
  const platform = runtime.extensionPlatform!
  const sessionId = SessionIdSchema.parse(context.params.sessionId)
  const trusted = isRuntimeTokenAuthorized(request.headers, runtime.runtimeToken)
  if (!trusted) authenticateSession(platform, request, sessionId)
  return jsonResponse({ schemaVersion: 1, disposed: platform.viewSessions.disposeSession(sessionId) })
}

export async function postViewMessage(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const sessionId = SessionIdSchema.parse(context.params.sessionId)
  authenticateSession(platform, request, sessionId)
  const release = platform.viewSessions.beginRequest(sessionId)
  try {
    const body = await parseBody(request, HostMessageSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
    if (!body.ok) return body.response
    const target = platform.viewSessions.target(sessionId)
    const host = await platform.manager.activate(
      target.extensionId,
      target.activationEvent,
      viewActivationOptions(platform, target)
    )
    if (host) {
      await platform.manager.notify(
        target.extensionId,
        'ui.message',
        body.data as JsonValue,
        viewActivationOptions(platform, target)
      )
    }
    return jsonResponse({ schemaVersion: 1, accepted: true, delivered: Boolean(host) }, 202)
  } finally {
    release()
  }
}

export async function postHostViewMessage(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const sessionId = SessionIdSchema.parse(context.params.sessionId)
  const body = await parseBody(request, HostMessageSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  platform.viewSessions.publishHostMessage(sessionId, body.data)
  return jsonResponse({ schemaVersion: 1, accepted: true }, 202)
}

export async function dispatchViewRequest(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const sessionId = SessionIdSchema.parse(context.params.sessionId)
  authenticateSession(platform, request, sessionId)
  const body = await parseBody(request, ViewBrokerRequestSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  if (!VIEW_BROKER_METHODS.has(body.data.method)) {
    throw new ExtensionBrokerError('permission_denied', 'View method is not available')
  }
  const principal = platform.viewSessions.principal(sessionId)
  const params = body.data.params ?? null
  const requiredPermission = requiredExtensionBrokerPermission(body.data.method, params)
  if (requiredPermission && !hasPermission(principal.permissions, requiredPermission)) {
    throw new ExtensionBrokerError('permission_denied', `Missing permission: ${requiredPermission}`)
  }
  const operation = platform.viewSessions.beginOperation(sessionId, body.data.requestId)
  const timeout = setTimeout(() => platform.viewSessions.cancelOperation(sessionId, body.data.requestId), body.data.timeoutMs)
  timeout.unref?.()
  try {
    if (body.data.method === 'ui.postMessage') {
      await deliverViewMessageToHost(platform, sessionId, params)
      return jsonResponse({ schemaVersion: 1, result: null })
    }
    const result = await platform.broker.handlePrincipal({
      principal,
      method: body.data.method,
      params,
      signal: operation.signal,
      requestId: body.data.requestId
    })
    if (operation.signal.aborted) {
      return jsonResponse({ code: 'request_cancelled', message: 'Extension view request was cancelled' }, 408)
    }
    return jsonResponse({ schemaVersion: 1, result })
  } catch (error) {
    if (operation.signal.aborted) {
      return jsonResponse({ code: 'request_cancelled', message: 'Extension view request was cancelled' }, 408)
    }
    throw error
  } finally {
    clearTimeout(timeout)
    operation.finish()
  }
}

export function cancelViewRequest(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): JsonResponse {
  const sessionId = SessionIdSchema.parse(context.params.sessionId)
  authenticateSession(platform, request, sessionId)
  const requestId = ViewRequestIdSchema.parse(context.params.requestId)
  return jsonResponse({
    schemaVersion: 1,
    cancelled: platform.viewSessions.cancelOperation(sessionId, requestId)
  })
}

export async function deliverViewMessageToHost(
  platform: ExtensionPlatformRuntime,
  sessionId: string,
  params: JsonValue
): Promise<boolean> {
  const message = HostMessageSchema.parse(params)
  const target = platform.viewSessions.target(sessionId)
  const host = await platform.manager.activate(
    target.extensionId,
    target.activationEvent,
    viewActivationOptions(platform, target)
  )
  if (host) {
    await platform.manager.notify(
      target.extensionId,
      'ui.message',
      message as JsonValue,
      viewActivationOptions(platform, target)
    )
  }
  return Boolean(host)
}

export function viewSessionEvents(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): JsonResponse | Response {
  const sessionId = SessionIdSchema.parse(context.params.sessionId)
  authenticateSession(platform, request, sessionId)
  const cursor = parseEventQuery(request)
  if (!cursor.ok) return cursor.response
  if (acceptsSse(request)) {
    return buildViewEventStream(platform, request, sessionId, cursor.cursor, cursor.limit)
  }
  const replay = platform.viewSessions.replay(sessionId, cursor.cursor, cursor.limit)
  if (replay.cursorExpired) {
    return jsonResponse({
      code: 'cursor_expired',
      message: 'Extension view event cursor is older than retained history',
      oldestAvailableCursor: replay.oldestAvailableCursor
    }, 409)
  }
  return jsonResponse({ schemaVersion: 1, ...replay })
}
