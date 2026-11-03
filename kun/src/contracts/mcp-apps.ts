import { z } from 'zod'

/**
 * MCP Apps host contracts: pure normalization of tool/resource `_meta` and the
 * desktop-facing request shapes. The page <-> host wire protocol belongs to the
 * official `@modelcontextprotocol/ext-apps` SDK; this module never re-declares
 * its method names. Shared by the runtime, Electron Main and the renderer.
 */

export const MCP_APPS_EXTENSION_ID = 'io.modelcontextprotocol/ui' as const
export const MCP_APP_HTML_MIME_TYPE = 'text/html;profile=mcp-app' as const
export const MCP_APPS_RESOURCE_SCHEME = 'ui://' as const
export const MCP_APPS_RESOURCE_URI_MAX_CHARS = 2_048
export const MCP_APPS_SURFACE_ID_MAX_CHARS = 128
/** Initial HTML document served to the sandbox. Larger documents are rejected. */
export const MCP_APP_HTML_MAX_BYTES = 16 * 1024 * 1024
/** Any other resource read on behalf of a page (decoded bytes). */
export const MCP_APP_RESOURCE_MAX_BYTES = 8 * 1024 * 1024
/** Tool results forwarded to a page on connect; larger fields are omitted. */
export const MCP_APP_STRUCTURED_CONTENT_MAX_BYTES = 64 * 1024
export const MCP_APP_CONTENT_MAX_BYTES = 32 * 1024

export const MCP_APPS_DEFAULT_VISIBILITY = ['model', 'app'] as const
export type McpAppsToolVisibility = 'model' | 'app'
export type McpAppsDisplayMode = 'inline' | 'fullscreen' | 'pip'

const SURFACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const CSP_ORIGIN_PATTERN = /^(?:https?|wss?):\/\/[A-Za-z0-9.*-]+(?::\d{1,5})?$/

export type McpAppCsp = {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}

export type McpToolUiDescriptor = {
  resourceUri: string
  visibility: McpAppsToolVisibility[]
  csp?: McpAppCsp
  prefersBorder?: boolean
  surface?: string
  preferredDisplayMode?: McpAppsDisplayMode
}

export type McpAppResourceMeta = {
  csp?: McpAppCsp
  prefersBorder?: boolean
  /** Host extension: allow eval / WebAssembly compilation for this document only. */
  unsafeEval?: boolean
  wasmUnsafeEval?: boolean
}

/** Output field the runtime attaches to MCP tool results whose tool declares a UI. */
export type McpAppToolOutputMeta = {
  serverId: string
  toolName: string
  resourceUri: string
  surface?: string
  preferredDisplayMode?: McpAppsDisplayMode
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readResourceUri(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const uri = value.trim()
  if (!uri.startsWith(MCP_APPS_RESOURCE_SCHEME)) return undefined
  if (uri.length > MCP_APPS_RESOURCE_URI_MAX_CHARS) return undefined
  if (/[\s\0]/.test(uri)) return undefined
  return uri
}

function readVisibility(value: unknown): McpAppsToolVisibility[] {
  if (!Array.isArray(value)) return [...MCP_APPS_DEFAULT_VISIBILITY]
  const result = new Set<McpAppsToolVisibility>()
  for (const entry of value) {
    if (entry === 'model' || entry === 'app') result.add(entry)
  }
  return [...result]
}

function readDisplayMode(value: unknown): McpAppsDisplayMode | undefined {
  return value === 'inline' || value === 'fullscreen' || value === 'pip' ? value : undefined
}

function readOrigins(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const origins = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter((entry) => CSP_ORIGIN_PATTERN.test(entry))
  return origins.length > 0 ? [...new Set(origins)].slice(0, 32) : undefined
}

function readCsp(...sources: Array<Record<string, unknown> | undefined>): McpAppCsp | undefined {
  const csp: McpAppCsp = {}
  for (const source of sources) {
    if (!source) continue
    const connect = readOrigins(source.connectDomains ?? source.connect_domains)
    const resource = readOrigins(source.resourceDomains ?? source.resource_domains)
    const frame = readOrigins(source.frameDomains ?? source.frame_domains)
    const baseUri = readOrigins(source.baseUriDomains ?? source.base_uri_domains)
    if (connect && !csp.connectDomains) csp.connectDomains = connect
    if (resource && !csp.resourceDomains) csp.resourceDomains = resource
    if (frame && !csp.frameDomains) csp.frameDomains = frame
    if (baseUri && !csp.baseUriDomains) csp.baseUriDomains = baseUri
  }
  return Object.keys(csp).length > 0 ? csp : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readSurfaceId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  return id.length <= MCP_APPS_SURFACE_ID_MAX_CHARS && SURFACE_ID_PATTERN.test(id) ? id : undefined
}

/** Tool visibility is independent of whether the tool has a UI resource. */
export function readMcpToolVisibility(meta: unknown): McpAppsToolVisibility[] {
  return readVisibility(record(record(meta)?.ui)?.visibility)
}

export function isModelVisibleMcpTool(descriptor: { _meta?: unknown }): boolean {
  return readMcpToolVisibility(descriptor._meta).includes('model')
}

export function isAppVisibleMcpTool(descriptor: { _meta?: unknown }): boolean {
  return readMcpToolVisibility(descriptor._meta).includes('app')
}

/**
 * Normalize a tool's `_meta` into its UI descriptor. The resource URI comes from
 * `_meta.ui.resourceUri`, then the deprecated flat `_meta["ui/resourceUri"]`,
 * then the compatibility `openai/outputTemplate`. An invalid URI drops the whole
 * descriptor; any other invalid field is dropped on its own.
 */
export function normalizeMcpToolUiMeta(meta: unknown): McpToolUiDescriptor | null {
  const root = record(meta)
  if (!root) return null
  const ui = record(root.ui)
  const resourceUri =
    readResourceUri(ui?.resourceUri) ??
    readResourceUri(root['ui/resourceUri']) ??
    readResourceUri(root['openai/outputTemplate'])
  if (!resourceUri) return null
  const descriptor: McpToolUiDescriptor = {
    resourceUri,
    visibility: readVisibility(ui?.visibility)
  }
  const csp = readCsp(record(ui?.csp), record(root['openai/widgetCSP']))
  if (csp) descriptor.csp = csp
  const prefersBorder = readBoolean(ui?.prefersBorder) ?? readBoolean(root['openai/widgetPrefersBorder'])
  if (prefersBorder !== undefined) descriptor.prefersBorder = prefersBorder
  const surface = readSurfaceId(ui?.surface)
  if (surface) descriptor.surface = surface
  const displayMode = readDisplayMode(ui?.preferredDisplayMode) ??
    readDisplayMode(record(root['openai/ui'])?.preferredModelDisplayMode)
  if (displayMode) descriptor.preferredDisplayMode = displayMode
  return descriptor
}

/** Normalize the `_meta` of the selected `ui://` HTML content item. */
export function normalizeMcpAppResourceMeta(meta: unknown): McpAppResourceMeta {
  const root = record(meta)
  if (!root) return {}
  const ui = record(root.ui)
  const result: McpAppResourceMeta = {}
  const csp = readCsp(record(ui?.csp), record(root['openai/widgetCSP']))
  if (csp) result.csp = csp
  const prefersBorder = readBoolean(ui?.prefersBorder) ?? readBoolean(root['openai/widgetPrefersBorder'])
  if (prefersBorder !== undefined) result.prefersBorder = prefersBorder
  const relaxations = record(root['kun/csp'])
  if (relaxations?.unsafeEval === true) result.unsafeEval = true
  if (relaxations?.wasmUnsafeEval === true) result.wasmUnsafeEval = true
  return result
}

export function isMcpAppHtmlMimeType(mimeType: unknown): boolean {
  if (typeof mimeType !== 'string') return false
  const normalized = mimeType.toLowerCase().replace(/\s+/g, '')
  return normalized === MCP_APP_HTML_MIME_TYPE || normalized === 'text/html' ||
    normalized.startsWith('text/html;')
}

export function mcpAppToolOutputMeta(
  serverId: string,
  descriptor: { name: string; _meta?: unknown }
): McpAppToolOutputMeta | undefined {
  const ui = normalizeMcpToolUiMeta(descriptor._meta)
  if (!ui) return undefined
  return {
    serverId,
    toolName: descriptor.name,
    resourceUri: ui.resourceUri,
    ...(ui.surface ? { surface: ui.surface } : {}),
    ...(ui.preferredDisplayMode ? { preferredDisplayMode: ui.preferredDisplayMode } : {})
  }
}

/** Parse the `mcpApp` field of an MCP tool output on the consumer side. */
export function parseMcpAppToolOutputMeta(value: unknown): McpAppToolOutputMeta | null {
  const source = record(value)
  if (!source) return null
  const serverId = typeof source.serverId === 'string' ? source.serverId.trim() : ''
  const toolName = typeof source.toolName === 'string' ? source.toolName.trim() : ''
  const resourceUri = readResourceUri(source.resourceUri)
  if (!serverId || !toolName || !resourceUri) return null
  const surface = readSurfaceId(source.surface)
  const preferredDisplayMode = readDisplayMode(source.preferredDisplayMode)
  return {
    serverId,
    toolName,
    resourceUri,
    ...(surface ? { surface } : {}),
    ...(preferredDisplayMode ? { preferredDisplayMode } : {})
  }
}

/**
 * Resolve a page-relative asset against the document's `ui://` URI. Only
 * resources under the same `ui://<authority>/` are reachable.
 */
export function resolveMcpAppRelativeResource(documentUri: string, relativePath: string): string | null {
  const base = readResourceUri(documentUri)
  if (!base) return null
  const authorityEnd = base.indexOf('/', MCP_APPS_RESOURCE_SCHEME.length)
  const authority = authorityEnd < 0 ? base : base.slice(0, authorityEnd)
  const segments: string[] = []
  for (const segment of relativePath.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    if (/[\\\0]/.test(segment)) return null
    segments.push(segment)
  }
  if (segments.length === 0) return null
  const resolved = `${authority}/${segments.join('/')}`
  return readResourceUri(resolved) ?? null
}

const serverIdSchema = z.string().trim().min(1).max(128)

export const McpAppResourceReadRequestSchema = z.object({
  serverId: serverIdSchema,
  uri: z.string().trim().min(1).max(MCP_APPS_RESOURCE_URI_MAX_CHARS),
  threadId: z.string().trim().min(1).max(256).optional()
}).strict()
export type McpAppResourceReadRequest = z.infer<typeof McpAppResourceReadRequestSchema>

export const McpAppResourceListRequestSchema = z.object({
  serverId: serverIdSchema,
  cursor: z.string().max(1_024).optional(),
  threadId: z.string().trim().min(1).max(256).optional()
}).strict()

export const McpAppToolCallRequestSchema = z.object({
  serverId: serverIdSchema,
  name: z.string().trim().min(1).max(256),
  arguments: z.record(z.string(), z.unknown()).default({}),
  threadId: z.string().trim().min(1).max(256)
}).strict()
export type McpAppToolCallRequest = z.infer<typeof McpAppToolCallRequestSchema>

/** One UI-capable tool listed by `GET /v1/mcp-apps/catalog`. */
export type McpAppCatalogEntry = {
  serverId: string
  toolName: string
  title?: string
  resourceUri: string
  visibility: McpAppsToolVisibility[]
  surface?: string
}
