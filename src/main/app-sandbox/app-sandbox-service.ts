import { createHash } from 'node:crypto'
import type { Session } from 'electron'
import type {
  AppSandboxCreateGenUiRequest,
  AppSandboxCreateMcpAppRequest,
  AppSandboxCreateResult,
  AppSandboxTheme
} from '../../shared/app-sandbox'
import type { RuntimeRequestResult } from '../../shared/kun-gui-api-contracts'
import { isGenUiWidgetId } from '../../../kun/src/contracts/gen-ui'
import {
  isMcpAppHtmlMimeType,
  MCP_APP_HTML_MAX_BYTES,
  MCP_APP_RESOURCE_MAX_BYTES,
  normalizeMcpAppResourceMeta,
  resolveMcpAppRelativeResource
} from '../../../kun/src/contracts/mcp-apps'
import { AppSandboxCapacityError, type AppSandboxRecord, type AppSandboxRegistry } from './app-sandbox-registry'
import type { AppSandboxAsset, AppSandboxProtocols } from './app-sandbox-protocol'
import { buildGenUiCsp, buildMcpAppCsp } from './app-sandbox-csp'
import { buildGenUiDocument } from './gen-ui-document'

type RuntimeRequest = (
  path: string,
  method?: string,
  body?: string
) => Promise<RuntimeRequestResult>

type ResourceContent = {
  uri?: unknown
  mimeType?: unknown
  text?: unknown
  blob?: unknown
  _meta?: unknown
}

export type AppSandboxServiceOptions = {
  registry: AppSandboxRegistry
  protocols: AppSandboxProtocols
  runtimeRequest: RuntimeRequest
  sessionFromPartition(partition: string): Session
}

const THREAD_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/

function failure(code: string, message: string): AppSandboxCreateResult {
  return { ok: false, code, message }
}

function shellOrigin(record: AppSandboxRecord): string {
  return `kun-app://shell-${record.instanceId}`
}

function parseJson(response: RuntimeRequestResult): unknown {
  try {
    return JSON.parse(response.body) as unknown
  } catch {
    return null
  }
}

function errorMessage(response: RuntimeRequestResult, fallback: string): string {
  const parsed = parseJson(response) as { error?: { message?: unknown }; message?: unknown } | null
  const message = parsed?.error?.message ?? parsed?.message
  return typeof message === 'string' && message.trim() ? message.slice(0, 500) : fallback
}

function decodeContent(content: ResourceContent, maxBytes: number): Uint8Array | null {
  if (typeof content.text === 'string') {
    const bytes = new TextEncoder().encode(content.text)
    return bytes.byteLength <= maxBytes ? bytes : null
  }
  if (typeof content.blob === 'string') {
    if (content.blob.length > Math.ceil(maxBytes / 3) * 4 + 4) return null
    const bytes = new Uint8Array(Buffer.from(content.blob, 'base64'))
    return bytes.byteLength <= maxBytes ? bytes : null
  }
  return null
}

function readContents(value: unknown): ResourceContent[] {
  const contents = (value as { contents?: unknown } | null)?.contents
  return Array.isArray(contents)
    ? contents.filter((entry): entry is ResourceContent => Boolean(entry) && typeof entry === 'object')
    : []
}

/** Stable per-server host label so MCP pages of one server share browser storage. */
export function mcpAppServerHost(serverId: string): string {
  return createHash('sha256').update(`kun-mcp-app\0${serverId}`).digest('hex').slice(0, 16)
}

export class AppSandboxService {
  constructor(private readonly options: AppSandboxServiceOptions) {}

  async createGenUi(ownerWebContentsId: number, request: AppSandboxCreateGenUiRequest): Promise<AppSandboxCreateResult> {
    if (!THREAD_ID_PATTERN.test(request.threadId) || !isGenUiWidgetId(request.widgetId)) {
      return failure('APP_SANDBOX_INVALID_REQUEST', 'Invalid widget reference.')
    }
    const widgetResponse = await this.options.runtimeRequest(`/v1/gen-ui/widgets/${request.widgetId}`, 'GET')
    if (!widgetResponse.ok) {
      return failure('GEN_UI_WIDGET_UNAVAILABLE', errorMessage(widgetResponse, 'The widget is no longer available.'))
    }
    const widget = parseJson(widgetResponse) as { html?: unknown; title?: unknown } | null
    if (typeof widget?.html !== 'string') return failure('GEN_UI_WIDGET_UNAVAILABLE', 'The widget is empty.')
    const stateResponse = await this.options.runtimeRequest(
      `/v1/threads/${encodeURIComponent(request.threadId)}/gen-ui/state`,
      'GET'
    )
    const entries = stateResponse.ok
      ? (parseJson(stateResponse) as { entries?: Array<{ widgetId?: unknown; state?: unknown }> } | null)?.entries
      : undefined
    const widgetState = entries?.find((entry) => entry.widgetId === request.widgetId)?.state ?? null
    return this.register(ownerWebContentsId, { kind: 'gen-ui', threadId: request.threadId }, (record) => {
      const csp = buildGenUiCsp(shellOrigin(record))
      return {
        csp,
        html: buildGenUiDocument({
          fragment: widget.html as string,
          title: typeof widget.title === 'string' ? widget.title : 'Widget',
          csp,
          theme: request.theme,
          widgetState
        })
      }
    })
  }

  async createMcpApp(ownerWebContentsId: number, request: AppSandboxCreateMcpAppRequest): Promise<AppSandboxCreateResult> {
    if (!THREAD_ID_PATTERN.test(request.threadId) || !request.serverId.trim() || !request.resourceUri.startsWith('ui://')) {
      return failure('APP_SANDBOX_INVALID_REQUEST', 'Invalid MCP App reference.')
    }
    const response = await this.options.runtimeRequest('/v1/mcp-apps/resource', 'POST', JSON.stringify({
      serverId: request.serverId,
      uri: request.resourceUri,
      threadId: request.threadId
    }))
    if (!response.ok) {
      return failure('MCP_APP_RESOURCE_UNAVAILABLE', errorMessage(response, 'The app page could not be loaded.'))
    }
    const contents = readContents(parseJson(response))
    const document = contents.find((entry) => entry.uri === request.resourceUri && isMcpAppHtmlMimeType(entry.mimeType)) ??
      contents.find((entry) => isMcpAppHtmlMimeType(entry.mimeType))
    if (!document) return failure('MCP_APP_RESOURCE_INVALID', 'The app did not return an HTML page.')
    const bytes = decodeContent(document, MCP_APP_HTML_MAX_BYTES)
    if (!bytes) return failure('MCP_APP_RESOURCE_TOO_LARGE', 'The app page is empty or too large.')
    const html = new TextDecoder().decode(bytes)
    const meta = normalizeMcpAppResourceMeta(document._meta)
    return this.register(ownerWebContentsId, {
      kind: 'mcp-app',
      threadId: request.threadId,
      serverId: request.serverId,
      serverHost: mcpAppServerHost(request.serverId),
      resourceUri: request.resourceUri
    }, (record) => ({
      csp: buildMcpAppCsp({ shellOrigin: shellOrigin(record), meta }),
      html
    }), meta.prefersBorder)
  }

  async readMcpAppAsset(record: AppSandboxRecord, relativePath: string): Promise<AppSandboxAsset | null> {
    if (!record.serverId || !record.resourceUri) return null
    const uri = resolveMcpAppRelativeResource(record.resourceUri, relativePath)
    if (!uri) return null
    const response = await this.options.runtimeRequest('/v1/mcp-apps/resource', 'POST', JSON.stringify({
      serverId: record.serverId,
      uri,
      threadId: record.threadId
    }))
    if (!response.ok) return null
    const content = readContents(parseJson(response))[0]
    if (!content) return null
    const body = decodeContent(content, MCP_APP_RESOURCE_MAX_BYTES)
    if (!body) return null
    const mimeType = typeof content.mimeType === 'string' && /^[\w.+-]+\/[\w.+-]+/.test(content.mimeType)
      ? content.mimeType
      : 'application/octet-stream'
    return { body, mimeType }
  }

  private register(
    ownerWebContentsId: number,
    input: {
      kind: 'gen-ui' | 'mcp-app'
      threadId: string
      serverId?: string
      serverHost?: string
      resourceUri?: string
    },
    build: (record: AppSandboxRecord) => { html: string; csp: string },
    prefersBorder?: boolean
  ): AppSandboxCreateResult {
    let record: AppSandboxRecord
    try {
      record = this.options.registry.create({ ...input, ownerWebContentsId, html: '', csp: "default-src 'none'" })
    } catch (error) {
      if (error instanceof AppSandboxCapacityError) return failure(error.code, error.message)
      throw error
    }
    const built = build(record)
    record.html = built.html
    record.csp = built.csp
    this.options.protocols.prepare(this.options.sessionFromPartition(record.partition), record.partition, input.kind)
    return {
      ok: true,
      instance: {
        instanceId: record.instanceId,
        kind: record.kind,
        src: record.shellUrl,
        partition: record.partition,
        ...(prefersBorder !== undefined ? { prefersBorder } : {})
      }
    }
  }
}

export function isAppSandboxTheme(value: unknown): value is AppSandboxTheme {
  if (!value || typeof value !== 'object') return false
  const theme = value as Partial<AppSandboxTheme>
  return (theme.mode === 'light' || theme.mode === 'dark') &&
    typeof theme.locale === 'string' && theme.locale.length <= 32 &&
    Boolean(theme.colors) && typeof theme.colors === 'object' &&
    Object.keys(theme.colors as object).length <= 32
}
