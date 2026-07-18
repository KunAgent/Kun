import { createHash, randomBytes } from 'node:crypto'
import type { ReadStream } from 'node:fs'
import { open, realpath, stat, type FileHandle } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import type { Protocol } from 'electron'
import type {
  ExtensionMediaDiagnostics,
  ExtensionMediaFileIdentity,
  ExtensionMediaLeaseRevocationReason
} from '../../shared/extension-media-ipc'
import type {
  ExtensionViewSessionRecord,
  ExtensionViewSessionRegistry
} from './extension-view-sessions'
import { KUN_EXTENSION_PRIVILEGED_SCHEME } from './extension-resource-protocol'

export const KUN_MEDIA_SCHEME = 'kun-media'

const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1_000
const DEFAULT_MAX_LEASES_PER_VIEW = 32
const DEFAULT_MAX_STREAMS_PER_LEASE = 4
const DEFAULT_MAX_STREAMS_TOTAL = 32
const DEFAULT_MAX_RANGE_BYTES = 512 * 1024 * 1024
const MAX_TIMER_MS = 0x7fffffff
const LEASE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/

type SchemeRegistrar = Pick<Protocol, 'registerSchemesAsPrivileged'>
type ProtocolHandler = Pick<Protocol, 'handle' | 'unhandle'>

export type ExtensionMediaLeaseInput = {
  viewSessionId: string
  extensionId: string
  extensionVersion: string
  contributionId: string
  workspaceRoot?: string
  handleId: string
  absolutePath: string
  mimeType?: string
  fileIdentity?: ExtensionMediaFileIdentity
  expiresAt?: number
}

export type ExtensionMediaLease = {
  leaseId: string
  handleId: string
  url: string
  mimeType: string
  expiresAt: string
}

export type ExtensionMediaProtocolOptions = {
  sessions: ExtensionViewSessionRegistry
  protocolForPartition: (partition: string) => ProtocolHandler
  now?: () => number
  randomToken?: () => string
  leaseTtlMs?: number
  maxLeasesPerView?: number
  maxConcurrentStreamsPerLease?: number
  maxConcurrentStreamsTotal?: number
  maxRangeBytes?: number
  onDenied?: (detail: { extensionId?: string; sessionId?: string; code: string }) => void
}

type PreparedMediaProtocol = {
  protocol: ProtocolHandler
  partition: string
  extensionId: string
  extensionVersion: string
}

type ActiveLease = {
  leaseId: string
  handleId: string
  sessionId: string
  extensionId: string
  extensionVersion: string
  contributionId: string
  workspaceRoot?: string
  guestWebContentsId: number
  guestMainFrameProcessId: number
  guestMainFrameRoutingId: number
  canonicalPath: string
  mimeType: string
  identity: ExtensionMediaFileIdentity
  etag: string
  expiresAt: number
  activeReaders: number
  streams: Set<ReadStream>
  timer: ReturnType<typeof setTimeout>
  revoked: boolean
}

export type ParsedMediaByteRange = { start: number; end: number; length: number }

export class ExtensionMediaProtocolError extends Error {
  constructor(
    readonly code: string,
    readonly status: number = 404,
    readonly resourceSize?: number
  ) {
    super(code)
    this.name = 'ExtensionMediaProtocolError'
  }
}

export const KUN_MEDIA_PRIVILEGED_SCHEME = {
  scheme: KUN_MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    bypassCSP: false,
    stream: true
  }
} as const

export function registerKunMediaSchemeAsPrivileged(protocol: SchemeRegistrar): void {
  protocol.registerSchemesAsPrivileged([KUN_MEDIA_PRIVILEGED_SCHEME])
}

/** Electron permits privileged-scheme registration only once before app ready. */
export function registerKunExtensionPlatformSchemesAsPrivileged(protocol: SchemeRegistrar): void {
  protocol.registerSchemesAsPrivileged([
    KUN_EXTENSION_PRIVILEGED_SCHEME,
    KUN_MEDIA_PRIVILEGED_SCHEME
  ])
}

/** Main-owned, per-View protocol and lease authority. */
export class ExtensionMediaProtocolRegistry {
  private readonly registrations = new Map<string, PreparedMediaProtocol>()
  private readonly leases = new Map<string, ActiveLease>()
  private readonly leaseIdsBySession = new Map<string, Set<string>>()
  private readonly deniedByCode = new Map<string, number>()
  private readonly now: () => number
  private readonly randomToken: () => string
  private readonly leaseTtlMs: number
  private readonly maxLeasesPerView: number
  private readonly maxConcurrentStreamsPerLease: number
  private readonly maxConcurrentStreamsTotal: number
  private readonly maxRangeBytes: number
  private readonly stopMainFrameObserver: () => void
  private activeStreamCount = 0

  constructor(private readonly options: ExtensionMediaProtocolOptions) {
    this.now = options.now ?? (() => Date.now())
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'))
    this.leaseTtlMs = positiveInteger(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS)
    this.maxLeasesPerView = positiveInteger(options.maxLeasesPerView, DEFAULT_MAX_LEASES_PER_VIEW)
    this.maxConcurrentStreamsPerLease = positiveInteger(
      options.maxConcurrentStreamsPerLease,
      DEFAULT_MAX_STREAMS_PER_LEASE
    )
    this.maxConcurrentStreamsTotal = positiveInteger(
      options.maxConcurrentStreamsTotal,
      DEFAULT_MAX_STREAMS_TOTAL
    )
    this.maxRangeBytes = positiveInteger(options.maxRangeBytes, DEFAULT_MAX_RANGE_BYTES)
    this.stopMainFrameObserver = options.sessions.onDidChangeMainFrame((record) => {
      this.revokeForSession(record.sessionId, 'view-navigated')
    })
  }

  prepare(record: ExtensionViewSessionRecord): void {
    if (this.registrations.has(record.sessionId)) {
      throw new ExtensionMediaProtocolError('MEDIA_PROTOCOL_DUPLICATE', 409)
    }
    const protocol = this.options.protocolForPartition(record.partition)
    try {
      protocol.unhandle(KUN_MEDIA_SCHEME)
    } catch {
      // First registration has no existing handler.
    }
    protocol.handle(KUN_MEDIA_SCHEME, (request) => this.handleRequest(record.sessionId, request))
    this.registrations.set(record.sessionId, {
      protocol,
      partition: record.partition,
      extensionId: record.extensionId,
      extensionVersion: record.extensionVersion
    })
  }

  assertPrepared(record: ExtensionViewSessionRecord): void {
    const prepared = this.registrations.get(record.sessionId)
    if (
      !prepared ||
      prepared.partition !== record.partition ||
      prepared.extensionId !== record.extensionId ||
      prepared.extensionVersion !== record.extensionVersion ||
      prepared.protocol !== this.options.protocolForPartition(record.partition)
    ) {
      throw new ExtensionMediaProtocolError('MEDIA_PROTOCOL_NOT_PREPARED', 409)
    }
  }

  async createLease(input: ExtensionMediaLeaseInput): Promise<ExtensionMediaLease> {
    const record = this.requireBoundSession(input)
    const currentLeaseIds = this.leaseIdsBySession.get(record.sessionId)
    if ((currentLeaseIds?.size ?? 0) >= this.maxLeasesPerView) {
      throw new ExtensionMediaProtocolError('MEDIA_LEASE_QUOTA_EXCEEDED', 429)
    }

    const canonicalPath = await realpath(input.absolutePath).catch(() => {
      throw new ExtensionMediaProtocolError('MEDIA_RESOURCE_UNAVAILABLE')
    })
    const metadata = await stat(canonicalPath).catch(() => {
      throw new ExtensionMediaProtocolError('MEDIA_RESOURCE_UNAVAILABLE')
    })
    if (!metadata.isFile()) throw new ExtensionMediaProtocolError('MEDIA_RESOURCE_NOT_FILE')
    const identity = fileIdentity(metadata)
    if (input.fileIdentity && !matchesFileIdentity(input.fileIdentity, identity)) {
      throw new ExtensionMediaProtocolError('MEDIA_FILE_IDENTITY_MISMATCH')
    }
    const mimeType = safeMediaMimeType(canonicalPath, input.mimeType)
    const now = this.now()
    const requestedExpiry = input.expiresAt ?? now + this.leaseTtlMs
    const expiresAt = Math.min(requestedExpiry, now + this.leaseTtlMs)
    if (!Number.isFinite(requestedExpiry) || expiresAt <= now) {
      throw new ExtensionMediaProtocolError('MEDIA_LEASE_EXPIRED')
    }
    const leaseId = this.createUniqueLeaseId()
    const timer = setTimeout(() => {
      this.revokeLease(leaseId, 'expired')
    }, Math.min(MAX_TIMER_MS, Math.max(1, expiresAt - now)))
    timer.unref?.()
    const lease: ActiveLease = {
      leaseId,
      handleId: input.handleId,
      sessionId: record.sessionId,
      extensionId: record.extensionId,
      extensionVersion: record.extensionVersion,
      contributionId: record.contributionId,
      workspaceRoot: record.workspaceRoot,
      guestWebContentsId: record.guestWebContentsId!,
      guestMainFrameProcessId: record.guestMainFrameProcessId!,
      guestMainFrameRoutingId: record.guestMainFrameRoutingId!,
      canonicalPath,
      mimeType,
      identity,
      etag: opaqueEtag(identity, mimeType),
      expiresAt,
      activeReaders: 0,
      streams: new Set(),
      timer,
      revoked: false
    }
    this.leases.set(leaseId, lease)
    const leaseIds = currentLeaseIds ?? new Set<string>()
    leaseIds.add(leaseId)
    this.leaseIdsBySession.set(record.sessionId, leaseIds)
    return {
      leaseId,
      handleId: lease.handleId,
      url: `${KUN_MEDIA_SCHEME}://lease/${leaseId}`,
      mimeType,
      expiresAt: new Date(expiresAt).toISOString()
    }
  }

  revokeLease(leaseId: string, _reason: ExtensionMediaLeaseRevocationReason = 'released'): boolean {
    const lease = this.leases.get(leaseId)
    if (!lease) return false
    lease.revoked = true
    clearTimeout(lease.timer)
    this.leases.delete(leaseId)
    const leaseIds = this.leaseIdsBySession.get(lease.sessionId)
    leaseIds?.delete(leaseId)
    if (leaseIds?.size === 0) this.leaseIdsBySession.delete(lease.sessionId)
    for (const stream of [...lease.streams]) {
      stream.destroy(new Error('MEDIA_LEASE_REVOKED'))
    }
    return true
  }

  revokeForWorkspace(workspaceRoot: string, reason: ExtensionMediaLeaseRevocationReason = 'workspace-changed'): number {
    return this.revokeMatching((lease) => lease.workspaceRoot === workspaceRoot, reason)
  }

  revokeForExtension(extensionId: string, reason: ExtensionMediaLeaseRevocationReason = 'extension-disabled'): number {
    return this.revokeMatching((lease) => lease.extensionId === extensionId, reason)
  }

  revokeForSession(
    sessionId: string,
    reason: ExtensionMediaLeaseRevocationReason = 'view-navigated'
  ): number {
    return this.revokeMatching((lease) => lease.sessionId === sessionId, reason)
  }

  disposeSession(sessionId: string, reason: ExtensionMediaLeaseRevocationReason = 'view-closed'): boolean {
    const prepared = this.registrations.get(sessionId)
    const revoked = this.revokeForSession(sessionId, reason)
    if (!prepared) return revoked > 0
    this.registrations.delete(sessionId)
    try {
      prepared.protocol.unhandle(KUN_MEDIA_SCHEME)
    } catch {
      // The temporary Electron Session may already be gone.
    }
    return true
  }

  disposeAll(): void {
    this.stopMainFrameObserver()
    for (const sessionId of [...this.registrations.keys()]) {
      this.disposeSession(sessionId, 'runtime-shutdown')
    }
    for (const leaseId of [...this.leases.keys()]) {
      this.revokeLease(leaseId, 'runtime-shutdown')
    }
  }

  diagnostics(): ExtensionMediaDiagnostics {
    return {
      scheme: KUN_MEDIA_SCHEME,
      preparedViewCount: this.registrations.size,
      activeLeaseCount: this.leases.size,
      activeStreamCount: this.activeStreamCount,
      limits: {
        leaseTtlMs: this.leaseTtlMs,
        leasesPerView: this.maxLeasesPerView,
        concurrentStreamsPerLease: this.maxConcurrentStreamsPerLease,
        concurrentStreamsTotal: this.maxConcurrentStreamsTotal,
        rangeBytes: this.maxRangeBytes
      },
      deniedByCode: Object.fromEntries(this.deniedByCode)
    }
  }

  private async handleRequest(sessionId: string, request: Request): Promise<Response> {
    try {
      const leaseId = parseKunMediaUrl(request.url)
      const lease = this.requireRequestLease(sessionId, leaseId)
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        throw new ExtensionMediaProtocolError('MEDIA_METHOD_NOT_ALLOWED', 405)
      }
      if (request.method === 'HEAD') {
        const file = await this.openCurrentFile(lease)
        await file.close()
        return new Response(null, {
          status: 200,
          headers: mediaResponseHeaders(lease, lease.identity.byteSize)
        })
      }
      return await this.streamResponse(lease, request)
    } catch (error) {
      const protocolError = error instanceof ExtensionMediaProtocolError
        ? error
        : new ExtensionMediaProtocolError('MEDIA_RESOURCE_UNAVAILABLE')
      const registration = this.registrations.get(sessionId)
      this.recordDenied(protocolError.code, registration?.extensionId, sessionId)
      return mediaErrorResponse(protocolError)
    }
  }

  private async streamResponse(lease: ActiveLease, request: Request): Promise<Response> {
    this.reserveReader(lease)
    let file: FileHandle | undefined
    let readerReleased = false
    const releaseReader = (): void => {
      if (readerReleased) return
      readerReleased = true
      lease.activeReaders = Math.max(0, lease.activeReaders - 1)
      this.activeStreamCount = Math.max(0, this.activeStreamCount - 1)
    }
    try {
      file = await this.openCurrentFile(lease)
      if (lease.revoked || this.leases.get(lease.leaseId) !== lease) {
        throw new ExtensionMediaProtocolError('MEDIA_LEASE_REVOKED')
      }
      const resourceSize = lease.identity.byteSize
      const rangeHeader = request.headers.get('range')
      const range = rangeHeader === null
        ? undefined
        : parseMediaByteRange(rangeHeader, resourceSize, this.maxRangeBytes)
      if (resourceSize === 0) {
        await file.close()
        file = undefined
        releaseReader()
        return new Response(null, {
          status: 200,
          headers: mediaResponseHeaders(lease, 0)
        })
      }
      const start = range?.start ?? 0
      const end = range?.end ?? resourceSize - 1
      const stream = file.createReadStream({
        autoClose: true,
        start,
        end,
        highWaterMark: 64 * 1024
      })
      file = undefined
      lease.streams.add(stream)
      const onAbort = (): void => {
        stream.destroy(new Error('MEDIA_REQUEST_ABORTED'))
      }
      request.signal.addEventListener('abort', onAbort, { once: true })
      if (request.signal.aborted) onAbort()
      const cleanup = (): void => {
        request.signal.removeEventListener('abort', onAbort)
        lease.streams.delete(stream)
        releaseReader()
      }
      stream.once('close', cleanup)
      stream.once('error', cleanup)
      const headers = mediaResponseHeaders(lease, range?.length ?? resourceSize)
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${resourceSize}`
      const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
      return new Response(body, { status: range ? 206 : 200, headers })
    } catch (error) {
      await file?.close().catch(() => undefined)
      releaseReader()
      throw error
    }
  }

  private async openCurrentFile(lease: ActiveLease): Promise<FileHandle> {
    if (lease.revoked || this.now() >= lease.expiresAt) {
      this.revokeLease(lease.leaseId, 'expired')
      throw new ExtensionMediaProtocolError('MEDIA_LEASE_EXPIRED')
    }
    const canonicalPath = await realpath(lease.canonicalPath).catch(() => {
      this.revokeLease(lease.leaseId, 'file-replaced')
      throw new ExtensionMediaProtocolError('MEDIA_FILE_IDENTITY_MISMATCH')
    })
    if (canonicalPath !== lease.canonicalPath) {
      this.revokeLease(lease.leaseId, 'file-replaced')
      throw new ExtensionMediaProtocolError('MEDIA_FILE_IDENTITY_MISMATCH')
    }
    const file = await open(canonicalPath, 'r').catch(() => {
      this.revokeLease(lease.leaseId, 'file-replaced')
      throw new ExtensionMediaProtocolError('MEDIA_RESOURCE_UNAVAILABLE')
    })
    try {
      const metadata = await file.stat()
      if (!metadata.isFile() || !matchesFileIdentity(lease.identity, fileIdentity(metadata))) {
        this.revokeLease(lease.leaseId, 'file-replaced')
        throw new ExtensionMediaProtocolError('MEDIA_FILE_IDENTITY_MISMATCH')
      }
      return file
    } catch (error) {
      await file.close().catch(() => undefined)
      throw error
    }
  }

  private requireBoundSession(input: ExtensionMediaLeaseInput): ExtensionViewSessionRecord {
    const prepared = this.registrations.get(input.viewSessionId)
    const record = this.options.sessions.get(input.viewSessionId)
    if (
      !prepared ||
      !record ||
      record.state !== 'active' ||
      record.guestWebContentsId === undefined ||
      record.guestMainFrameProcessId === undefined ||
      record.guestMainFrameRoutingId === undefined ||
      prepared.partition !== record.partition ||
      prepared.protocol !== this.options.protocolForPartition(record.partition) ||
      prepared.extensionId !== input.extensionId ||
      prepared.extensionVersion !== input.extensionVersion ||
      record.extensionId !== input.extensionId ||
      record.extensionVersion !== input.extensionVersion ||
      record.contributionId !== input.contributionId ||
      record.workspaceRoot !== input.workspaceRoot
    ) {
      throw new ExtensionMediaProtocolError('MEDIA_VIEW_BINDING_INVALID')
    }
    return record
  }

  private requireRequestLease(sessionId: string, leaseId: string): ActiveLease {
    const lease = this.leases.get(leaseId)
    const record = this.options.sessions.get(sessionId)
    const prepared = this.registrations.get(sessionId)
    if (
      !lease ||
      lease.revoked ||
      lease.sessionId !== sessionId ||
      !record ||
      record.state !== 'active' ||
      !prepared ||
      prepared.protocol !== this.options.protocolForPartition(record.partition) ||
      record.extensionId !== lease.extensionId ||
      record.extensionVersion !== lease.extensionVersion ||
      record.contributionId !== lease.contributionId ||
      record.workspaceRoot !== lease.workspaceRoot ||
      record.guestWebContentsId !== lease.guestWebContentsId ||
      record.guestMainFrameProcessId !== lease.guestMainFrameProcessId ||
      record.guestMainFrameRoutingId !== lease.guestMainFrameRoutingId
    ) {
      throw new ExtensionMediaProtocolError('MEDIA_RESOURCE_UNAVAILABLE')
    }
    if (this.now() >= lease.expiresAt) {
      this.revokeLease(leaseId, 'expired')
      throw new ExtensionMediaProtocolError('MEDIA_LEASE_EXPIRED')
    }
    return lease
  }

  private reserveReader(lease: ActiveLease): void {
    if (
      lease.activeReaders >= this.maxConcurrentStreamsPerLease ||
      this.activeStreamCount >= this.maxConcurrentStreamsTotal
    ) {
      throw new ExtensionMediaProtocolError('MEDIA_STREAM_QUOTA_EXCEEDED', 429)
    }
    lease.activeReaders += 1
    this.activeStreamCount += 1
  }

  private createUniqueLeaseId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.randomToken()
      if (LEASE_TOKEN.test(candidate) && !this.leases.has(candidate)) return candidate
    }
    throw new ExtensionMediaProtocolError('MEDIA_LEASE_ID_UNAVAILABLE', 503)
  }

  private revokeMatching(
    predicate: (lease: ActiveLease) => boolean,
    reason: ExtensionMediaLeaseRevocationReason
  ): number {
    const leaseIds = [...this.leases.values()].filter(predicate).map((lease) => lease.leaseId)
    for (const leaseId of leaseIds) this.revokeLease(leaseId, reason)
    return leaseIds.length
  }

  private recordDenied(code: string, extensionId?: string, sessionId?: string): void {
    this.deniedByCode.set(code, (this.deniedByCode.get(code) ?? 0) + 1)
    this.options.onDenied?.({ extensionId, sessionId, code })
  }
}

export function parseMediaByteRange(
  value: string,
  resourceSize: number,
  maxRangeBytes: number
): ParsedMediaByteRange {
  if (
    !Number.isSafeInteger(resourceSize) ||
    resourceSize < 0 ||
    !Number.isSafeInteger(maxRangeBytes) ||
    maxRangeBytes <= 0 ||
    value.length > 256 ||
    value.includes(',')
  ) {
    throw new ExtensionMediaProtocolError('MEDIA_RANGE_INVALID', 416, resourceSize)
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || resourceSize === 0) {
    throw new ExtensionMediaProtocolError('MEDIA_RANGE_INVALID', 416, resourceSize)
  }
  let start: number
  let end: number
  if (!match[1]) {
    const suffixLength = parseRangeInteger(match[2]!, resourceSize)
    if (suffixLength <= 0) {
      throw new ExtensionMediaProtocolError('MEDIA_RANGE_INVALID', 416, resourceSize)
    }
    start = Math.max(0, resourceSize - suffixLength)
    end = resourceSize - 1
  } else {
    start = parseRangeInteger(match[1], resourceSize)
    if (start >= resourceSize) {
      throw new ExtensionMediaProtocolError('MEDIA_RANGE_INVALID', 416, resourceSize)
    }
    end = match[2] ? Math.min(parseRangeInteger(match[2], resourceSize), resourceSize - 1) : resourceSize - 1
    if (end < start) {
      throw new ExtensionMediaProtocolError('MEDIA_RANGE_INVALID', 416, resourceSize)
    }
  }
  const length = end - start + 1
  if (!Number.isSafeInteger(length) || length <= 0 || length > maxRangeBytes) {
    throw new ExtensionMediaProtocolError('MEDIA_RANGE_LIMIT_EXCEEDED', 416, resourceSize)
  }
  return { start, end, length }
}

function parseRangeInteger(value: string, resourceSize: number): number {
  if (!/^\d{1,16}$/.test(value)) {
    throw new ExtensionMediaProtocolError('MEDIA_RANGE_INVALID', 416, resourceSize)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ExtensionMediaProtocolError('MEDIA_RANGE_INVALID', 416, resourceSize)
  }
  return parsed
}

export function parseKunMediaUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ExtensionMediaProtocolError('MEDIA_URL_INVALID')
  }
  if (
    url.protocol !== `${KUN_MEDIA_SCHEME}:` ||
    url.hostname !== 'lease' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new ExtensionMediaProtocolError('MEDIA_URL_INVALID')
  }
  const match = /^\/([A-Za-z0-9_-]{32,128})$/.exec(url.pathname)
  if (!match) throw new ExtensionMediaProtocolError('MEDIA_URL_INVALID')
  return match[1]!
}

function mediaResponseHeaders(
  lease: Pick<ActiveLease, 'mimeType' | 'etag'>,
  contentLength: number
): Record<string, string> {
  return {
    'Accept-Ranges': 'bytes',
    'Content-Length': String(contentLength),
    'Content-Type': lease.mimeType,
    'Cache-Control': 'private, no-store',
    // The protected resource intentionally crosses from kun-extension://<id>
    // to kun-media://lease. Access remains bound to the View's unique Session
    // partition and opaque lease; CORP must permit that media embed.
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ETag: lease.etag,
    'X-Content-Type-Options': 'nosniff'
  }
}

function mediaErrorResponse(error: ExtensionMediaProtocolError): Response {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'Content-Length': '0',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  }
  if (error.status === 405) headers.Allow = 'GET, HEAD'
  if (error.status === 416 && error.resourceSize !== undefined) {
    headers['Accept-Ranges'] = 'bytes'
    headers['Content-Range'] = `bytes */${Math.max(0, error.resourceSize)}`
  }
  return new Response(null, { status: error.status, headers })
}

function fileIdentity(metadata: {
  size: number
  mtimeMs: number
  dev: number
  ino: number
}): ExtensionMediaFileIdentity {
  return {
    byteSize: metadata.size,
    modifiedAtMs: metadata.mtimeMs,
    device: metadata.dev,
    inode: metadata.ino
  }
}

function matchesFileIdentity(
  expected: ExtensionMediaFileIdentity,
  actual: ExtensionMediaFileIdentity
): boolean {
  return expected.byteSize === actual.byteSize &&
    expected.modifiedAtMs === actual.modifiedAtMs &&
    (expected.device === undefined || expected.device === actual.device) &&
    (expected.inode === undefined || expected.inode === actual.inode)
}

function opaqueEtag(identity: ExtensionMediaFileIdentity, mimeType: string): string {
  return `"${createHash('sha256')
    .update(`${identity.device ?? ''}\0${identity.inode ?? ''}\0${identity.byteSize}\0${identity.modifiedAtMs}\0${mimeType}`)
    .digest('base64url')
    .slice(0, 32)}"`
}

function safeMediaMimeType(path: string, requested?: string): string {
  const inferred = MEDIA_MIME_TYPES.get(extname(path).toLowerCase())
  if (!inferred) throw new ExtensionMediaProtocolError('MEDIA_TYPE_UNSUPPORTED', 415)
  if (requested && requested !== inferred) {
    throw new ExtensionMediaProtocolError('MEDIA_TYPE_MISMATCH', 415)
  }
  return inferred
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

const MEDIA_MIME_TYPES = new Map<string, string>([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.ogv', 'video/ogg'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.wav', 'audio/wav'],
  ['.flac', 'audio/flac'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.vtt', 'text/vtt']
])
