import { isAbsolute } from 'node:path'
import { z } from 'zod'
import {
  ManifestLocaleTagSchema,
  resolveExtensionManifestLocale
} from '@kun/extension-api'
import { redactSecrets, redactSecretText } from '../../config/secret-redaction.js'
import {
  ExtensionError,
  ExtensionIndexClient,
  ExtensionManager,
  ExtensionPackageManager,
  ExtensionRegistry,
  inspectKunxArchive,
  type ArchiveValidationOptions,
  type BundledExtensionSeedResult,
  type DevelopmentExtensionRecord,
  type ExtensionManifest,
  type ExtensionRegistryEntry,
  type InstalledExtensionVersion
} from '../../extensions/index.js'
import { isRuntimeTokenAuthorized } from '../auth.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { Router, type RouteContext, type RouteHandler } from '../router.js'
import { ERRORS } from './runtime-error.js'

const MAX_EXTENSION_CONTROL_BODY_BYTES = 64 * 1024
const MAX_PATH_LENGTH = 4_096
const MAX_PERMISSION_COUNT = 500
const DEFAULT_PAGE_LIMIT = 100
const MAX_PAGE_LIMIT = 500

const ExtensionIdSchema = z.string().regex(
  /^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/,
  'extension id must be publisher.name'
)
const VersionSchema = z.string().trim().min(1).max(128)
const PathSchema = z.string().trim().min(1).max(MAX_PATH_LENGTH)
const PermissionListSchema = z.array(z.string().trim().min(1).max(256))
  .max(MAX_PERMISSION_COUNT)
  .superRefine((permissions, context) => {
    if (new Set(permissions).size !== permissions.length) {
      context.addIssue({ code: 'custom', message: 'permissions must not contain duplicates' })
    }
  })

const InstallRequestSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('archive'),
    path: PathSchema,
    grantedPermissions: PermissionListSchema,
    select: z.boolean().default(true),
    enable: z.boolean().default(true)
  }),
  z.strictObject({
    source: z.literal('development'),
    path: PathSchema,
    grantedPermissions: PermissionListSchema,
    select: z.boolean().default(true),
    enable: z.boolean().default(true)
  }),
  z.strictObject({
    source: z.literal('index'),
    indexUrl: z.string().url().max(MAX_PATH_LENGTH),
    extensionId: ExtensionIdSchema,
    version: VersionSchema,
    grantedPermissions: PermissionListSchema,
    select: z.boolean().default(true),
    enable: z.boolean().default(true)
  })
])

const InspectRequestSchema = z.strictObject({ path: PathSchema })
const ScopeRequestSchema = z.strictObject({ workspaceRoot: PathSchema.optional() })
const SelectRequestSchema = z.strictObject({ version: VersionSchema })
const PermissionRequestSchema = z.strictObject({
  workspaceRoot: PathSchema,
  expectedVersion: VersionSchema,
  permissions: PermissionListSchema.nullable()
})

export type ExtensionManagementRoutes = {
  packageManager: ExtensionPackageManager
  registry: ExtensionRegistry
  manager: ExtensionManager
  indexClient: ExtensionIndexClient
  validation: ArchiveValidationOptions
  runtimeToken: string
  insecure: boolean
  bundledSeedResults?: readonly BundledExtensionSeedResult[]
}

/**
 * Registers the authenticated extension management control plane.
 *
 * This is deliberately separate from `buildRouter` so the Kun composition root
 * can supply its single ExtensionManager instance without the route module
 * constructing a second runtime.
 */
export function registerExtensionManagementRoutes(
  router: Router,
  runtime: ExtensionManagementRoutes
): void {
  const authenticated = (handler: RouteHandler): RouteHandler => async (request, context) => {
    if (!isRuntimeTokenAuthorized(request.headers, runtime.runtimeToken)) {
      return ERRORS.unauthorized()
    }
    try {
      return await handler(request, context)
    } catch (error) {
      return extensionRouteError(error)
    }
  }

  router.add('GET', '/v1/extensions', authenticated((request) => listExtensions(runtime, request)))
  router.add('POST', '/v1/extensions/inspect', authenticated((request) => inspectExtension(runtime, request)))
  router.add('POST', '/v1/extensions/install', authenticated((request) => installExtension(runtime, request)))
  // Static paths must be registered before `:id` because the router uses first-match ordering.
  router.add('GET', '/v1/extensions/diagnostics', authenticated((request) => listExtensionDiagnostics(runtime, request)))
  router.add('GET', '/v1/extensions/:id', authenticated((_request, context) => getExtension(runtime, context)))
  router.add('GET', '/v1/extensions/:id/diagnostics', authenticated((_request, context) => getExtensionDiagnostic(runtime, context)))
  router.add('POST', '/v1/extensions/:id/select', authenticated((request, context) => selectExtensionVersion(runtime, request, context)))
  router.add('POST', '/v1/extensions/:id/enable', authenticated((request, context) => setExtensionEnabled(runtime, request, context, true)))
  router.add('POST', '/v1/extensions/:id/disable', authenticated((request, context) => setExtensionEnabled(runtime, request, context, false)))
  router.add('PUT', '/v1/extensions/:id/permissions', authenticated((request, context) => setExtensionPermissions(runtime, request, context)))
  router.add('POST', '/v1/extensions/:id/rollback', authenticated((_request, context) => rollbackExtension(runtime, context)))
  router.add('POST', '/v1/extensions/:id/reload', authenticated((_request, context) => reloadExtension(runtime, context)))
  router.add('POST', '/v1/extensions/:id/retry', authenticated((_request, context) => retryExtension(runtime, context)))
  router.add('DELETE', '/v1/extensions/:id/versions/:version', authenticated((_request, context) => uninstallExtensionVersion(runtime, context)))
  router.add('DELETE', '/v1/extensions/:id', authenticated((_request, context) => uninstallExtension(runtime, context)))
}

/** Convenience builder used by focused tests and non-standard embedders. */
export function buildExtensionManagementRouter(runtime: ExtensionManagementRoutes): Router {
  const router = new Router()
  registerExtensionManagementRoutes(router, runtime)
  return router
}

async function listExtensions(runtime: ExtensionManagementRoutes, request: Request): Promise<JsonResponse> {
  const page = parsePage(request)
  if (!page.ok) return page.response
  const registry = await runtime.registry.read()
  const ids = Object.keys(registry.extensions).sort()
  const start = page.cursor === undefined
    ? 0
    : ids.findIndex((id) => id > page.cursor!)
  const offset = start < 0 ? ids.length : start
  const selectedIds = ids.slice(offset, offset + page.limit)
  const workspaceKey = page.workspaceRoot === undefined
    ? undefined
    : runtime.packageManager.paths.workspaceKey(page.workspaceRoot)
  const extensions = selectedIds.map((id) => projectRegistryEntry(
    registry.extensions[id]!,
    workspaceKey,
    page.locale
  ))
  const hasMore = offset + selectedIds.length < ids.length
  return jsonResponse({
    schemaVersion: 1,
    revision: registry.revision,
    extensions,
    nextCursor: hasMore ? selectedIds.at(-1) : undefined
  })
}

async function getExtension(
  runtime: ExtensionManagementRoutes,
  context: RouteContext
): Promise<JsonResponse> {
  const extensionId = parseExtensionId(context)
  const entry = await runtime.registry.get(extensionId)
  if (entry === undefined) return ERRORS.notFound(`extension not found: ${extensionId}`)
  return jsonResponse({ schemaVersion: 1, extension: projectRegistryEntry(entry) })
}

async function inspectExtension(
  runtime: ExtensionManagementRoutes,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, InspectRequestSchema, 'invalid extension inspection request')
  if (!body.ok) return body.response
  const inspection = await inspectKunxArchive(body.data.path, runtime.validation)
  return jsonResponse({
    schemaVersion: 1,
    inspection: projectInspection(inspection)
  })
}

async function installExtension(
  runtime: ExtensionManagementRoutes,
  request: Request
): Promise<JsonResponse> {
  const body = await parseBody(request, InstallRequestSchema, 'invalid extension install request')
  if (!body.ok) return body.response
  const input = body.data
  if (input.source === 'archive') {
    const installed = await runtime.packageManager.installArchive(input.path, {
      grantedPermissions: input.grantedPermissions,
      select: input.select,
      enable: input.enable
    })
    return jsonResponse({ schemaVersion: 1, extension: projectInstalledVersion(installed) }, 201)
  }
  if (input.source === 'development') {
    const development = await runtime.packageManager.registerDevelopment(input.path, {
      grantedPermissions: input.grantedPermissions,
      select: input.select,
      enable: input.enable
    })
    return jsonResponse({ schemaVersion: 1, extension: projectDevelopment(development) }, 201)
  }
  const installed = await runtime.indexClient.installExact(
    input.indexUrl,
    input.extensionId,
    input.version,
    runtime.packageManager,
    {
      grantedPermissions: input.grantedPermissions,
      select: input.select,
      enable: input.enable
    }
  )
  return jsonResponse({ schemaVersion: 1, extension: projectInstalledVersion(installed) }, 201)
}

async function selectExtensionVersion(
  runtime: ExtensionManagementRoutes,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const extensionId = parseExtensionId(context)
  const body = await parseBody(request, SelectRequestSchema, 'invalid extension version selection')
  if (!body.ok) return body.response
  await runtime.packageManager.selectVersion(extensionId, body.data.version)
  return changedEntry(runtime, extensionId)
}

async function setExtensionEnabled(
  runtime: ExtensionManagementRoutes,
  request: Request,
  context: RouteContext,
  enabled: boolean
): Promise<JsonResponse> {
  const extensionId = parseExtensionId(context)
  const body = await parseBody(request, ScopeRequestSchema, 'invalid extension enablement request')
  if (!body.ok) return body.response
  if (body.data.workspaceRoot === undefined) {
    await runtime.packageManager.setGlobalEnabled(extensionId, enabled)
  } else {
    const workspaceKey = runtime.packageManager.paths.workspaceKey(body.data.workspaceRoot)
    await runtime.packageManager.setWorkspaceEnabled(
      extensionId,
      workspaceKey,
      enabled,
      body.data.workspaceRoot
    )
  }
  return changedEntry(runtime, extensionId)
}

async function setExtensionPermissions(
  runtime: ExtensionManagementRoutes,
  request: Request,
  context: RouteContext
): Promise<JsonResponse> {
  const extensionId = parseExtensionId(context)
  const body = await parseBody(request, PermissionRequestSchema, 'invalid extension permission request')
  if (!body.ok) return body.response
  const workspaceKey = runtime.packageManager.paths.workspaceKey(body.data.workspaceRoot)
  await runtime.packageManager.setWorkspacePermissionGrant(
    extensionId,
    workspaceKey,
    body.data.permissions ?? undefined,
    body.data.expectedVersion,
    body.data.workspaceRoot
  )
  return changedEntry(runtime, extensionId)
}

async function rollbackExtension(
  runtime: ExtensionManagementRoutes,
  context: RouteContext
): Promise<JsonResponse> {
  const extensionId = parseExtensionId(context)
  await runtime.packageManager.rollback(extensionId)
  return changedEntry(runtime, extensionId)
}

async function reloadExtension(
  runtime: ExtensionManagementRoutes,
  context: RouteContext
): Promise<JsonResponse> {
  const extensionId = parseExtensionId(context)
  const development = await runtime.packageManager.reloadDevelopment(extensionId)
  return jsonResponse({ schemaVersion: 1, extension: projectDevelopment(development) })
}

async function retryExtension(
  runtime: ExtensionManagementRoutes,
  context: RouteContext
): Promise<JsonResponse> {
  const extensionId = parseExtensionId(context)
  await runtime.manager.retry(extensionId)
  return getExtensionDiagnostic(runtime, context)
}

async function uninstallExtensionVersion(
  runtime: ExtensionManagementRoutes,
  context: RouteContext
): Promise<JsonResponse> {
  const extensionId = parseExtensionId(context)
  const version = VersionSchema.parse(context.params.version)
  await runtime.packageManager.uninstallVersion(extensionId, version)
  const entry = await runtime.registry.get(extensionId)
  return jsonResponse({
    schemaVersion: 1,
    removed: { extensionId, version },
    extension: entry === undefined ? undefined : projectRegistryEntry(entry),
    dataPreserved: true
  })
}

async function uninstallExtension(
  runtime: ExtensionManagementRoutes,
  context: RouteContext
): Promise<JsonResponse> {
  const extensionId = parseExtensionId(context)
  await runtime.packageManager.uninstall(extensionId)
  return jsonResponse({
    schemaVersion: 1,
    removed: { extensionId },
    dataPreserved: true
  })
}

async function getExtensionDiagnostic(
  runtime: ExtensionManagementRoutes,
  context: RouteContext
): Promise<JsonResponse> {
  const extensionId = parseExtensionId(context)
  const entry = await runtime.registry.get(extensionId)
  const diagnostic = await runtime.manager.diagnostic(extensionId)
  if (entry === undefined && diagnostic.lifecycleState === 'inactive' && diagnostic.version === undefined) {
    return ERRORS.notFound(`extension not found: ${extensionId}`)
  }
  return jsonResponse({
    schemaVersion: 1,
    extension: entry === undefined ? undefined : projectRegistryEntry(entry),
    diagnostic: redactSecrets(diagnostic)
  })
}

async function listExtensionDiagnostics(
  runtime: ExtensionManagementRoutes,
  request: Request
): Promise<JsonResponse> {
  const page = parsePage(request)
  if (!page.ok) return page.response
  const [registry, hostDiagnostics] = await Promise.all([
    runtime.registry.read(),
    runtime.manager.listDiagnostics()
  ])
  const byId = new Map(hostDiagnostics.map((diagnostic) => [diagnostic.extensionId, diagnostic]))
  const seedsById = new Map(
    (runtime.bundledSeedResults ?? []).map((diagnostic) => [diagnostic.extensionId, diagnostic])
  )
  const ids = [...new Set([
    ...Object.keys(registry.extensions),
    ...byId.keys(),
    ...seedsById.keys()
  ])].sort()
  const start = page.cursor === undefined ? 0 : ids.findIndex((id) => id > page.cursor!)
  const offset = start < 0 ? ids.length : start
  const selectedIds = ids.slice(offset, offset + page.limit)
  const selectedHostDiagnostics = await Promise.all(selectedIds.map((extensionId) =>
    byId.get(extensionId) ?? runtime.manager.diagnostic(extensionId)
  ))
  const diagnostics = selectedIds.map((extensionId, index) => ({
    extensionId,
    extension: registry.extensions[extensionId] === undefined
      ? undefined
      : projectRegistryEntry(registry.extensions[extensionId]!),
    host: redactSecrets(selectedHostDiagnostics[index]!),
    seed: seedsById.has(extensionId) ? redactSecrets(seedsById.get(extensionId)!) : undefined
  }))
  const hasMore = offset + selectedIds.length < ids.length
  return jsonResponse({
    schemaVersion: 1,
    diagnostics,
    nextCursor: hasMore ? selectedIds.at(-1) : undefined
  })
}

async function changedEntry(
  runtime: ExtensionManagementRoutes,
  extensionId: string
): Promise<JsonResponse> {
  const entry = await runtime.registry.get(extensionId)
  if (entry === undefined) return ERRORS.notFound(`extension not found: ${extensionId}`)
  return jsonResponse({ schemaVersion: 1, extension: projectRegistryEntry(entry) })
}

function parseExtensionId(context: RouteContext): string {
  return ExtensionIdSchema.parse(context.params.id)
}

async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  message: string
): Promise<{ ok: true; data: z.output<T> } | { ok: false; response: JsonResponse }> {
  const body = await readJsonBody(request, MAX_EXTENSION_CONTROL_BODY_BYTES)
  if (!body.ok) return body
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) return { ok: false, response: ERRORS.validation(message, parsed.error.issues) }
  return { ok: true, data: parsed.data }
}

function parsePage(
  request: Request
): {
  ok: true
  limit: number
  cursor?: string
  workspaceRoot?: string
  locale?: string
} | { ok: false; response: JsonResponse } {
  const url = new URL(request.url)
  const rawLimit = url.searchParams.get('limit')
  const rawCursor = url.searchParams.get('cursor')
  const rawWorkspaceRoot = url.searchParams.get('workspace_root')
  const rawLocale = url.searchParams.get('locale')
  const parsed = z.strictObject({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
    cursor: ExtensionIdSchema.optional(),
    workspaceRoot: PathSchema.refine(isAbsolute, 'workspace_root must be absolute').optional(),
    locale: ManifestLocaleTagSchema.optional()
  }).safeParse({
    limit: rawLimit ?? undefined,
    cursor: rawCursor ?? undefined,
    workspaceRoot: rawWorkspaceRoot ?? undefined,
    locale: rawLocale ?? undefined
  })
  if (!parsed.success) {
    return { ok: false, response: ERRORS.validation('invalid extension list query', parsed.error.issues) }
  }
  return { ok: true, ...parsed.data }
}

function projectRegistryEntry(
  entry: ExtensionRegistryEntry,
  workspaceKey?: string,
  locale?: string
) {
  const workspaceTrusted = workspaceKey === undefined || Object.prototype.hasOwnProperty.call(
    entry.workspacePermissionGrants,
    workspaceKey
  )
  const effectiveEnabled = workspaceKey !== undefined && workspaceKey in entry.workspaceEnablement
    ? entry.workspaceEnablement[workspaceKey]!
    : entry.globallyEnabled
  return {
    id: entry.id,
    selectedVersion: entry.selectedVersion,
    previousSelectedVersion: entry.previousSelectedVersion,
    globallyEnabled: entry.globallyEnabled,
    workspaceEnablement: structuredClone(entry.workspaceEnablement),
    workspacePermissionGrants: structuredClone(entry.workspacePermissionGrants),
    useDevelopment: entry.useDevelopment,
    effectiveEnabled,
    effectiveWorkspaceEnabled: effectiveEnabled,
    workspaceTrusted,
    workspaceGrantedPermissions: workspaceKey === undefined
      ? undefined
      : structuredClone(entry.workspacePermissionGrants[workspaceKey]),
    versions: Object.values(entry.versions)
      .sort((left, right) => left.version.localeCompare(right.version))
      .map((version) => projectInstalledVersion(version, locale)),
    development: entry.development === undefined
      ? undefined
      : projectDevelopment(entry.development, locale)
  }
}

function projectInstalledVersion(version: InstalledExtensionVersion, locale?: string) {
  const manifest = resolveExtensionManifestLocale(version.manifest, locale)
  return {
    id: `${manifest.publisher}.${manifest.name}`,
    version: version.version,
    path: version.packagePath,
    sha256: version.archiveSha256,
    source: structuredClone(version.source),
    signatureStatus: version.signatureStatus,
    requestedPermissions: [...version.requestedPermissions],
    grantedPermissions: [...version.grantedPermissions],
    installedAt: version.installedAt,
    apiVersion: manifest.apiVersion,
    manifestVersion: manifest.manifestVersion,
    stateSchemaVersion: manifest.stateSchemaVersion,
    displayName: manifest.displayName,
    description: manifest.description,
    icon: projectManagementIcon(manifest),
    views: projectManagedViews(manifest),
    modelProviders: structuredClone(manifest.contributes.modelProviders),
    authentication: structuredClone(manifest.contributes.authentication),
    mutable: false
  }
}

function projectDevelopment(development: DevelopmentExtensionRecord, locale?: string) {
  const manifest = resolveExtensionManifestLocale(development.manifest, locale)
  return {
    id: `${manifest.publisher}.${manifest.name}`,
    version: manifest.version,
    path: development.path,
    digest: development.digest,
    source: structuredClone(development.source),
    requestedPermissions: [...development.requestedPermissions],
    grantedPermissions: [...development.grantedPermissions],
    registeredAt: development.registeredAt,
    reloadedAt: development.reloadedAt,
    generation: development.generation,
    apiVersion: manifest.apiVersion,
    manifestVersion: manifest.manifestVersion,
    stateSchemaVersion: manifest.stateSchemaVersion,
    displayName: manifest.displayName,
    description: manifest.description,
    icon: projectManagementIcon(manifest),
    views: projectManagedViews(manifest),
    modelProviders: structuredClone(manifest.contributes.modelProviders),
    authentication: structuredClone(manifest.contributes.authentication),
    mutable: true
  }
}

function projectManagedViews(manifest: ExtensionManifest) {
  return (['views.rightSidebar', 'views.editorTab', 'views.fullPage'] as const).flatMap((point) =>
    manifest.contributes[point].map((view) => ({
      id: view.id,
      title: view.title,
      point
    }))
  )
}

function projectManagementIcon(manifest: ExtensionManifest): string | undefined {
  if (manifest.icon) return manifest.icon
  const containers = manifest.contributes['views.containers']
  for (const container of containers) {
    if (container.icon) return container.icon
  }
  for (const point of [
    'views.rightSidebar',
    'views.editorTab',
    'views.fullPage',
    'views.leftSidebar',
    'views.auxiliaryPanel'
  ] as const) {
    const icon = manifest.contributes[point].find((view) => view.icon)?.icon
    if (icon) return icon
  }
  return undefined
}

function projectInspection(inspection: Awaited<ReturnType<typeof inspectKunxArchive>>) {
  return {
    archivePath: inspection.archivePath,
    archiveSha256: inspection.archiveSha256,
    id: `${inspection.manifest.publisher}.${inspection.manifest.name}`,
    version: inspection.manifest.version,
    manifest: structuredClone(inspection.manifest),
    signatureStatus: inspection.signatureStatus,
    fileCount: inspection.fileCount,
    expandedBytes: inspection.expandedBytes
  }
}

function extensionRouteError(error: unknown): JsonResponse {
  if (error instanceof z.ZodError) {
    return ERRORS.validation('invalid extension route parameter', error.issues)
  }
  if (!(error instanceof ExtensionError)) {
    return jsonResponse({
      code: 'EXTENSION_INTERNAL_ERROR',
      message: 'Extension operation failed'
    }, 500)
  }
  const code = error.code
  const status = extensionErrorStatus(code)
  return jsonResponse({
    code,
    message: redactSecretText(error.message).slice(0, 4_096),
    details: redactSecrets(error.details)
  }, status)
}

function extensionErrorStatus(code: string): number {
  if (/(?:NOT_FOUND|NOT_INSTALLED|NOT_REGISTERED|VERSION_NOT_INSTALLED)$/.test(code)) return 404
  if (/(?:PERMISSION_DENIED|PERMISSION_CONSENT_REQUIRED|UNAUTHORIZED)/.test(code)) return 403
  if (/(?:IMMUTABLE|CONFLICT|COLLISION|ROLLBACK_UNAVAILABLE|RELOAD_REQUIRED|NOT_SELECTED)/.test(code)) return 409
  if (/(?:DISABLED|UNAVAILABLE|CIRCUIT_OPEN|RESTART_BACKOFF|HOST_CRASHED)/.test(code)) return 503
  if (/(?:INVALID|MISSING|MISMATCH|INCOMPATIBLE|UNSUPPORTED|LIMIT|REQUIRED|NOT_FILE)/.test(code)) return 400
  return 500
}
