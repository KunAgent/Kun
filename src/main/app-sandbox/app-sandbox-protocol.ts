import type { Session } from 'electron'
import {
  APP_SANDBOX_SCHEME,
  appSandboxOrigin,
  parseAppSandboxUrl
} from '../../shared/app-sandbox'
import type { AppSandboxRecord, AppSandboxRegistry } from './app-sandbox-registry'
import { buildShellCsp, GEN_UI_STATIC_ORIGINS } from './app-sandbox-csp'
import { buildShellDocument } from './gen-ui-document'
import { readGenUiVendorFile, type GenUiVendorLocation } from './app-sandbox-vendor'

export type AppSandboxAsset = { body: Uint8Array; mimeType: string }

export type AppSandboxProtocolOptions = {
  registry: AppSandboxRegistry
  vendor: GenUiVendorLocation
  /** Read a page-relative MCP App asset through the runtime; null when missing. */
  readMcpAppAsset(record: AppSandboxRecord, relativePath: string): Promise<AppSandboxAsset | null>
  /** Network fetch that bypasses this session's custom https handler. */
  passthroughFetch(request: Request): Promise<Response>
  onDenied?(detail: { code: string; url: string }): void
}

const ASSET_CACHE_LIMIT = 64
const COMMON_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { ...COMMON_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
  })
}

function htmlResponse(html: string, csp: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp
    }
  })
}

function assetResponse(asset: AppSandboxAsset): Response {
  return new Response(Buffer.from(asset.body), {
    status: 200,
    headers: { ...COMMON_HEADERS, 'Content-Type': asset.mimeType }
  })
}

/**
 * Serve `kun-app://` for one webview partition. Electron protocol handlers are
 * Session-scoped, so every partition used by a sandbox is prepared before its
 * webview attaches. Each response re-validates that the instance exists and
 * belongs to the requesting partition.
 */
export class AppSandboxProtocols {
  private readonly prepared = new WeakSet<Session>()

  constructor(private readonly options: AppSandboxProtocolOptions) {}

  prepare(session: Session, partition: string, kind: 'gen-ui' | 'mcp-app'): void {
    if (this.prepared.has(session)) return
    session.protocol.handle(APP_SANDBOX_SCHEME, (request) => this.handle(request, partition))
    if (kind === 'gen-ui') {
      session.protocol.handle('https', (request) => this.handleGenUiHttps(request))
    }
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.setPermissionCheckHandler(() => false)
    session.setDevicePermissionHandler(() => false)
    session.on('will-download', (event) => event.preventDefault())
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: !isAllowedSandboxRequestScheme(details.url) })
    })
    this.prepared.add(session)
  }

  private async handle(request: Request, partition: string): Promise<Response> {
    const parsed = parseAppSandboxUrl(request.url)
    if (!parsed) return this.deny('APP_SANDBOX_URL_INVALID', request.url)
    const record = this.options.registry.get(parsed.instanceId)
    if (!record || record.partition !== partition) return this.deny('APP_SANDBOX_INSTANCE_UNKNOWN', request.url)
    if (parsed.kind === 'shell') {
      if (parsed.path !== '/' && parsed.path !== '/index.html') return textResponse(404, 'Not found')
      const guestOrigin = appSandboxOrigin(record.guestUrl) ?? ''
      const csp = buildShellCsp(guestOrigin)
      return htmlResponse(buildShellDocument({ guestUrl: record.guestUrl, csp, title: 'Kun App' }), csp)
    }
    if (parsed.kind !== record.kind || record.guestUrl.indexOf(`://${new URL(request.url).host}/`) < 0) {
      return this.deny('APP_SANDBOX_ORIGIN_MISMATCH', request.url)
    }
    if (parsed.path === '/index.html') return htmlResponse(record.html, record.csp)
    if (record.kind !== 'mcp-app') return textResponse(404, 'Not found')
    const relativePath = parsed.path.replace(/^\/+/, '')
    const cached = record.assetCache.get(relativePath)
    if (cached) return assetResponse(cached)
    try {
      const asset = await this.options.readMcpAppAsset(record, relativePath)
      if (!asset) return textResponse(404, 'Not found')
      if (record.assetCache.size < ASSET_CACHE_LIMIT) record.assetCache.set(relativePath, asset)
      return assetResponse(asset)
    } catch {
      return textResponse(502, 'Resource unavailable')
    }
  }

  private async handleGenUiHttps(request: Request): Promise<Response> {
    const vendored = await readGenUiVendorFile(request.url, this.options.vendor)
    if (vendored) {
      return new Response(Buffer.from(vendored), {
        status: 200,
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        }
      })
    }
    const origin = appSandboxOrigin(request.url)
    if (!origin || !(GEN_UI_STATIC_ORIGINS as readonly string[]).includes(origin)) {
      return this.deny('GEN_UI_NETWORK_DENIED', request.url)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return this.deny('GEN_UI_METHOD_DENIED', request.url)
    }
    try {
      return await this.options.passthroughFetch(request)
    } catch {
      return textResponse(502, 'Network unavailable')
    }
  }

  private deny(code: string, url: string): Response {
    this.options.onDenied?.({ code, url: url.slice(0, 256) })
    return textResponse(403, 'Forbidden')
  }
}

export function isAllowedSandboxRequestScheme(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol
    return protocol === `${APP_SANDBOX_SCHEME}:` || protocol === 'https:' || protocol === 'wss:' ||
      protocol === 'data:' || protocol === 'blob:' || protocol === 'devtools:'
  } catch {
    return false
  }
}
