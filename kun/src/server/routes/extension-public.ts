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

export const EXTENSION_SESSION_ID_HEADER = 'x-kun-extension-session-id'
export const EXTENSION_SESSION_NONCE_HEADER = 'x-kun-extension-session-nonce'

const MAX_EXTENSION_VIEW_BODY_BYTES = 256 * 1024
const MAX_EXTENSION_AGENT_BODY_BYTES = 1024 * 1024
const DEFAULT_EVENT_LIMIT = 50
const MAX_EVENT_LIMIT = 100
const HEARTBEAT_INTERVAL_MS = 15_000

const SessionIdSchema = z.string().regex(/^view_[0-9a-f-]{36}$/i).max(64)
const RunIdSchema = z.string().min(1).max(256)
const ThreadIdSchema = z.string().min(1).max(256)
const ProviderIdSchema = z.string().min(1).max(129)
const LocalProviderIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const AccountIdSchema = z.string().min(1).max(256)
const WorkspaceRootSchema = z.string().trim().min(1).max(4096).refine(isAbsolute, 'workspaceRoot must be absolute')

const CreateViewSessionSchema = z.strictObject({
  contributionId: z.string().regex(/^extension:[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}$/),
  workspaceRoot: WorkspaceRootSchema.optional()
})

const QualifiedSettingContributionSchema = z.string().regex(
  /^extension:[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}$/
)
const ConfigurationSnapshotRequestSchema = z.strictObject({
  contributionIds: z.array(QualifiedSettingContributionSchema).max(256),
  workspaceRoot: WorkspaceRootSchema.optional()
})
const ConfigurationUpdateRequestSchema = z.strictObject({
  contributionId: QualifiedSettingContributionSchema,
  key: z.string().min(1).max(256),
  value: JsonValueSchema,
  expectedRevision: z.number().int().nonnegative(),
  workspaceRoot: WorkspaceRootSchema.optional()
})

const WorkbenchEnvironmentSchema = z.strictObject({
  theme: ThemeSchema,
  locale: LocaleSchema
})

const ViewBrokerRequestSchema = z.strictObject({
  requestId: z.string().trim().min(8).max(256),
  method: z.string().trim().min(1).max(128),
  params: JsonValueSchema.optional(),
  timeoutMs: z.number().int().min(1).max(300_000).default(60_000)
})

const ViewRequestIdSchema = z.string().trim().min(8).max(256)

const InvokeExtensionCommandSchema = z.strictObject({
  commandId: z.string().regex(/^extension:[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}$/),
  context: JsonValueSchema,
  workspaceRoot: WorkspaceRootSchema.optional()
})

const ManagedAccountSessionSchema = z.strictObject({
  extensionId: ExtensionIdSchema,
  extensionVersion: z.string().min(1).max(64),
  providerId: ProviderIdSchema,
  authenticationProviderId: z.string().min(1).max(129),
  label: z.string().trim().min(1).max(128).optional(),
  scopes: z.array(z.string().trim().min(1).max(256)).max(128).optional(),
  workspaceRoot: WorkspaceRootSchema.optional()
})

const ManagedProviderCatalogQuerySchema = z.strictObject({
  workspace_root: WorkspaceRootSchema.optional()
})

const ManagedProviderModelsQuerySchema = z.strictObject({
  extension_id: ExtensionIdSchema,
  extension_version: z.string().min(1).max(64),
  provider_id: LocalProviderIdSchema,
  account_id: AccountIdSchema,
  workspace_root: WorkspaceRootSchema.optional()
})

const ManagedProviderBindingSchema = z.strictObject({
  extensionId: ExtensionIdSchema,
  extensionVersion: z.string().min(1).max(64),
  providerId: LocalProviderIdSchema,
  accountId: AccountIdSchema,
  modelId: z.string().trim().min(1).max(256),
  workspaceRoot: WorkspaceRootSchema.optional(),
  acknowledgedDataAccess: z.literal(true)
})

const ManagedAccountSessionActionSchema = z.strictObject({
  extensionId: ExtensionIdSchema
})

const ManagedAccountSessionCompletionSchema = z.strictObject({
  extensionId: ExtensionIdSchema,
  extensionVersion: z.string().min(1).max(64),
  workspaceRoot: WorkspaceRootSchema.optional(),
  callbackUrl: z.string().url().max(16 * 1024)
})

const ManagedApiKeyAccountSchema = ManagedAccountSessionSchema.extend({
  extensionVersion: z.string().min(1).max(64),
  workspaceRoot: WorkspaceRootSchema.optional(),
  secret: z.string().min(1).max(64 * 1024)
}).strict()

const ManagedDeleteAccountSchema = z.strictObject({
  extensionId: ExtensionIdSchema,
  extensionVersion: z.string().min(1).max(64),
  providerId: ProviderIdSchema,
  workspaceRoot: WorkspaceRootSchema.optional()
})

const ManagedRenameAccountSchema = ManagedDeleteAccountSchema.extend({
  label: z.string().trim().min(1).max(128)
}).strict()

const ManagedReplaceApiKeyAccountSchema = ManagedDeleteAccountSchema.extend({
  secret: z.string().min(1).max(64 * 1024)
}).strict()

const SecretRevealDecisionSchema = z.strictObject({
  decision: z.enum(['allow', 'deny'])
})
const WorkbenchNotificationResponseSchema = z.strictObject({
  actionId: z.string().min(1).max(64).optional()
})
const WorkbenchNotificationIdSchema = z.string().regex(/^notification_[0-9a-f-]{36}$/i)

const ProtectedMediaViewBindingSchema = z.strictObject({
  sessionId: SessionIdSchema,
  runtimeSessionId: SessionIdSchema,
  sessionNonce: z.string().min(32).max(256),
  extensionId: ExtensionIdSchema,
  extensionVersion: z.string().trim().min(1).max(128),
  contributionId: z.string().regex(
    /^extension:[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}$/
  ),
  workspaceRoot: WorkspaceRootSchema,
  senderWebContentsId: z.number().int().positive(),
  senderMainFrameProcessId: z.number().int().nonnegative(),
  senderMainFrameRoutingId: z.number().int()
})
const ProtectedMediaSelectionRegistrationSchema = z.strictObject({
  operationToken: z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/),
  binding: ProtectedMediaViewBindingSchema,
  mode: z.enum(['read', 'export']),
  selections: z.array(z.strictObject({
    absolutePath: z.string().trim().min(1).max(16_384).refine(isAbsolute),
    displayName: z.string().trim().min(1).max(256),
    mimeType: z.string().min(3).max(128)
      .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/)
      .optional()
  })).min(1).max(128)
})
const ProtectedMediaLeaseResolutionSchema = z.strictObject({
  binding: ProtectedMediaViewBindingSchema,
  handleId: z.string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/),
  requestedTtlMs: z.number().int().min(1_000).max(60 * 60 * 1_000).optional()
})
const ProtectedArtifactResolutionSchema = z.strictObject({
  artifactId: z.string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/),
  ownerExtensionId: ExtensionIdSchema,
  ownerExtensionVersion: z.string().min(1).max(64),
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceRoot: WorkspaceRootSchema
})

/** Guest-safe broker methods. Protected account/secret operations stay in Main-owned UI. */
const VIEW_BROKER_METHODS: ReadonlySet<string> = new Set(EXTENSION_VIEW_SAFE_METHODS)

const ProviderProbeSchema = z.strictObject({
  accountId: AccountIdSchema,
  modelId: z.string().min(1).max(256).optional()
})

const WORKBENCH_CONTRIBUTION_KEYS = [
  'commands',
  'views.containers',
  'views.leftSidebar',
  'views.rightSidebar',
  'views.auxiliaryPanel',
  'views.editorTab',
  'views.fullPage',
  'actions.topBar',
  'actions.composer',
  'actions.message',
  'message.resultPreviews',
  'settings',
  'contextMenus',
  'notifications',
  'hostContentScripts'
] as const satisfies readonly (keyof ExtensionContributions)[]

const VIEW_CONTRIBUTION_KEYS = [
  'views.leftSidebar',
  'views.rightSidebar',
  'views.auxiliaryPanel',
  'views.editorTab',
  'views.fullPage',
  'message.resultPreviews'
] as const satisfies readonly (keyof ExtensionContributions)[]

type SelectedExtension = {
  entry: ExtensionRegistryEntry
  selected: InstalledExtensionVersion | DevelopmentExtensionRecord
  enabled: boolean
  grantedPermissions: string[]
  workspaceTrusted: boolean
  workspaceKey?: string
}

/**
 * Public extension routes used by trusted Main and sender-bound Webviews.
 * Register these before `/v1/extensions/:id`, because the Router is first-match.
 */
export function registerExtensionPublicRoutes(router: Router, runtime: ServerRuntime): void {
  if (!runtime.extensionPlatform) return
  const platform = runtime.extensionPlatform
  const trusted = (handler: RouteHandler): RouteHandler => withErrors(async (request, context) => {
    if (!isRuntimeTokenAuthorized(request.headers, runtime.runtimeToken)) return ERRORS.unauthorized()
    return handler(request, context)
  })
  const protectedMediaTokens = new ProtectedMediaOperationTokenRegistry()

  router.add('GET', '/v1/extensions/workbench', trusted((request) => workbenchSnapshot(platform, request)))
  router.add('POST', '/v1/extensions/configuration/snapshot', trusted((request) =>
    configurationSnapshot(platform, request)))
  router.add('PUT', '/v1/extensions/configuration', trusted((request) =>
    updateConfiguration(platform, request)))
  router.add('PUT', '/v1/extensions/workbench/environment', trusted((request) =>
    setWorkbenchEnvironment(platform, request)))
  router.add('GET', '/v1/extensions/workbench/notifications', trusted(() =>
    listWorkbenchNotifications(platform)))
  router.add('DELETE', '/v1/extensions/workbench/presence', trusted(() => {
    platform.viewSessions.disconnectWorkbench()
    return jsonResponse({ schemaVersion: 1, disconnected: true })
  }))
  router.add(
    'POST',
    '/v1/extensions/workbench/notifications/:notificationId/respond',
    trusted((request, context) => respondWorkbenchNotification(platform, request, context))
  )
  router.add('POST', '/v1/extensions/commands/invoke', trusted((request) => invokeExtensionCommand(platform, request)))
  router.add('POST', '/v1/extensions/accounts/sessions', trusted((request) => createManagedAccountSession(platform, request)))
  router.add('GET', '/v1/extensions/model-providers', trusted((request) =>
    listManagedModelProviders(platform, request)))
  router.add('GET', '/v1/extensions/model-providers/models', trusted((request) =>
    listManagedProviderModels(platform, request)))
  router.add('PUT', '/v1/extensions/model-providers/binding', trusted((request) =>
    setManagedProviderBinding(platform, request)))
  router.add('GET', '/v1/extensions/accounts/sessions/:sessionId', trusted((request, context) =>
    getManagedAccountSession(platform, request, context)))
  router.add('POST', '/v1/extensions/accounts/sessions/:sessionId/cancel', trusted((request, context) =>
    cancelManagedAccountSession(platform, request, context)))
  router.add('POST', '/v1/extensions/accounts/sessions/:sessionId/complete', trusted((request, context) =>
    completeManagedAccountSession(platform, request, context)))
  router.add('POST', '/v1/extensions/accounts/api-key', trusted((request) => createManagedApiKeyAccount(platform, request)))
  router.add('PATCH', '/v1/extensions/accounts/:accountId/label', trusted((request, context) =>
    renameManagedAccount(platform, request, context)))
  router.add('PUT', '/v1/extensions/accounts/:accountId/api-key', trusted((request, context) =>
    replaceManagedApiKeyAccount(platform, request, context)))
  router.add('DELETE', '/v1/extensions/accounts/:accountId', trusted((request, context) =>
    deleteManagedAccount(platform, request, context)))
  router.add('GET', '/v1/extensions/secret-reveal-requests', trusted(() =>
    jsonResponse({ schemaVersion: 1, requests: platform.secretReveals.list() })))
  router.add('POST', '/v1/extensions/secret-reveal-requests/:requestId/decision', trusted((request, context) =>
    decideSecretReveal(platform, request, context)))
  router.add('POST', '/v1/extensions/media/selections', trusted((request) =>
    registerProtectedMediaSelections(platform, protectedMediaTokens, request)))
  router.add('POST', '/v1/extensions/media/leases/resolve', trusted((request) =>
    resolveProtectedMediaLease(platform, request)))
  router.add('POST', '/v1/extensions/media/artifacts/resolve', trusted((request) =>
    resolveProtectedArtifact(platform, request)))
  router.add('POST', '/v1/extensions/view-sessions', trusted((request) => createViewSession(platform, request)))
  router.add('POST', '/v1/extensions/view-sessions/:sessionId/host-messages', trusted((request, context) =>
    postHostViewMessage(platform, request, context)))
  router.add('DELETE', '/v1/extensions/view-sessions/:sessionId', withErrors((request, context) =>
    disposeViewSession(runtime, request, context)))
  router.add('POST', '/v1/extensions/view-sessions/:sessionId/messages', withErrors((request, context) =>
    postViewMessage(platform, request, context)))
  router.add('POST', '/v1/extensions/view-sessions/:sessionId/requests', withErrors((request, context) =>
    dispatchViewRequest(platform, request, context)))
  router.add('POST', '/v1/extensions/view-sessions/:sessionId/requests/:requestId/cancel', withErrors((request, context) =>
    cancelViewRequest(platform, request, context)))
  router.add('GET', '/v1/extensions/view-sessions/:sessionId/events', withErrors((request, context) =>
    viewSessionEvents(platform, request, context)))

  router.add('POST', '/v1/extensions/agent/runs', sessionRoute(platform, (principal, request) =>
    createAgentRun(platform, principal, request)))
  router.add('GET', '/v1/extensions/agent/runs/:runId', sessionRoute(platform, (principal, _request, context) =>
    getAgentRun(platform, principal, context)))
  router.add('POST', '/v1/extensions/agent/runs/:runId/steer', sessionRoute(platform, (principal, request, context) =>
    steerAgentRun(platform, principal, request, context)))
  router.add('POST', '/v1/extensions/agent/runs/:runId/cancel', sessionRoute(platform, (principal, _request, context) =>
    cancelAgentRun(platform, principal, context)))
  router.add('GET', '/v1/extensions/agent/runs/:runId/events', sessionRoute(platform, (principal, request, context) =>
    agentRunEvents(platform, principal, request, context)))
  router.add('GET', '/v1/extensions/agent/threads', sessionRoute(platform, (principal, request) =>
    listOwnThreads(platform, principal, request)))
  router.add('GET', '/v1/extensions/agent/threads/:threadId', sessionRoute(platform, (principal, _request, context) =>
    getOwnThread(platform, principal, context)))

  // Tool execution deliberately has no direct HTTP route: calls must retain
  // ToolHost approval, sandbox, journal, budget and cancellation semantics.
  router.add('GET', '/v1/extensions/tools', sessionRoute(platform, (principal) =>
    listOwnTools(platform, principal)))
  router.add('GET', '/v1/extensions/providers', sessionRoute(platform, (principal) =>
    listOwnProviders(platform, principal)))
  router.add('POST', '/v1/extensions/providers/:providerId/probe', sessionRoute(platform, (principal, request, context) =>
    probeOwnProvider(platform, principal, request, context)))
  router.add('GET', '/v1/extensions/providers/:providerId/models', sessionRoute(platform, (principal, request, context) =>
    listOwnProviderModels(platform, principal, request, context)))
  router.add('GET', '/v1/extensions/accounts', accountListRoute(runtime, platform))
}

export function buildExtensionPublicRouter(runtime: ServerRuntime): Router {
  const router = new Router()
  registerExtensionPublicRoutes(router, runtime)
  return router
}

async function workbenchSnapshot(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const query = parseQuery(request, z.strictObject({
    workspace_root: WorkspaceRootSchema.optional(),
    locale: ManifestLocaleTagSchema.optional()
  }), {
    workspace_root: 'workspace_root',
    locale: 'locale'
  })
  if (!query.ok) return query.response
  const workspaceRoot = query.data.workspace_root === undefined
    ? undefined
    : resolve(query.data.workspace_root)
  const registry = await platform.registry.read()
  const extensions = Object.values(registry.extensions)
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((entry) => {
      const resolved = selectExtension(platform, entry, workspaceRoot)
      if (!resolved?.enabled) return []
      const compatibility = platform.packageManager.compatibilityReport(
        resolved.selected.manifest
      )
      const compatible = compatibility.api.compatible &&
        compatibility.kunEngine.compatible &&
        compatibility.rpc.compatible &&
        compatibility.diagnostics.every((diagnostic) => diagnostic.compatible)
      const localizedManifest = resolveExtensionManifestLocale(
        resolved.selected.manifest,
        query.data.locale
      )
      const contributes = sanitizeWorkbenchContributions(
        localizedManifest,
        resolved.grantedPermissions
      )
      const rightRailDiscovery = resolved.workspaceTrusted
        ? { views: [], containers: [] }
        : projectRightRailDiscovery(localizedManifest)
      const hasContribution = WORKBENCH_CONTRIBUTION_KEYS.some((key) => contributes[key].length > 0)
      if (!hasContribution && rightRailDiscovery.views.length === 0) return []
      return [{
        id: entry.id,
        version: resolved.selected.manifest.version,
        contributes,
        rightRailDiscovery,
        grantedPermissions: [...resolved.grantedPermissions],
        enabled: true,
        compatible,
        workspaceTrusted: resolved.workspaceTrusted,
        source: {
          type: resolved.selected.source.type,
          mutable: resolved.selected.mutable
        },
        compatibility,
        diagnostics: compatibility.diagnostics
          .filter((diagnostic) => !diagnostic.compatible)
          .map(({ code, message }) => ({ code, message }))
      }]
    })
  return jsonResponse({
    schemaVersion: 1,
    revision: registry.revision,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    extensions
  })
}

async function configurationSnapshot(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, ConfigurationSnapshotRequestSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const grouped = new Map<string, string[]>()
  for (const contributionId of new Set(body.data.contributionIds)) {
    const parsed = parseQualifiedContributionId(contributionId)
    const current = grouped.get(parsed.extensionId) ?? []
    current.push(contributionId)
    grouped.set(parsed.extensionId, current)
  }
  const values: Record<string, Record<string, JsonValue>> = {}
  const revisions: Record<string, number> = {}
  for (const [extensionId, contributionIds] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
    const entry = await platform.registry.get(extensionId)
    if (!entry) throw new ExtensionBrokerError('not_found', 'Extension configuration was not found')
    const selected = selectExtension(platform, entry, workspaceRoot)
    if (!selected?.enabled || !selected.workspaceTrusted || !hasPermission(selected.grantedPermissions, 'ui.actions')) {
      throw new ExtensionBrokerError('permission_denied', 'Extension configuration is not available in this workspace')
    }
    for (const contributionId of contributionIds) {
      const localId = parseQualifiedContributionId(contributionId).localId
      if (!selected.selected.manifest.contributes.settings.some(({ id }) => id === localId)) {
        throw new ExtensionBrokerError('not_found', 'Extension configuration section was not found')
      }
    }
    const snapshot = await platform.configuration.snapshot({
      extensionId,
      manifest: selected.selected.manifest,
      contributionIds,
      ...(selected.workspaceKey ? { workspaceKey: selected.workspaceKey } : {})
    })
    Object.assign(values, snapshot.values)
    revisions[extensionId] = snapshot.revision
  }
  return jsonResponse({ schemaVersion: 1, values, revisions })
}

async function updateConfiguration(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, ConfigurationUpdateRequestSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const parsed = parseQualifiedContributionId(body.data.contributionId)
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const entry = await platform.registry.get(parsed.extensionId)
  if (!entry) throw new ExtensionBrokerError('not_found', 'Extension configuration was not found')
  const selected = selectExtension(platform, entry, workspaceRoot)
  if (!selected?.enabled || !selected.workspaceTrusted || !hasPermission(selected.grantedPermissions, 'ui.actions')) {
    throw new ExtensionBrokerError('permission_denied', 'Extension configuration is not available in this workspace')
  }
  if (!selected.selected.manifest.contributes.settings.some(({ id }) => id === parsed.localId)) {
    throw new ExtensionBrokerError('not_found', 'Extension configuration section was not found')
  }
  const principal: ExtensionPrincipal = {
    extensionId: parsed.extensionId,
    extensionVersion: selected.selected.manifest.version,
    permissions: [...selected.grantedPermissions],
    workspaceRoots: workspaceRoot ? [workspaceRoot] : [],
    workspaceTrusted: selected.workspaceTrusted
  }
  const snapshot = await platform.configuration.update({
    principal,
    manifest: selected.selected.manifest,
    sectionId: parsed.localId,
    key: body.data.key,
    value: body.data.value,
    expectedRevision: body.data.expectedRevision
  })
  return jsonResponse({
    schemaVersion: 1,
    extensionId: parsed.extensionId,
    revision: snapshot.revision,
    values: snapshot.values
  })
}

async function invokeExtensionCommand(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, InvokeExtensionCommandSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const parsed = parseQualifiedContributionId(body.data.commandId)
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const entry = await platform.registry.get(parsed.extensionId)
  if (!entry) throw new ExtensionBrokerError('not_found', 'Extension command was not found')
  const selected = selectExtension(platform, entry, workspaceRoot)
  const command = selected?.selected.manifest.contributes.commands.find(({ id }) => id === parsed.localId)
  if (!selected?.enabled || !selected.workspaceTrusted || !command || !selected.selected.manifest.main) {
    throw new ExtensionBrokerError('not_found', 'Extension command was not found')
  }
  if (!hasPermission(selected.grantedPermissions, 'commands.register')) {
    throw new ExtensionBrokerError('permission_denied', 'Missing permission: commands.register')
  }
  await platform.manager.activate(
    parsed.extensionId,
    activationEvent(selected.selected.manifest, parsed.localId, 'onCommand'),
    { ...(workspaceRoot ? { workspaceRoot } : {}) }
  )
  const principal: ExtensionPrincipal = {
    extensionId: parsed.extensionId,
    extensionVersion: selected.selected.manifest.version,
    permissions: [...selected.grantedPermissions],
    workspaceRoots: workspaceRoot ? [workspaceRoot] : [],
    workspaceTrusted: selected.workspaceTrusted
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  timeout.unref?.()
  try {
    const result = await platform.broker.handlePrincipal({
      principal,
      method: 'commands.execute',
      params: { id: parsed.localId, args: body.data.context },
      signal: controller.signal,
      requestId: `command_${randomUUID()}`
    })
    return jsonResponse({ schemaVersion: 1, result })
  } finally {
    clearTimeout(timeout)
  }
}

function accountListRoute(
  runtime: ServerRuntime,
  platform: ExtensionPlatformRuntime
): RouteHandler {
  const guest = sessionRoute(platform, (principal, request) =>
    listOwnAccounts(platform, principal, request))
  return withErrors(async (request, context) => {
    if (!isRuntimeTokenAuthorized(request.headers, runtime.runtimeToken)) {
      return guest(request, context)
    }
    const query = parseQuery(request, z.strictObject({
      extension_id: ExtensionIdSchema,
      provider_id: ProviderIdSchema.optional(),
      include_unavailable: z.enum(['true', 'false']).transform((value) => value === 'true').optional()
    }))
    if (!query.ok) return query.response
    const { principal } = await resolveManagementContext(platform, query.data.extension_id)
    return accountListResponse(
      platform,
      principal,
      query.data.provider_id,
      query.data.include_unavailable ?? false
    )
  })
}

async function createManagedAccountSession(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, ManagedAccountSessionSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const { principal, manifest } = await resolveManagementContext(
    platform,
    body.data.extensionId,
    workspaceRoot,
    body.data.extensionVersion
  )
  assertProviderAuthenticationContribution(
    manifest,
    body.data.providerId,
    body.data.authenticationProviderId
  )
  await platform.manager.activate(
    principal.extensionId,
    activationEvent(manifest, body.data.authenticationProviderId, 'onAuthentication'),
    { ...(workspaceRoot ? { workspaceRoot } : {}) }
  )
  const result = await platform.broker.handleTrustedManagement({
    principal,
    method: 'authentication.createSession',
    params: {
      providerId: body.data.providerId,
      authenticationProviderId: body.data.authenticationProviderId,
      ...(body.data.label ? { label: body.data.label } : {}),
      ...(body.data.scopes ? { scopes: body.data.scopes } : {})
    },
    signal: request.signal,
    requestId: `account_session_${randomUUID()}`
  })
  return jsonResponse({ schemaVersion: 1, session: result }, 201)
}

async function getManagedAccountSession(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const query = parseQuery(request, z.strictObject({ extension_id: ExtensionIdSchema }))
  if (!query.ok) return query.response
  const { principal } = await resolveManagementContext(platform, query.data.extension_id)
  const sessionId = z.string().min(1).max(256).parse(context.params.sessionId)
  const result = await platform.broker.handleTrustedManagement({
    principal,
    method: 'authentication.getSession',
    params: { sessionId },
    signal: request.signal,
    requestId: `account_session_get_${randomUUID()}`
  })
  return jsonResponse({ schemaVersion: 1, session: result })
}

async function cancelManagedAccountSession(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const body = await parseBody(request, ManagedAccountSessionActionSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const { principal } = await resolveManagementContext(platform, body.data.extensionId)
  const sessionId = z.string().min(1).max(256).parse(context.params.sessionId)
  await platform.broker.handlePrincipal({
    principal,
    method: 'authentication.cancelSession',
    params: { sessionId },
    signal: request.signal,
    requestId: `account_session_cancel_${randomUUID()}`
  })
  return jsonResponse({ schemaVersion: 1, cancelled: true })
}

async function completeManagedAccountSession(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const body = await parseBody(request, ManagedAccountSessionCompletionSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const { principal } = await resolveManagementContext(
    platform,
    body.data.extensionId,
    workspaceRoot,
    body.data.extensionVersion
  )
  const sessionId = z.string().min(1).max(256).parse(context.params.sessionId)
  const session = await platform.broker.completePkceAccountSession({
    principal,
    sessionId,
    callbackUrl: body.data.callbackUrl
  })
  return jsonResponse({ schemaVersion: 1, session })
}

async function createManagedApiKeyAccount(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, ManagedApiKeyAccountSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const { principal: basePrincipal, manifest } = await resolveManagementContext(
    platform,
    body.data.extensionId,
    workspaceRoot,
    body.data.extensionVersion
  )
  assertProviderAuthenticationContribution(
    manifest,
    body.data.providerId,
    body.data.authenticationProviderId
  )
  await platform.manager.activate(
    basePrincipal.extensionId,
    activationEvent(manifest, body.data.authenticationProviderId, 'onAuthentication'),
    { ...(workspaceRoot ? { workspaceRoot } : {}) }
  )
  const principal = await expandProviderPermissions(platform, basePrincipal)
  const providerId = await resolveOwnedProviderId(platform, principal, body.data.providerId)
  const account = await platform.accounts.createApiKeyAccount({
    principal,
    providerId,
    label: body.data.label ?? 'API key',
    apiKey: body.data.secret,
    protectedInput: true
  })
  return jsonResponse({ schemaVersion: 1, account }, 201)
}

async function deleteManagedAccount(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const body = await parseBody(request, ManagedDeleteAccountSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const { principal: basePrincipal } = await resolveManagementContext(
    platform,
    body.data.extensionId,
    workspaceRoot,
    body.data.extensionVersion
  )
  const principal = await expandProviderPermissions(platform, basePrincipal)
  const providerId = await resolveOwnedProviderId(platform, principal, body.data.providerId)
  const accountId = AccountIdSchema.parse(context.params.accountId)
  await assertOwnedAccount(platform, principal, providerId, accountId)
  const deleted = await platform.accounts.deleteAccount(principal, accountId)
  return jsonResponse({ schemaVersion: 1, deleted })
}

async function renameManagedAccount(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const body = await parseBody(request, ManagedRenameAccountSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const { principal: basePrincipal } = await resolveManagementContext(
    platform,
    body.data.extensionId,
    workspaceRoot,
    body.data.extensionVersion
  )
  const principal = await expandProviderPermissions(platform, basePrincipal)
  const providerId = await resolveOwnedProviderId(platform, principal, body.data.providerId)
  const accountId = AccountIdSchema.parse(context.params.accountId)
  await assertOwnedAccount(platform, principal, providerId, accountId)
  const account = await platform.accounts.renameAccount({
    principal,
    accountId,
    label: body.data.label
  })
  return jsonResponse({ schemaVersion: 1, account })
}

async function replaceManagedApiKeyAccount(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const body = await parseBody(request, ManagedReplaceApiKeyAccountSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const { principal: basePrincipal } = await resolveManagementContext(
    platform,
    body.data.extensionId,
    workspaceRoot,
    body.data.extensionVersion
  )
  const principal = await expandProviderPermissions(platform, basePrincipal)
  const providerId = await resolveOwnedProviderId(platform, principal, body.data.providerId)
  const accountId = AccountIdSchema.parse(context.params.accountId)
  await assertOwnedAccount(platform, principal, providerId, accountId)
  const account = await platform.accounts.replaceApiKeyAccount({
    principal,
    accountId,
    apiKey: body.data.secret,
    protectedInput: true
  })
  return jsonResponse({ schemaVersion: 1, account })
}

async function listManagedModelProviders(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const query = parseQuery(request, ManagedProviderCatalogQuerySchema)
  if (!query.ok) return query.response
  const workspaceRoot = query.data.workspace_root
    ? resolve(query.data.workspace_root)
    : undefined
  const scopeKey = providerBindingScope(platform, workspaceRoot)
  const registry = await platform.registry.read()
  const providers: unknown[] = []
  for (const entry of Object.values(registry.extensions).sort((left, right) => left.id.localeCompare(right.id))) {
    const selected = selectExtension(platform, entry, workspaceRoot)
    if (!selected || selected.selected.manifest.contributes.modelProviders.length === 0) continue
    const manifest = selected.selected.manifest
    let compatible = true
    try {
      platform.packageManager.admitManifest(manifest)
    } catch {
      compatible = false
    }
    const principal = await expandProviderPermissions(platform, {
      extensionId: entry.id,
      extensionVersion: manifest.version,
      permissions: [...selected.grantedPermissions],
      workspaceRoots: workspaceRoot ? [workspaceRoot] : [],
      workspaceTrusted: selected.workspaceTrusted
    })
    for (const declaration of manifest.contributes.modelProviders) {
      const providerId = extensionProviderId(entry.id, declaration.id)
      const dataCategories = providerDataCategories()
      const dataAccessDigest = providerDataAccessDigest(entry.id, selected, declaration)
      const permissionReady = hasPermission(selected.grantedPermissions, 'providers.register') &&
        hasPermission(selected.grantedPermissions, 'accounts.read') &&
        hasPermission(selected.grantedPermissions, `accounts.use:${declaration.id}`)
      if (
        selected.enabled &&
        selected.workspaceTrusted &&
        compatible &&
        permissionReady &&
        manifest.main
      ) {
        await platform.manager.activate(
          entry.id,
          providerActivationEvent(manifest, declaration.id),
          { ...(workspaceRoot ? { workspaceRoot } : {}) }
        ).catch(() => undefined)
      }
      const [definition, storedBinding] = await Promise.all([
        platform.providerAccounts.getProvider(providerId),
        platform.providerAccounts.getBinding(scopeKey, providerId)
      ])
      const definitionReady = definition?.ownerExtensionId === entry.id &&
        definition.ownerExtensionVersion === manifest.version
      const accounts = permissionReady
        ? await platform.accounts.listAccounts(principal, providerId).catch(() => [])
        : []
      const connectedAccounts = accounts.filter((account) => account.status === 'connected')
      const boundAccount = storedBinding?.binding.accountId
        ? connectedAccounts.find((account) => account.id === storedBinding.binding.accountId)
        : undefined
      const acknowledgementCurrent = Boolean(
        storedBinding &&
        storedBinding.ownerExtensionId === entry.id &&
        storedBinding.ownerExtensionVersion === manifest.version &&
        storedBinding.dataAccessDigest === dataAccessDigest
      )
      const modelResult = boundAccount && definitionReady && platform.modelProviders.isAvailable(providerId)
        ? await listModelsWithDeclaredFallback(
            platform,
            providerId,
            boundAccount.id,
            declaration,
            request.signal
          )
        : { models: [...declaration.models], discoveryError: undefined }
      const bindingModelAvailable = Boolean(
        storedBinding && modelResult.models.some((model) => model.id === storedBinding.binding.modelId)
      )
      const bindingValid = Boolean(
        selected.enabled &&
        selected.workspaceTrusted &&
        compatible &&
        permissionReady &&
        definitionReady &&
        platform.modelProviders.isAvailable(providerId) &&
        boundAccount &&
        acknowledgementCurrent &&
        bindingModelAvailable
      )
      const unavailableReason = !selected.enabled
        ? 'extension-disabled'
        : !selected.workspaceTrusted
          ? 'workspace-untrusted'
          : !compatible
            ? 'extension-incompatible'
            : !permissionReady
              ? 'permissions-required'
              : !definitionReady || !platform.modelProviders.isAvailable(providerId)
                ? 'provider-unavailable'
                : connectedAccounts.length === 0
                  ? 'account-required'
                  : undefined
      providers.push({
        extensionId: entry.id,
        extensionVersion: manifest.version,
        extensionDisplayName: manifest.displayName ?? entry.id,
        localProviderId: declaration.id,
        providerId,
        displayName: declaration.displayName,
        models: modelResult.models,
        accounts: accounts.map(projectManagedAccount),
        dataAccess: {
          digest: dataAccessDigest,
          categories: dataCategories,
          requiresAcknowledgement: !acknowledgementCurrent
        },
        binding: storedBinding
          ? {
              accountId: storedBinding.binding.accountId,
              modelId: storedBinding.binding.modelId,
              acknowledgedAt: storedBinding.acknowledgedAt,
              valid: bindingValid
            }
          : null,
        selectable: Boolean(
          selected.enabled && selected.workspaceTrusted && compatible && permissionReady &&
          definitionReady && platform.modelProviders.isAvailable(providerId) && connectedAccounts.length > 0
        ),
        ...(unavailableReason ? { unavailableReason } : {}),
        ...(modelResult.discoveryError ? { discoveryError: modelResult.discoveryError } : {})
      })
    }
  }
  return jsonResponse({ schemaVersion: 1, scope: workspaceRoot ? 'workspace' : 'global', providers })
}

async function listManagedProviderModels(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const query = parseQuery(request, ManagedProviderModelsQuerySchema)
  if (!query.ok) return query.response
  const workspaceRoot = query.data.workspace_root
    ? resolve(query.data.workspace_root)
    : undefined
  const context = await managedProviderContext(platform, {
    extensionId: query.data.extension_id,
    extensionVersion: query.data.extension_version,
    localProviderId: query.data.provider_id,
    accountId: query.data.account_id,
    workspaceRoot
  })
  const result = await listModelsWithDeclaredFallback(
    platform,
    context.providerId,
    query.data.account_id,
    context.declaration,
    request.signal
  )
  return jsonResponse({
    schemaVersion: 1,
    providerId: context.providerId,
    models: result.models,
    ...(result.discoveryError ? { discoveryError: result.discoveryError } : {})
  })
}

async function setManagedProviderBinding(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, ManagedProviderBindingSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const workspaceRoot = body.data.workspaceRoot
    ? resolve(body.data.workspaceRoot)
    : undefined
  const context = await managedProviderContext(platform, {
    extensionId: body.data.extensionId,
    extensionVersion: body.data.extensionVersion,
    localProviderId: body.data.providerId,
    accountId: body.data.accountId,
    workspaceRoot
  })
  const models = await listModelsWithDeclaredFallback(
    platform,
    context.providerId,
    body.data.accountId,
    context.declaration,
    request.signal
  )
  if (!models.models.some((model) => model.id === body.data.modelId)) {
    throw new ExtensionBrokerError('not_found', 'Model is not owned by the selected extension provider')
  }
  const selected = selectExtension(platform, context.entry, workspaceRoot)
  if (!selected) throw new ExtensionBrokerError('not_found', 'Extension version was not found')
  const dataCategories = providerDataCategories()
  const record = await platform.providerAccounts.setBinding({
    scopeKey: providerBindingScope(platform, workspaceRoot),
    ownerExtensionId: body.data.extensionId,
    ownerExtensionVersion: body.data.extensionVersion,
    binding: {
      providerId: context.providerId,
      accountId: body.data.accountId,
      modelId: body.data.modelId
    },
    dataAccessDigest: providerDataAccessDigest(
      body.data.extensionId,
      selected,
      context.declaration
    ),
    dataCategories: [...dataCategories]
  })
  return jsonResponse({
    schemaVersion: 1,
    binding: {
      providerId: record.binding.providerId,
      accountId: record.binding.accountId,
      modelId: record.binding.modelId,
      ownerExtensionId: record.ownerExtensionId,
      ownerExtensionVersion: record.ownerExtensionVersion,
      dataAccessDigest: record.dataAccessDigest,
      dataCategories: record.dataCategories,
      acknowledgedAt: record.acknowledgedAt
    }
  })
}

async function managedProviderContext(
  platform: ExtensionPlatformRuntime,
  input: {
    extensionId: string
    extensionVersion: string
    localProviderId: string
    accountId: string
    workspaceRoot?: string
  }
): Promise<{
  entry: ExtensionRegistryEntry
  declaration: ModelProviderDeclaration
  providerId: string
}> {
  const entry = await platform.registry.get(input.extensionId)
  if (!entry) throw new ExtensionBrokerError('not_found', 'Extension was not found')
  const selected = selectExtension(platform, entry, input.workspaceRoot)
  if (!selected || selected.selected.manifest.version !== input.extensionVersion) {
    throw new ExtensionBrokerError('conflict', 'Extension version changed; repeat the protected action')
  }
  if (!selected.enabled || !selected.workspaceTrusted) {
    throw new ExtensionBrokerError('permission_denied', 'Extension is not enabled and trusted for this workspace')
  }
  platform.packageManager.admitManifest(selected.selected.manifest)
  const declaration = selected.selected.manifest.contributes.modelProviders.find(
    ({ id }) => id === input.localProviderId
  )
  if (!declaration) throw new ExtensionBrokerError('not_found', 'Model provider was not found')
  for (const permission of [
    'providers.register',
    'accounts.read',
    `accounts.use:${declaration.id}`
  ]) {
    if (!hasPermission(selected.grantedPermissions, permission)) {
      throw new ExtensionBrokerError('permission_denied', `Missing permission: ${permission}`)
    }
  }
  await platform.manager.activate(
    input.extensionId,
    providerActivationEvent(selected.selected.manifest, declaration.id),
    { ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}) }
  )
  const providerId = extensionProviderId(input.extensionId, declaration.id)
  const definition = await platform.providerAccounts.getProvider(providerId)
  if (
    !definition ||
    definition.ownerExtensionId !== input.extensionId ||
    definition.ownerExtensionVersion !== input.extensionVersion ||
    !platform.modelProviders.isAvailable(providerId)
  ) {
    throw new ExtensionBrokerError('not_found', 'Extension model provider is unavailable')
  }
  const account = await platform.providerAccounts.getAccount(input.accountId)
  if (
    !account ||
    account.ownerExtensionId !== input.extensionId ||
    account.providerId !== providerId ||
    account.status !== 'connected'
  ) {
    throw new ExtensionBrokerError('not_found', 'A connected account for this provider is required')
  }
  return { entry, declaration, providerId }
}

async function listModelsWithDeclaredFallback(
  platform: ExtensionPlatformRuntime,
  providerId: string,
  accountId: string,
  declaration: ModelProviderDeclaration,
  signal: AbortSignal
): Promise<{ models: ProviderModel[]; discoveryError?: string }> {
  try {
    const models = await platform.modelProviders.listModels(providerId, accountId, signal)
    return { models }
  } catch (error) {
    if (declaration.models.length === 0) throw error
    return {
      models: [...declaration.models],
      discoveryError: redactSecretText(error instanceof Error ? error.message : String(error)).slice(0, 1_024)
    }
  }
}

function providerBindingScope(
  _platform: ExtensionPlatformRuntime,
  workspaceRoot?: string
): string {
  return extensionProviderBindingScope(workspaceRoot)
}

function providerDataCategories() {
  return [
    'conversation-history',
    'system-and-mode-instructions',
    'attachments',
    'tool-schemas'
  ] as const
}

function providerDataAccessDigest(
  extensionId: string,
  selected: SelectedExtension,
  declaration: ModelProviderDeclaration
): string {
  return createHash('sha256').update(JSON.stringify({
    extensionId,
    extensionVersion: selected.selected.manifest.version,
    provider: declaration,
    requestedPermissions: [...selected.selected.requestedPermissions].sort(),
    dataCategories: providerDataCategories()
  })).digest('hex')
}

function providerActivationEvent(manifest: ExtensionManifest, localId: string): string {
  const preferred = `onProvider:${localId}`
  if (manifest.activationEvents.includes(preferred)) return preferred
  if (manifest.activationEvents.includes('onStartup')) return 'onStartup'
  throw new ExtensionBrokerError(
    'not_found',
    `Extension has no declared activation event for model provider: ${localId}`
  )
}

function projectManagedAccount(account: Awaited<ReturnType<ExtensionPlatformRuntime['accounts']['listAccounts']>>[number]) {
  return AccountSchema.parse({
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
    ...(account.expiresAt ? { expiresAt: account.expiresAt } : {})
  })
}

async function decideSecretReveal(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const requestId = z.string().regex(/^secret_reveal_[0-9a-f-]{36}$/i).parse(context.params.requestId)
  const body = await parseBody(request, SecretRevealDecisionSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  if (!platform.secretReveals.decide(requestId, body.data.decision)) {
    throw new ExtensionBrokerError('not_found', 'Secret reveal request was not found or expired')
  }
  return jsonResponse({ schemaVersion: 1, decided: true })
}

function listWorkbenchNotifications(platform: ExtensionPlatformRuntime): JsonResponse {
  platform.viewSessions.touchWorkbench()
  return jsonResponse({
    schemaVersion: 1,
    notifications: platform.viewSessions.listWorkbenchNotifications()
  })
}

async function respondWorkbenchNotification(
  platform: ExtensionPlatformRuntime,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const notificationId = WorkbenchNotificationIdSchema.parse(context.params.notificationId)
  const body = await parseBody(
    request,
    WorkbenchNotificationResponseSchema,
    MAX_EXTENSION_VIEW_BODY_BYTES
  )
  if (!body.ok) return body.response
  if (!platform.viewSessions.respondWorkbenchNotification(notificationId, body.data.actionId)) {
    throw new ExtensionViewSessionError('not_found', 'Extension notification was not found or expired')
  }
  return jsonResponse({ schemaVersion: 1, responded: true })
}

async function resolveManagementContext(
  platform: ExtensionPlatformRuntime,
  extensionId: string,
  workspaceRoot?: string,
  expectedVersion?: string
): Promise<{ principal: ExtensionPrincipal; manifest: ExtensionManifest }> {
  const entry = await platform.registry.get(extensionId)
  if (!entry) throw new ExtensionBrokerError('not_found', 'Extension was not found')
  const selected = selectExtension(platform, entry, workspaceRoot)
  if (!selected) throw new ExtensionBrokerError('not_found', 'Extension version was not found')
  const manifest = selected.selected.manifest
  if (expectedVersion && expectedVersion !== manifest.version) {
    throw new ExtensionBrokerError('conflict', 'Extension version changed; repeat the protected action')
  }
  return {
    manifest,
    principal: {
      extensionId,
      extensionVersion: manifest.version,
      permissions: [...selected.grantedPermissions],
      workspaceRoots: workspaceRoot ? [workspaceRoot] : [],
      workspaceTrusted: selected.workspaceTrusted
    }
  }
}

function assertAuthenticationContribution(manifest: ExtensionManifest, localId: string): void {
  if (!manifest.contributes.authentication.some(({ id }) => id === localId)) {
    throw new ExtensionBrokerError('not_found', 'Authentication provider was not found')
  }
}

function assertProviderAuthenticationContribution(
  manifest: ExtensionManifest,
  providerId: string,
  authenticationProviderId: string
): void {
  assertAuthenticationContribution(manifest, authenticationProviderId)
  const provider = manifest.contributes.modelProviders.find(({ id }) => id === providerId)
  if (!provider || provider.authenticationProviderId !== authenticationProviderId) {
    throw new ExtensionBrokerError(
      'not_found',
      'Authentication provider does not match the selected model provider'
    )
  }
  // The broker repeats scope-subset validation against the persisted provider
  // definition immediately before beginning authorization.
}

class ProtectedMediaOperationTokenRegistry {
  private readonly consumed = new Set<string>()

  consume(token: string): void {
    const digest = createHash('sha256').update(token).digest('hex')
    if (this.consumed.has(digest)) {
      throw new ExtensionBrokerError(
        'conflict',
        'Protected media operation was already consumed'
      )
    }
    if (this.consumed.size >= 65_536) {
      throw new ExtensionBrokerError(
        'conflict',
        'Protected media operation capacity was reached; restart Kun before retrying'
      )
    }
    // Burn first. A mismatched binding cannot turn the token into an oracle or
    // retry it later with a different selection.
    this.consumed.add(digest)
  }
}

async function registerProtectedMediaSelections(
  platform: ExtensionPlatformRuntime,
  tokens: ProtectedMediaOperationTokenRegistry,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(
    request,
    ProtectedMediaSelectionRegistrationSchema,
    MAX_EXTENSION_VIEW_BODY_BYTES
  )
  if (!body.ok) return body.response
  tokens.consume(body.data.operationToken)

  const binding = body.data.binding
  if (binding.sessionId !== binding.runtimeSessionId) {
    throw new ExtensionViewSessionError('unauthorized', 'Protected media View identity mismatch')
  }
  const projection = platform.viewSessions.authenticate(
    binding.runtimeSessionId,
    binding.sessionNonce
  )
  const target = platform.viewSessions.target(binding.runtimeSessionId)
  if (
    projection.sessionId !== binding.runtimeSessionId ||
    projection.extensionId !== binding.extensionId ||
    projection.extensionVersion !== binding.extensionVersion ||
    projection.contributionId !== binding.contributionId ||
    projection.workspaceRoot !== binding.workspaceRoot ||
    target.extensionId !== binding.extensionId ||
    target.extensionVersion !== binding.extensionVersion ||
    target.contributionId !== binding.contributionId ||
    target.workspaceRoot !== binding.workspaceRoot
  ) {
    throw new ExtensionViewSessionError('unauthorized', 'Protected media View binding mismatch')
  }

  const principal = platform.viewSessions.principal(binding.runtimeSessionId)
  const created: MediaHandleProjection[] = []
  try {
    for (const selection of body.data.selections) {
      if (basename(selection.absolutePath) !== selection.displayName) {
        throw new ExtensionBrokerError(
          'validation_error',
          'Protected media selection display name does not match the selected file'
        )
      }
      created.push(await platform.mediaHandles.register(principal, {
        workspaceRoot: binding.workspaceRoot,
        path: selection.absolutePath,
        mode: body.data.mode === 'export' ? 'write' : 'read',
        source: 'picker',
        displayName: selection.displayName,
        ...(selection.mimeType ? { mimeType: selection.mimeType } : {})
      }))
    }
  } catch (error) {
    await Promise.all(created.map((handle) =>
      platform.mediaHandles.release(principal, handle.id).catch(() => false)
    ))
    throw error
  }
  return jsonResponse({
    selections: created.map(protectedMediaMetadata)
  }, 201)
}

function protectedMediaMetadata(handle: MediaHandleProjection) {
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
    ...(handle.completionIdentity ? { completionIdentity: handle.completionIdentity } : {}),
    ...(handle.workspaceRelativePath
      ? { workspaceRelativeDisplayLocation: handle.workspaceRelativePath }
      : {}),
    revoked: !handle.available
  })
}

async function resolveProtectedMediaLease(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(
    request,
    ProtectedMediaLeaseResolutionSchema,
    MAX_EXTENSION_VIEW_BODY_BYTES
  )
  if (!body.ok) return body.response
  const binding = body.data.binding
  if (binding.sessionId !== binding.runtimeSessionId) {
    throw new ExtensionViewSessionError('unauthorized', 'Protected media View identity mismatch')
  }
  const projection = platform.viewSessions.authenticate(binding.runtimeSessionId, binding.sessionNonce)
  const target = platform.viewSessions.target(binding.runtimeSessionId)
  if (
    projection.extensionId !== binding.extensionId ||
    projection.extensionVersion !== binding.extensionVersion ||
    projection.contributionId !== binding.contributionId ||
    projection.workspaceRoot !== binding.workspaceRoot ||
    target.extensionId !== binding.extensionId ||
    target.extensionVersion !== binding.extensionVersion ||
    target.contributionId !== binding.contributionId ||
    target.workspaceRoot !== binding.workspaceRoot
  ) {
    throw new ExtensionViewSessionError('unauthorized', 'Protected media View binding mismatch')
  }
  const principal = platform.viewSessions.principal(binding.runtimeSessionId)
  const media = await platform.mediaHandles.resolve(principal, body.data.handleId, 'read')
  if (!media.identity) {
    throw new ExtensionBrokerError('not_found', 'Media resource is unavailable')
  }
  const ttlMs = Math.min(body.data.requestedTtlMs ?? 5 * 60_000, 5 * 60_000)
  return jsonResponse({
    binding,
    handleId: media.id,
    absolutePath: media.absolutePath,
    mimeType: media.mimeType,
    fileIdentity: {
      byteSize: media.identity.size,
      modifiedAtMs: media.identity.mtimeMs,
      device: media.identity.device,
      inode: media.identity.inode
    },
    expiresAt: new Date(Date.now() + ttlMs).toISOString()
  })
}

async function resolveProtectedArtifact(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(
    request,
    ProtectedArtifactResolutionSchema,
    MAX_EXTENSION_VIEW_BODY_BYTES
  )
  if (!body.ok) return body.response
  if (platform.paths.workspaceKey(body.data.workspaceRoot) !== body.data.workspaceId) {
    throw new ExtensionBrokerError('not_found', 'Generated artifact is unavailable')
  }
  const principal: ExtensionPrincipal = {
    extensionId: body.data.ownerExtensionId,
    extensionVersion: body.data.ownerExtensionVersion,
    permissions: ['media.read', 'workspace.read'],
    workspaceRoots: [body.data.workspaceRoot],
    workspaceTrusted: true
  }
  const artifact = await platform.artifacts.getOwned(principal, body.data.artifactId)
  if (artifact.workspaceId !== body.data.workspaceId || artifact.availability !== 'available') {
    throw new ExtensionBrokerError('not_found', 'Generated artifact is unavailable')
  }
  const media = await platform.mediaHandles.resolve(principal, artifact.mediaHandleId, 'read')
  if (media.completionIdentity !== artifact.completionIdentity) {
    throw new ExtensionBrokerError('not_found', 'Generated artifact is unavailable')
  }
  return jsonResponse({
    artifactId: artifact.artifactId,
    absolutePath: media.absolutePath,
    displayName: artifact.displayName,
    mimeType: artifact.mimeType
  })
}

async function createViewSession(
  platform: ExtensionPlatformRuntime,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, CreateViewSessionSchema, MAX_EXTENSION_VIEW_BODY_BYTES)
  if (!body.ok) return body.response
  const workspaceRoot = body.data.workspaceRoot ? resolve(body.data.workspaceRoot) : undefined
  const target = await resolveViewTarget(platform, body.data.contributionId, workspaceRoot)
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
    throw error
  }
}

async function setWorkbenchEnvironment(
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

function disposeViewSession(
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

async function postViewMessage(
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

async function postHostViewMessage(
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

async function dispatchViewRequest(
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

function cancelViewRequest(
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

async function deliverViewMessageToHost(
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

function viewSessionEvents(
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

async function createAgentRun(
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

async function getAgentRun(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  context: RouteContext
): Promise<JsonResponse> {
  const runId = RunIdSchema.parse(context.params.runId)
  return jsonResponse({ schemaVersion: 1, run: projectAgentRun(await platform.agent.getRun(principal, runId)) })
}

async function steerAgentRun(
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

async function cancelAgentRun(
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

async function agentRunEvents(
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
  const events: AgentRunEvent[] = []
  const subscription = await platform.agent.subscribe(principal, {
    runId,
    afterSeq: Math.max(0, cursor.cursor - 1)
  }, (event) => {
    if (events.length < cursor.limit) events.push(projectAgentEvent(event))
  })
  subscription.close()
  return jsonResponse({
    schemaVersion: 1,
    events,
    nextCursor: events.at(-1)?.sequence ?? cursor.cursor,
    hasMore: events.length === cursor.limit
  })
}

async function listOwnThreads(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  request: Request
): Promise<JsonResponse> {
  const parsed = parseQuery(request, z.strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(512).optional(),
    workspace: WorkspaceRootSchema.optional()
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

async function getOwnThread(
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

function listOwnTools(
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

async function listOwnProviders(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal
): Promise<JsonResponse> {
  requirePermission(principal, 'providers.register')
  const providers = (await platform.providerAccounts.listProviders())
    .filter((provider) => provider.ownerExtensionId === principal.extensionId)
    .map(projectProvider)
  return jsonResponse({ schemaVersion: 1, providers })
}

async function probeOwnProvider(
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

async function listOwnProviderModels(
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

async function listOwnAccounts(
  platform: ExtensionPlatformRuntime,
  principalInput: ExtensionPrincipal,
  request: Request
): Promise<JsonResponse> {
  const query = parseQuery(request, z.strictObject({ provider_id: ProviderIdSchema.optional() }))
  if (!query.ok) return query.response
  return accountListResponse(platform, principalInput, query.data.provider_id, true)
}

async function accountListResponse(
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

function sessionRoute(
  platform: ExtensionPlatformRuntime,
  handler: (
    principal: ExtensionPrincipal,
    request: Request,
    context: RouteContext,
    sessionId: string
  ) => Promise<Response | JsonResponse> | Response | JsonResponse
): RouteHandler {
  return withErrors(async (request, context) => {
    const rawSessionId = request.headers.get(EXTENSION_SESSION_ID_HEADER)
    if (!rawSessionId) {
      throw new ExtensionViewSessionError('unauthorized', 'Extension view session identity is required')
    }
    const sessionId = SessionIdSchema.parse(rawSessionId)
    authenticateSession(platform, request, sessionId)
    const release = platform.viewSessions.beginRequest(sessionId)
    try {
      return await handler(platform.viewSessions.principal(sessionId), request, context, sessionId)
    } finally {
      release()
    }
  })
}

function authenticateSession(
  platform: ExtensionPlatformRuntime,
  request: Request,
  sessionId: string
): void {
  const declaredSessionId = request.headers.get(EXTENSION_SESSION_ID_HEADER)
  if (declaredSessionId && declaredSessionId !== sessionId) {
    throw new ExtensionViewSessionError('unauthorized', 'Extension view session identity mismatch')
  }
  const nonce = request.headers.get(EXTENSION_SESSION_NONCE_HEADER) ?? bearerToken(request.headers)
  if (!nonce || nonce.length > 512) {
    throw new ExtensionViewSessionError('unauthorized', 'Extension view session credential is required')
  }
  platform.viewSessions.authenticate(sessionId, nonce)
}

function withErrors(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (error) {
      return publicRouteError(error)
    }
  }
}

async function resolveViewTarget(
  platform: ExtensionPlatformRuntime,
  contributionId: string,
  workspaceRoot?: string
): Promise<{ target: ExtensionViewSessionTarget; manifest: ExtensionManifest }> {
  const parsed = parseQualifiedContributionId(contributionId)
  const entry = await platform.registry.get(parsed.extensionId)
  if (!entry) throw new ExtensionViewSessionError('not_found', 'Extension view was not found')
  const selected = selectExtension(platform, entry, workspaceRoot)
  if (!selected?.enabled || !selected.workspaceTrusted) {
    throw new ExtensionViewSessionError('not_found', 'Extension view was not found')
  }
  const manifest = selected.selected.manifest
  try {
    platform.packageManager.admitManifest(manifest)
  } catch {
    // View sessions are an execution boundary too: browser-only extensions
    // must fail admission before any Webview resource can load.
    throw new ExtensionViewSessionError('not_found', 'Extension view is incompatible with this Kun version')
  }
  const matches = VIEW_CONTRIBUTION_KEYS.flatMap((point) => {
    if (!hasContributionPermission(point, selected.grantedPermissions)) return []
    return manifest.contributes[point]
      .filter((contribution) => contribution.id === parsed.localId)
      .map((contribution) => ({ contribution, point }))
  })
  if (matches.length !== 1) throw new ExtensionViewSessionError('not_found', 'Extension view was not found')
  const match = matches[0]!
  return {
    manifest,
    target: {
      extensionId: parsed.extensionId,
      extensionVersion: manifest.version,
      contributionId,
      localContributionId: parsed.localId,
      entry: match.contribution.entry,
      activationEvent: activationEvent(manifest, parsed.localId, 'onView'),
      ...(workspaceRoot ? { workspaceRoot } : {}),
      grantedPermissions: [...selected.grantedPermissions],
      workspaceTrusted: selected.workspaceTrusted
    }
  }
}

function viewActivationOptions(
  platform: ExtensionPlatformRuntime,
  target: ExtensionViewSessionTarget
): NonNullable<Parameters<ExtensionPlatformRuntime['manager']['activate']>[2]> {
  const workspaceRoot = target.workspaceRoot
  if (!workspaceRoot) return {}
  return {
    workspaceRoot,
    workspaceContext: {
      id: platform.paths.workspaceKey(workspaceRoot),
      name: basename(workspaceRoot) || workspaceRoot,
      root: workspaceRoot,
      trusted: target.workspaceTrusted,
      active: target.workspaceTrusted
    }
  }
}

function selectExtension(
  platform: ExtensionPlatformRuntime,
  entry: ExtensionRegistryEntry,
  workspaceRoot?: string
): SelectedExtension | undefined {
  const selected = entry.useDevelopment
    ? entry.development
    : entry.selectedVersion ? entry.versions[entry.selectedVersion] : undefined
  if (!selected) return undefined
  const workspaceKey = workspaceRoot ? platform.paths.workspaceKey(workspaceRoot) : undefined
  const enabled = workspaceKey && workspaceKey in entry.workspaceEnablement
    ? entry.workspaceEnablement[workspaceKey]!
    : entry.globallyEnabled
  const workspaceTrusted = workspaceKey === undefined || Object.prototype.hasOwnProperty.call(
    entry.workspacePermissionGrants,
    workspaceKey
  )
  const grantedPermissions = workspaceKey === undefined
    ? selected.grantedPermissions
    : workspaceTrusted ? entry.workspacePermissionGrants[workspaceKey]! : []
  return {
    entry,
    selected,
    enabled,
    grantedPermissions: [...grantedPermissions],
    workspaceTrusted,
    ...(workspaceKey ? { workspaceKey } : {})
  }
}

function sanitizeWorkbenchContributions(
  manifest: ExtensionManifest,
  grantedPermissions: readonly string[]
): ExtensionContributions {
  const result: Partial<Record<keyof ExtensionContributions, unknown>> = {}
  for (const key of WORKBENCH_CONTRIBUTION_KEYS) {
    result[key] = hasContributionPermission(key, grantedPermissions)
      ? structuredClone(manifest.contributes[key])
      : []
  }
  return ExtensionContributionsSchema.parse(result)
}

/**
 * Projects inert, Host-rendered rail metadata for an untrusted workspace.
 * Entry paths and resource roots deliberately stay on the trusted runtime
 * side so this projection can never be mistaken for an executable View.
 */
function projectRightRailDiscovery(manifest: ExtensionManifest): {
  views: Array<{
    id: string
    title: string
    icon?: string
    container?: string
    when?: string
    showInRightRail?: boolean
    order: number
  }>
  containers: Array<{
    id: string
    title: string
    icon?: string
    location: 'rightSidebar'
    order: number
  }>
} {
  return {
    views: manifest.contributes['views.rightSidebar'].map((view) => ({
      id: view.id,
      title: view.title,
      ...(view.icon ? { icon: view.icon } : {}),
      ...(view.container ? { container: view.container } : {}),
      ...(view.when ? { when: view.when } : {}),
      ...(view.showInRightRail ? {} : { showInRightRail: false }),
      order: view.order
    })),
    containers: manifest.contributes['views.containers']
      .filter((container) => container.location === 'rightSidebar')
      .map((container) => ({
        id: container.id,
        title: container.title,
        ...(container.icon ? { icon: container.icon } : {}),
        location: 'rightSidebar' as const,
        order: container.order
      }))
  }
}

function hasContributionPermission(
  key: keyof ExtensionContributions,
  grantedPermissions: readonly string[]
): boolean {
  const required = MANIFEST_CONTRIBUTION_PERMISSION_REQUIREMENTS[key]
  return required.every((permission) => grantedPermissions.includes(permission))
}

function activationEvent(
  manifest: ExtensionManifest,
  localId: string,
  kind: 'onView' | 'onCommand' | 'onAuthentication'
): string {
  const preferred = `${kind}:${localId}`
  if (manifest.activationEvents.includes(preferred)) return preferred
  if (manifest.activationEvents.includes('onStartup')) return 'onStartup'
  throw new Error(`extension has no declared activation event for ${preferred}`)
}

function buildViewEventStream(
  platform: ExtensionPlatformRuntime,
  request: Request,
  sessionId: string,
  cursor: number,
  limit: number
): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closeStream: (() => void) | undefined
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let highWater = cursor
      let replaying = true
      const live: ExtensionViewSessionEvent[] = []
      const close = () => {
        if (closed) return
        closed = true
        request.signal.removeEventListener('abort', close)
        unsubscribe?.()
        unsubscribe = undefined
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = undefined
        try { controller.close() } catch { /* already closed */ }
      }
      closeStream = close
      request.signal.addEventListener('abort', close, { once: true })
      if (request.signal.aborted) return close()
      const deliver = (event: ExtensionViewSessionEvent) => {
        if (closed || event.sequence <= highWater) return
        if (controller.desiredSize !== null && controller.desiredSize <= 0) return close()
        highWater = event.sequence
        controller.enqueue(encoder.encode(encodeSse(event.sequence, event.type, event)))
      }
      unsubscribe = platform.viewSessions.subscribe(sessionId, (event) => {
        if (replaying) live.push(event)
        else deliver(event)
      })
      const replay = platform.viewSessions.replay(sessionId, cursor, limit)
      if (replay.cursorExpired) {
        controller.enqueue(encoder.encode(encodeSse(
          replay.oldestAvailableCursor,
          'error',
          { code: 'cursor_expired', oldestAvailableCursor: replay.oldestAvailableCursor }
        )))
        return close()
      }
      for (const event of replay.events) deliver(event)
      if (replay.hasMore) return close()
      for (const event of live.sort((left, right) => left.sequence - right.sequence)) deliver(event)
      replaying = false
      heartbeat = setInterval(() => {
        if (closed) return
        if (controller.desiredSize !== null && controller.desiredSize <= 0) return close()
        controller.enqueue(encoder.encode(encodeSse(highWater, 'heartbeat', { cursor: highWater })))
      }, HEARTBEAT_INTERVAL_MS)
      heartbeat.unref?.()
    },
    cancel() {
      closed = true
      if (closeStream) request.signal.removeEventListener('abort', closeStream)
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    }
  })
  return sseResponse(stream)
}

function buildAgentEventStream(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  request: Request,
  runId: string,
  cursor: number,
  limit: number
): Response {
  const encoder = new TextEncoder()
  let subscription: { close(): void } | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closeStream: (() => void) | undefined
  let closed = false
  let delivered = 0
  let highWater = cursor
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        request.signal.removeEventListener('abort', close)
        subscription?.close()
        subscription = undefined
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = undefined
        try { controller.close() } catch { /* already closed */ }
      }
      closeStream = close
      request.signal.addEventListener('abort', close, { once: true })
      if (request.signal.aborted) return close()
      try {
        subscription = await platform.agent.subscribe(principal, {
          runId,
          afterSeq: Math.max(0, cursor - 1)
        }, (internal) => {
          if (closed || delivered >= limit) return
          const event = projectAgentEvent(internal)
          if (event.sequence <= highWater) return
          if (controller.desiredSize !== null && controller.desiredSize <= 0) return close()
          highWater = event.sequence
          delivered += 1
          controller.enqueue(encoder.encode(encodeSse(event.sequence, event.type, event)))
          if (event.type === 'terminal' || delivered >= limit) close()
        })
        if (closed) {
          subscription.close()
          subscription = undefined
          return
        }
        heartbeat = setInterval(() => {
          if (closed) return
          if (controller.desiredSize !== null && controller.desiredSize <= 0) return close()
          controller.enqueue(encoder.encode(encodeSse(highWater, 'heartbeat', { cursor: highWater })))
        }, HEARTBEAT_INTERVAL_MS)
        heartbeat.unref?.()
      } catch (error) {
        if (!closed) {
          controller.enqueue(encoder.encode(encodeSse(highWater, 'error', safeErrorBody(error))))
          close()
        }
      }
    },
    cancel() {
      closed = true
      if (closeStream) request.signal.removeEventListener('abort', closeStream)
      subscription?.close()
      if (heartbeat) clearInterval(heartbeat)
    }
  })
  return sseResponse(stream)
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  })
}

function encodeSse(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function parseEventQuery(
  request: Request
): { ok: true; cursor: number; limit: number } | { ok: false; response: JsonResponse } {
  const url = new URL(request.url)
  const unknown = [...url.searchParams.keys()].filter((key) => key !== 'cursor' && key !== 'limit')
  if (unknown.length > 0) {
    return { ok: false, response: ERRORS.validation('invalid extension event query', { unknown }) }
  }
  if (url.searchParams.getAll('cursor').length > 1 || url.searchParams.getAll('limit').length > 1) {
    return { ok: false, response: ERRORS.validation('duplicate extension event query parameter') }
  }
  const parsed = z.strictObject({
    cursor: z.coerce.number().int().min(0).safe().default(0),
    limit: z.coerce.number().int().min(1).max(MAX_EVENT_LIMIT).default(DEFAULT_EVENT_LIMIT)
  }).safeParse({
    cursor: url.searchParams.get('cursor') ?? request.headers.get('last-event-id') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined
  })
  if (!parsed.success) {
    return { ok: false, response: ERRORS.validation('invalid extension event query', parsed.error.issues) }
  }
  return { ok: true, cursor: parsed.data.cursor, limit: parsed.data.limit }
}

function acceptsSse(request: Request): boolean {
  return request.headers.get('accept')?.split(',').some((value) => value.trim().startsWith('text/event-stream')) ?? false
}

async function expandProviderPermissions(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal
): Promise<ExtensionPrincipal> {
  const permissions = new Set(principal.permissions)
  const entry = await platform.registry.get(principal.extensionId)
  const manifest = entry
    ? (entry.useDevelopment
        ? entry.development?.manifest
        : entry.selectedVersion ? entry.versions[entry.selectedVersion]?.manifest : undefined)
    : undefined
  for (const declaration of manifest?.contributes.modelProviders ?? []) {
    const providerId = extensionProviderId(principal.extensionId, declaration.id)
    for (const operation of ['use', 'manage'] as const) {
      if (permissions.has(`accounts.${operation}:${declaration.id}`)) {
        permissions.add(`accounts.${operation}:${providerId}`)
      }
    }
    if (permissions.has(`accounts.secrets.read:${declaration.id}`)) {
      permissions.add(`accounts.secrets.read:${providerId}`)
    }
  }
  return { ...principal, permissions: [...permissions] }
}

async function resolveOwnedProviderId(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  providerIdInput: string
): Promise<string> {
  const direct = await platform.providerAccounts.getProvider(providerIdInput)
  if (direct?.ownerExtensionId === principal.extensionId) return direct.id
  const canonical = extensionProviderId(principal.extensionId, providerIdInput)
  const provider = await platform.providerAccounts.getProvider(canonical)
  if (!provider || provider.ownerExtensionId !== principal.extensionId) {
    throw new ExtensionBrokerError('not_found', 'Extension-owned resource was not found')
  }
  return provider.id
}

async function assertOwnedAccount(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  providerId: string,
  accountId: string
): Promise<void> {
  const account = await platform.providerAccounts.getAccount(accountId)
  if (!account || account.ownerExtensionId !== principal.extensionId || account.providerId !== providerId) {
    throw new ExtensionBrokerError('not_found', 'Extension-owned resource was not found')
  }
}

function requireAccountUse(principal: ExtensionPrincipal, providerId: string): void {
  requirePermission(principal, `accounts.use:${providerId}`)
}

function requirePermission(principal: ExtensionPrincipal, permission: string): void {
  if (!principal.permissions.includes(permission)) {
    throw new ExtensionBrokerError('permission_denied', `Missing permission: ${permission}`)
  }
}

function projectProvider(provider: ExtensionProviderDefinition) {
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

function projectAgentRun(run: ExtensionAgentRun): AgentRun {
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
    ...(binding ? { providerBinding: binding } : {}),
    ...(run.usage ? { usage: publicUsage(run.usage) } : {}),
    createdAt: run.createdAt,
    updatedAt: run.finishedAt ?? run.createdAt,
    ...(run.finishedAt ? { terminalAt: run.finishedAt } : {}),
    ...(run.error ? { error: { code: 'agent_run_failed', message: run.error.slice(0, 4096) } } : {})
  })
}

function projectAgentEvent(event: ExtensionAgentEvent): AgentRunEvent {
  const base = {
    runId: event.runId,
    threadId: event.threadId,
    sequence: event.seq + 1,
    timestamp: event.timestamp
  }
  if (event.type === 'turn_started') return AgentRunEventSchema.parse({ ...base, type: 'state', state: 'running' })
  if (event.type === 'approval_requested') return AgentRunEventSchema.parse({ ...base, type: 'state', state: 'waiting-approval' })
  if (event.type === 'user_input_requested') return AgentRunEventSchema.parse({ ...base, type: 'state', state: 'waiting-user-input' })
  if (event.type === 'turn_completed') return AgentRunEventSchema.parse({ ...base, type: 'terminal', state: 'completed' })
  if (event.type === 'turn_aborted') return AgentRunEventSchema.parse({ ...base, type: 'terminal', state: 'cancelled' })
  if (event.type === 'turn_failed') return AgentRunEventSchema.parse({
    ...base,
    type: 'terminal',
    state: 'failed',
    error: safeJson(event.payload)
  })
  if (event.type === 'usage') {
    const usage = isObject(event.payload.usage) ? publicUsage(event.payload.usage as never) : {}
    return AgentRunEventSchema.parse({ ...base, type: 'usage', usage })
  }
  if (event.type === 'turn_steered') return AgentRunEventSchema.parse({
    ...base,
    type: 'steering-accepted',
    steeringId: `steer_${event.seq}`
  })
  if (event.type === 'assistant_text_delta' || event.type === 'item_completed') {
    return AgentRunEventSchema.parse({
      ...base,
      type: 'message',
      role: 'assistant',
      content: safeJson(event.payload)
    })
  }
  return AgentRunEventSchema.parse({
    ...base,
    type: 'progress',
    message: event.type,
    data: safeJson(event.payload)
  })
}

function projectOwnedThread(principal: ExtensionPrincipal, thread: ExtensionOwnedThread) {
  return {
    id: thread.id,
    title: thread.title,
    ownerExtensionId: principal.extensionId,
    ownerExtensionVersion: thread.ownerExtensionVersion,
    extensionVisibility: thread.visibility,
    workspace: thread.workspace,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt
  }
}

function publicBudget(budget: ExtensionAgentRun['effectiveBudget']) {
  return {
    maxTokens: budget.maxTokens,
    maxElapsedMs: budget.maxElapsedMs,
    maxModelRequests: budget.maxModelRequests,
    maxToolInvocations: budget.maxToolInvocations,
    maxEvents: budget.maxRetainedEvents
  }
}

function publicUsage(usage: {
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

function agentInputText(input: z.infer<typeof AgentCreateRunRequestSchema>['input']): string {
  if (typeof input === 'string') return input
  return input.content.map((part) => {
    if (part.type === 'text') return part.text
    return `[${part.type}${'name' in part && part.name ? `: ${part.name}` : ''}; ${part.mimeType}]`
  }).join('\n')
}

function parseQualifiedContributionId(input: string): { extensionId: string; localId: string } {
  const match = /^extension:([^/]+)\/(.+)$/.exec(input)
  if (!match) throw new ExtensionViewSessionError('not_found', 'Extension view was not found')
  return {
    extensionId: ExtensionIdSchema.parse(match[1]),
    localId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).parse(match[2])
  }
}

async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes: number
): Promise<{ ok: true; data: z.output<T> } | { ok: false; response: JsonResponse }> {
  const body = await readJsonBody(request, maxBytes)
  if (!body.ok) return body
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) {
    return { ok: false, response: ERRORS.validation('invalid extension request', parsed.error.issues) }
  }
  return { ok: true, data: parsed.data }
}

function parseQuery<T extends z.ZodType>(
  request: Request,
  schema: T,
  aliases: Record<string, string> = {}
): { ok: true; data: z.output<T> } | { ok: false; response: JsonResponse } {
  const url = new URL(request.url)
  const input: Record<string, string> = {}
  for (const [key, value] of url.searchParams) {
    const resolvedKey = aliases[key] ?? key
    if (resolvedKey in input) {
      return { ok: false, response: ERRORS.validation(`duplicate extension query parameter: ${resolvedKey}`) }
    }
    input[resolvedKey] = value
  }
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, response: ERRORS.validation('invalid extension query', parsed.error.issues) }
  }
  return { ok: true, data: parsed.data }
}

function publicRouteError(error: unknown): JsonResponse {
  if (error instanceof z.ZodError) return ERRORS.validation('invalid extension request', error.issues)
  if (error instanceof ExtensionConfigurationConflictError) {
    return jsonResponse({
      code: 'extension_configuration_conflict',
      message: error.message,
      currentRevision: error.currentRevision
    }, 409)
  }
  if (error instanceof ExtensionViewSessionError) {
    if (error.code === 'not_found') return ERRORS.notFound(error.message)
    if (error.code === 'unauthorized') return ERRORS.unauthorized(error.message)
    if (error.code === 'rate_limited' || error.code === 'session_limit') return ERRORS.rateLimited(error.message)
    if (error.code === 'payload_too_large') {
      return jsonResponse({ code: error.code, message: error.message }, 413)
    }
  }
  if (error instanceof ExtensionBrokerError) {
    if (error.code === 'permission_denied' || error.code === 'workspace_denied') return ERRORS.forbidden(error.message)
    if (error.code === 'not_found') return ERRORS.notFound(error.message)
    if (error.code === 'conflict') return ERRORS.conflict(error.message)
    return ERRORS.validation(error.message)
  }
  if (error instanceof ExtensionMediaHandleError) {
    if (
      error.code === 'permission_denied' ||
      error.code === 'workspace_untrusted' ||
      error.code === 'workspace_denied' ||
      error.code === 'mode_denied'
    ) return ERRORS.forbidden(error.message)
    if (
      error.code === 'not_found' ||
      error.code === 'file_changed' ||
      error.code === 'handle_consumed'
    ) return ERRORS.notFound('Protected media selection is not available')
    if (error.code === 'handle_limit') return ERRORS.rateLimited(error.message)
    return ERRORS.validation(error.message)
  }
  return jsonResponse(safeErrorBody(error), 500)
}

function safeErrorBody(error: unknown): { code: string; message: string } {
  return {
    code: 'extension_operation_failed',
    message: redactSecretText(error instanceof Error ? error.message : 'Extension operation failed').slice(0, 4096)
  }
}

function safeJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value, (key, current) => {
    if (/(?:token|secret|authorization|cookie|credential|nonce)/i.test(key)) return '[REDACTED]'
    return current
  })) as JsonValue
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
