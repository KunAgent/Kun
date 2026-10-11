import { KUN_WORKSPACE_PREVIEW_PRIVILEGED_SCHEME } from '../privileged-schemes'
import { randomBytes } from 'node:crypto'
import { open, readFile, realpath, stat, type FileHandle } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import type { Protocol, WebContents } from 'electron'
import type {
  WorkspacePreviewLeaseReleaseResult,
  WorkspacePreviewLeaseResult,
  WorkspacePreviewLeaseTarget
} from '../../shared/workspace-file'
import { resolveOpenTargetPath } from './workspace-paths'

export const KUN_WORKSPACE_PREVIEW_SCHEME = 'kun-workspace-preview'

export { KUN_WORKSPACE_PREVIEW_PRIVILEGED_SCHEME } from '../privileged-schemes'

const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1_000
const MAX_RESOURCE_BYTES = 512 * 1024 * 1024
const MAX_RANGE_BYTES = 256 * 1024 * 1024
const LEASE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/
const STATIC_HTML_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline' kun-workspace-preview:",
  "img-src 'self' data: blob: kun-workspace-preview:",
  "font-src 'self' data: kun-workspace-preview:",
  "media-src 'self' kun-workspace-preview:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const MIME_BY_EXTENSION = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.oga', 'audio/ogg'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac'],
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.ogv', 'video/ogg'],
  ['.mov', 'video/quicktime']
])

type ProtocolHandler = Pick<Protocol, 'handle' | 'unhandle'>

type ActiveLease = {
  leaseId: string
  senderId: number
  workspaceRoot: string
  entryRelativePath: string
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

type ParsedRange = {
  start: number
  end: number
  length: number
}

export class WorkspacePreviewProtocolRegistry {
  private readonly leases = new Map<string, ActiveLease>()
  private readonly leaseIdsBySender = new Map<number, Set<string>>()
  private readonly boundSenders = new Map<number, () => void>()

  constructor(
    private readonly options: {
      now?: () => number
      randomToken?: () => string
      leaseTtlMs?: number
    } = {}
  ) {}

  register(protocol: ProtocolHandler): void {
    try {
      protocol.unhandle(KUN_WORKSPACE_PREVIEW_SCHEME)
    } catch {
      // First registration has no existing handler.
    }
    protocol.handle(KUN_WORKSPACE_PREVIEW_SCHEME, (request) => this.handleRequest(request))
  }

  async createLease(
    sender: WebContents,
    target: WorkspacePreviewLeaseTarget
  ): Promise<WorkspacePreviewLeaseResult> {
    try {
      const workspaceRoot = await realpath(resolve(target.workspaceRoot))
      const targetPath = await resolveOpenTargetPath(target.path, workspaceRoot, {
        allowBasenameFallback: false
      })
      const canonicalTarget = await realpath(targetPath)
      if (!isPathWithin(workspaceRoot, canonicalTarget)) {
        return { ok: false, message: 'Preview resources must stay within the workspace.' }
      }
      const metadata = await stat(canonicalTarget)
      if (!metadata.isFile()) return { ok: false, message: 'Cannot preview a directory.' }
      if (metadata.size > MAX_RESOURCE_BYTES) {
        return { ok: false, message: 'This resource is too large to preview.' }
      }
      const mimeType = mimeTypeForPath(canonicalTarget)
      if (!mimeType) return { ok: false, message: 'This resource type is not supported.' }

      const leaseId = this.createLeaseId()
      const now = this.options.now?.() ?? Date.now()
      const expiresAt = now + (this.options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS)
      const timer = setTimeout(() => this.releaseLease(leaseId), Math.max(1, expiresAt - now))
      timer.unref?.()
      const entryRelativePath = normalizeRelativePath(relative(workspaceRoot, canonicalTarget))
      const lease: ActiveLease = {
        leaseId,
        senderId: sender.id,
        workspaceRoot,
        entryRelativePath,
        expiresAt,
        timer
      }
      this.leases.set(leaseId, lease)
      const senderLeases = this.leaseIdsBySender.get(sender.id) ?? new Set<string>()
      senderLeases.add(leaseId)
      this.leaseIdsBySender.set(sender.id, senderLeases)
      this.bindSender(sender)
      return {
        ok: true,
        leaseId,
        url: buildWorkspacePreviewUrl(leaseId, entryRelativePath),
        mimeType,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        expiresAt: new Date(expiresAt).toISOString()
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  release(senderId: number, leaseId: string): WorkspacePreviewLeaseReleaseResult {
    const lease = this.leases.get(leaseId)
    if (!lease || lease.senderId !== senderId) {
      return { ok: false, message: 'Preview resource lease is unavailable.' }
    }
    this.releaseLease(leaseId)
    return { ok: true }
  }

  releaseForSender(senderId: number): void {
    const leaseIds = [...(this.leaseIdsBySender.get(senderId) ?? [])]
    for (const leaseId of leaseIds) this.releaseLease(leaseId)
    this.leaseIdsBySender.delete(senderId)
    this.boundSenders.delete(senderId)
  }

  dispose(): void {
    for (const leaseId of [...this.leases.keys()]) this.releaseLease(leaseId)
    this.boundSenders.clear()
  }

  private bindSender(sender: WebContents): void {
    if (this.boundSenders.has(sender.id)) return
    const onDestroyed = (): void => this.releaseForSender(sender.id)
    this.boundSenders.set(sender.id, onDestroyed)
    sender.once('destroyed', onDestroyed)
  }

  private async handleRequest(request: Request): Promise<Response> {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return workspacePreviewError('Method not allowed.', 405)
      }
      const parsed = parseWorkspacePreviewUrl(request.url)
      const lease = this.leases.get(parsed.leaseId)
      const now = this.options.now?.() ?? Date.now()
      if (!lease || now >= lease.expiresAt) {
        if (lease) this.releaseLease(lease.leaseId)
        return workspacePreviewError('Preview resource unavailable.', 404)
      }
      const candidate = await realpath(resolve(lease.workspaceRoot, parsed.relativePath))
      if (!isPathWithin(lease.workspaceRoot, candidate)) {
        return workspacePreviewError('Preview resource unavailable.', 404)
      }
      const metadata = await stat(candidate)
      if (!metadata.isFile() || metadata.size > MAX_RESOURCE_BYTES) {
        return workspacePreviewError('Preview resource unavailable.', 404)
      }
      const mimeType = mimeTypeForPath(candidate)
      if (!mimeType) return workspacePreviewError('Preview resource unavailable.', 404)
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: workspacePreviewHeaders(mimeType, metadata.size)
        })
      }
      if (mimeType.startsWith('text/html')) {
        const html = sanitizeStaticHtml(await readFile(candidate, 'utf8'))
        return new Response(html, {
          status: 200,
          headers: workspacePreviewHeaders(mimeType, Buffer.byteLength(html))
        })
      }
      return await streamWorkspaceResource(candidate, mimeType, metadata.size, request)
    } catch {
      return workspacePreviewError('Preview resource unavailable.', 404)
    }
  }

  private createLeaseId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.options.randomToken?.() ?? randomBytes(32).toString('base64url')
      if (LEASE_TOKEN.test(candidate) && !this.leases.has(candidate)) return candidate
    }
    throw new Error('Could not create a preview resource lease.')
  }

  private releaseLease(leaseId: string): void {
    const lease = this.leases.get(leaseId)
    if (!lease) return
    clearTimeout(lease.timer)
    this.leases.delete(leaseId)
    const senderLeases = this.leaseIdsBySender.get(lease.senderId)
    senderLeases?.delete(leaseId)
    if (senderLeases?.size === 0) this.leaseIdsBySender.delete(lease.senderId)
  }
}

export function buildWorkspacePreviewUrl(leaseId: string, relativePath: string): string {
  const encodedPath = normalizeRelativePath(relativePath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${KUN_WORKSPACE_PREVIEW_SCHEME}://lease/${leaseId}/${encodedPath}`
}

export function parseWorkspacePreviewUrl(rawUrl: string): {
  leaseId: string
  relativePath: string
} {
  const url = new URL(rawUrl)
  if (
    url.protocol !== `${KUN_WORKSPACE_PREVIEW_SCHEME}:` ||
    url.hostname !== 'lease' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid preview resource URL.')
  }
  const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment))
  const leaseId = segments.shift() ?? ''
  if (!LEASE_TOKEN.test(leaseId) || segments.length === 0) {
    throw new Error('Invalid preview resource URL.')
  }
  const relativePath = normalizeRelativePath(segments.join('/'))
  if (!relativePath || relativePath.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid preview resource URL.')
  }
  return { leaseId, relativePath }
}

export function sanitizeStaticHtml(html: string): string {
  const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
  return withoutScripts
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:src|href)\s*=\s*(["'])\s*(?:javascript|data:text\/html)[^"']*\1/gi, '')
}

export function parseWorkspaceByteRange(
  value: string,
  resourceSize: number,
  maxRangeBytes = MAX_RANGE_BYTES
): ParsedRange {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || resourceSize <= 0) throw new Error('Invalid byte range.')
  let start: number
  let end: number
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new Error('Invalid byte range.')
    start = Math.max(0, resourceSize - suffixLength)
    end = resourceSize - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : resourceSize - 1
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= resourceSize
  ) {
    throw new Error('Invalid byte range.')
  }
  end = Math.min(end, resourceSize - 1)
  if (end - start + 1 > maxRangeBytes) end = start + maxRangeBytes - 1
  return { start, end, length: end - start + 1 }
}

async function streamWorkspaceResource(
  path: string,
  mimeType: string,
  resourceSize: number,
  request: Request
): Promise<Response> {
  let file: FileHandle | undefined
  try {
    file = await open(path, 'r')
    if (resourceSize === 0) {
      await file.close()
      return new Response(null, { status: 200, headers: workspacePreviewHeaders(mimeType, 0) })
    }
    const rangeHeader = request.headers.get('range')
    const range = rangeHeader ? parseWorkspaceByteRange(rangeHeader, resourceSize) : undefined
    const start = range?.start ?? 0
    const end = range?.end ?? resourceSize - 1
    const stream = file.createReadStream({ autoClose: true, start, end, highWaterMark: 64 * 1024 })
    file = undefined
    if (request.signal.aborted) stream.destroy()
    else request.signal.addEventListener('abort', () => stream.destroy(), { once: true })
    const headers = workspacePreviewHeaders(mimeType, range?.length ?? resourceSize)
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${resourceSize}`
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: range ? 206 : 200,
      headers
    })
  } catch (error) {
    await file?.close().catch(() => undefined)
    throw error
  }
}

function workspacePreviewHeaders(mimeType: string, contentLength: number): Record<string, string> {
  return {
    'Content-Type': mimeType,
    'Content-Length': String(contentLength),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': STATIC_HTML_CSP,
    'X-Content-Type-Options': 'nosniff'
  }
}

function workspacePreviewError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': STATIC_HTML_CSP,
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

function mimeTypeForPath(path: string): string | null {
  return MIME_BY_EXTENSION.get(extname(path).toLowerCase()) ?? null
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+/, '')
}

function isPathWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
