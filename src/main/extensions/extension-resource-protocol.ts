import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, posix, resolve, sep } from 'node:path'
import type { Protocol } from 'electron'

export const KUN_EXTENSION_SCHEME = 'kun-extension'
export const KUN_EXTENSION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: kun-media:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'self' kun-media:",
  "worker-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

export const KUN_EXTERNAL_WEBVIEW_EXTENSION_CSP = KUN_EXTENSION_CSP.replace(
  "frame-src 'none'",
  'frame-src https:'
)

const EXTENSION_ID = /^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/
const MAX_RESOURCE_BYTES = 32 * 1024 * 1024

export type ExtensionResourceDescriptor = {
  extensionId: string
  extensionVersion: string
  packageRoot: string
  exactFiles: string[]
  localResourceRoots: string[]
  hostIconFiles?: string[]
  allowExternalWebview?: boolean
}

export type ExtensionResourceDescriptorResolver = (
  extensionId: string
) => Promise<ExtensionResourceDescriptor | undefined>

type SchemeRegistrar = Pick<Protocol, 'registerSchemesAsPrivileged'>
type ProtocolHandler = Pick<Protocol, 'handle' | 'unhandle'>

export const KUN_EXTENSION_PRIVILEGED_SCHEME = {
  scheme: KUN_EXTENSION_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    bypassCSP: false,
    stream: true
  }
} as const

export function registerKunExtensionSchemeAsPrivileged(protocol: SchemeRegistrar): void {
  protocol.registerSchemesAsPrivileged([KUN_EXTENSION_PRIVILEGED_SCHEME])
}

export function registerKunExtensionProtocol(options: {
  protocol: ProtocolHandler
  resolveDescriptor: ExtensionResourceDescriptorResolver
  onDenied?: (detail: { extensionId?: string; code: string }) => void
}): void {
  try {
    options.protocol.unhandle(KUN_EXTENSION_SCHEME)
  } catch {
    // First registration has no existing handler.
  }
  options.protocol.handle(KUN_EXTENSION_SCHEME, async (request) => {
    try {
      const resource = await resolveKunExtensionResource(request.url, options.resolveDescriptor)
      const bytes = await readFile(resource.path)
      if (bytes.byteLength > MAX_RESOURCE_BYTES) throw new ExtensionResourceError('RESOURCE_TOO_LARGE')
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: extensionResourceHeaders(
          resource.relativePath,
          resource.hostResource === 'icon',
          resource.descriptor.allowExternalWebview === true
        )
      })
    } catch (error) {
      const extensionId = safeExtensionIdFromUrl(request.url)
      options.onDenied?.({
        extensionId,
        code: error instanceof ExtensionResourceError ? error.code : 'RESOURCE_DENIED'
      })
      return new Response('Extension resource unavailable.', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': KUN_EXTENSION_CSP,
          'X-Content-Type-Options': 'nosniff'
        }
      })
    }
  })
}

export async function resolveKunExtensionResource(
  rawUrl: string,
  resolveDescriptor: ExtensionResourceDescriptorResolver
): Promise<{
  path: string
  relativePath: string
  descriptor: ExtensionResourceDescriptor
  hostResource?: 'icon'
}> {
  const parsed = parseKunExtensionUrl(rawUrl)
  const descriptor = await resolveDescriptor(parsed.extensionId)
  if (!descriptor || descriptor.extensionId !== parsed.extensionId) {
    throw new ExtensionResourceError('EXTENSION_NOT_AVAILABLE')
  }
  if (!isDeclaredResource(parsed.relativePath, descriptor)) {
    throw new ExtensionResourceError('RESOURCE_NOT_DECLARED')
  }
  if (
    parsed.hostResource === 'icon' &&
    !descriptor.hostIconFiles?.includes(parsed.relativePath)
  ) {
    throw new ExtensionResourceError('HOST_ICON_NOT_DECLARED')
  }

  const packageRoot = await realpath(descriptor.packageRoot)
  const candidate = resolve(packageRoot, ...parsed.relativePath.split('/'))
  const candidateRealPath = await realpath(candidate)
  if (!isPathWithin(packageRoot, candidateRealPath)) {
    throw new ExtensionResourceError('RESOURCE_ROOT_ESCAPE')
  }
  const metadata = await stat(candidateRealPath)
  if (!metadata.isFile()) throw new ExtensionResourceError('RESOURCE_NOT_FILE')

  if (!descriptor.exactFiles.includes(parsed.relativePath)) {
    const allowedByRealRoot = await Promise.all(
      descriptor.localResourceRoots.map(async (relativeRoot) => {
        try {
          const rootRealPath = await realpath(resolve(packageRoot, ...relativeRoot.split('/')))
          return isPathWithin(rootRealPath, candidateRealPath)
        } catch {
          return false
        }
      })
    )
    if (!allowedByRealRoot.some(Boolean)) {
      throw new ExtensionResourceError('RESOURCE_ROOT_ESCAPE')
    }
  }
  return {
    path: candidateRealPath,
    relativePath: parsed.relativePath,
    descriptor,
    hostResource: parsed.hostResource
  }
}

export function parseKunExtensionUrl(rawUrl: string): {
  extensionId: string
  relativePath: string
  viewSessionId?: string
  hostResource?: 'icon'
} {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ExtensionResourceError('URL_INVALID')
  }
  if (
    url.protocol !== `${KUN_EXTENSION_SCHEME}:` ||
    !EXTENSION_ID.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new ExtensionResourceError('URL_INVALID')
  }
  const authorityEnd = rawUrl.indexOf('/', `${KUN_EXTENSION_SCHEME}://`.length)
  if (authorityEnd < 0) throw new ExtensionResourceError('PATH_INVALID')
  const rawPath = rawUrl.slice(authorityEnd + 1).split(/[?#]/, 1)[0] ?? ''
  if (/%(?:2f|5c)/i.test(rawPath)) throw new ExtensionResourceError('PATH_INVALID')
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    throw new ExtensionResourceError('URL_INVALID')
  }
  if (
    !decoded ||
    decoded.length > 4_096 ||
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    decoded.startsWith('/') ||
    /^[a-zA-Z]:/.test(decoded)
  ) {
    throw new ExtensionResourceError('PATH_INVALID')
  }
  const normalized = posix.normalize(decoded)
  if (
    normalized !== decoded ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ExtensionResourceError('PATH_INVALID')
  }
  const viewSessionId = url.searchParams.get('kunViewSession') ?? undefined
  const hostResource = url.searchParams.get('kunHostResource') ?? undefined
  for (const key of url.searchParams.keys()) {
    if (key !== 'kunViewSession' && key !== 'kunHostResource') {
      throw new ExtensionResourceError('QUERY_INVALID')
    }
  }
  if (viewSessionId !== undefined && (viewSessionId.length < 16 || viewSessionId.length > 256)) {
    throw new ExtensionResourceError('QUERY_INVALID')
  }
  if (hostResource !== undefined && hostResource !== 'icon') {
    throw new ExtensionResourceError('QUERY_INVALID')
  }
  if (viewSessionId !== undefined && hostResource !== undefined) {
    throw new ExtensionResourceError('QUERY_INVALID')
  }
  return {
    extensionId: url.hostname,
    relativePath: normalized,
    viewSessionId,
    hostResource
  }
}

export function extensionResourceHeaders(
  relativePath: string,
  allowHostImageEmbedding = false,
  allowExternalWebview = false
): Record<string, string> {
  return {
    'Content-Type': safeContentType(relativePath),
    'Content-Security-Policy': allowExternalWebview
      ? KUN_EXTERNAL_WEBVIEW_EXTENSION_CSP
      : KUN_EXTENSION_CSP,
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': allowHostImageEmbedding ? 'cross-origin' : 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  }
}

function isDeclaredResource(relativePath: string, descriptor: ExtensionResourceDescriptor): boolean {
  if (descriptor.exactFiles.includes(relativePath)) return true
  return descriptor.localResourceRoots.some(
    (root) => relativePath === root || relativePath.startsWith(`${root}/`)
  )
}

function isPathWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

function safeContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.ico': return 'image/x-icon'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    case '.wasm': return 'application/wasm'
    case '.txt': return 'text/plain; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

function safeExtensionIdFromUrl(rawUrl: string): string | undefined {
  try {
    const hostname = new URL(rawUrl).hostname
    return EXTENSION_ID.test(hostname) ? hostname : undefined
  } catch {
    return undefined
  }
}

class ExtensionResourceError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
