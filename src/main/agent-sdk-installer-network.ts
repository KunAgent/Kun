import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { Readable as NodeReadable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { extract, type Header } from 'tar-stream'
import { fetchWithOptionalProxy } from './proxy-fetch'

export const MAX_METADATA_BYTES = 64 * 1024
export const MAX_ARCHIVE_BYTES = 320 * 1024 * 1024
export const MAX_BINARY_BYTES = 300 * 1024 * 1024
const MAX_ARCHIVE_MEMBERS = 16
const MAX_REDIRECTS = 3
const ALLOWED_HOSTS = new Set(['registry.npmjs.org'])

export type PackageMetadata = {
  name: string
  version: string
  dist: {
    tarball: string
    integrity: string
    shasum?: string
    unpackedSize?: number
  }
}

export type DownloadEvidence = {
  archiveSize: number
  sri: string
  shasum?: string
}

export type InstallerFetch = typeof fetchWithOptionalProxy

function safeUrl(raw: string, label: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} URL is invalid`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error(`${label} URL must be credential-free HTTPS on the default port`)
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`${label} host is not allowlisted: ${url.hostname}`)
  }
  return url
}

function redirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

export async function fetchAllowlisted(
  initialUrl: string,
  proxyUrl: string,
  fetcher: InstallerFetch = fetchWithOptionalProxy
): Promise<Response> {
  let url = safeUrl(initialUrl, 'download')
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetcher(url, { redirect: 'manual' }, proxyUrl)
    if (!redirectStatus(response.status)) return response
    response.body?.cancel().catch(() => undefined)
    const location = response.headers.get('location')
    if (!location) throw new Error('registry redirect omitted Location')
    if (redirects === MAX_REDIRECTS) throw new Error('too many registry redirects')
    url = safeUrl(new URL(location, url).toString(), 'redirect')
  }
  throw new Error('too many registry redirects')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function parsePackageMetadata(value: unknown, expectedName: string, expectedVersion: string): PackageMetadata {
  const root = record(value)
  const dist = record(root?.dist)
  if (root?.name !== expectedName || root.version !== expectedVersion || !dist) {
    throw new Error('registry metadata package identity does not match the request')
  }
  if (typeof dist.tarball !== 'string' || typeof dist.integrity !== 'string') {
    throw new Error('registry metadata is missing tarball integrity fields')
  }
  const sri = parseSri(dist.integrity)
  safeUrl(dist.tarball, 'tarball')
  const shasum = dist.shasum
  if (shasum !== undefined && (typeof shasum !== 'string' || !/^[a-f0-9]{40}$/i.test(shasum))) {
    throw new Error('registry metadata shasum is invalid')
  }
  const unpackedSize = dist.unpackedSize
  if (unpackedSize !== undefined &&
      (!Number.isSafeInteger(unpackedSize) || (unpackedSize as number) <= 0 || (unpackedSize as number) > MAX_BINARY_BYTES)) {
    throw new Error('registry metadata unpacked size is invalid or too large')
  }
  return {
    name: expectedName,
    version: expectedVersion,
    dist: { tarball: dist.tarball, integrity: sri.canonical, shasum, unpackedSize: unpackedSize as number | undefined }
  }
}

function parseContentLength(response: Response, maximum: number, label: string): number | undefined {
  const raw = response.headers.get('content-length')
  if (raw === null) return undefined
  if (!/^\d+$/.test(raw)) throw new Error(`${label} Content-Length is invalid`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} Content-Length is invalid or too large`)
  }
  return value
}

async function readBodyBounded(response: Response, maximum: number): Promise<Buffer> {
  parseContentLength(response, maximum, 'response')
  if (!response.body) throw new Error('response body is missing')
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of NodeReadable.fromWeb(response.body as Parameters<typeof NodeReadable.fromWeb>[0])) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > maximum) throw new Error(`response exceeds ${maximum} bytes`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, total)
}

export async function fetchPackageMetadata(
  url: string,
  packageName: string,
  version: string,
  proxyUrl: string,
  fetcher?: InstallerFetch
): Promise<PackageMetadata> {
  const response = await fetchAllowlisted(url, proxyUrl, fetcher)
  if (!response.ok) throw new Error(`registry ${packageName}@${version}: ${response.status}`)
  const bytes = await readBodyBounded(response, MAX_METADATA_BYTES)
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('registry metadata is not valid JSON')
  }
  return parsePackageMetadata(parsed, packageName, version)
}

type Sri = { algorithm: 'sha512'; digest: Buffer; canonical: string }

function parseSri(value: string): Sri {
  const token = value.trim().split(/\s+/).find((part) => part.startsWith('sha512-'))
  if (!token) throw new Error('registry metadata must provide sha512 SRI')
  const encoded = token.slice('sha512-'.length)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('registry metadata SRI is invalid')
  const digest = Buffer.from(encoded, 'base64')
  if (digest.length !== 64 || digest.toString('base64') !== encoded) {
    throw new Error('registry metadata SRI is invalid')
  }
  return { algorithm: 'sha512', digest, canonical: `sha512-${encoded}` }
}

function sameDigest(actual: Buffer, expected: Buffer): boolean {
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function downloadArchive(
  response: Response,
  destination: string,
  metadata: PackageMetadata,
  onProgress?: (receivedBytes: number, totalBytes: number) => void
): Promise<DownloadEvidence> {
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`)
  const declared = parseContentLength(response, MAX_ARCHIVE_BYTES, 'archive')
  const sri = parseSri(metadata.dist.integrity)
  const sha512 = createHash('sha512')
  const sha1 = metadata.dist.shasum ? createHash('sha1') : undefined
  let received = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > MAX_ARCHIVE_BYTES) return callback(new Error('archive exceeds size limit'))
      sha512.update(chunk)
      sha1?.update(chunk)
      onProgress?.(received, declared ?? 0)
      callback(null, chunk)
    }
  })
  await pipeline(NodeReadable.fromWeb(response.body as Parameters<typeof NodeReadable.fromWeb>[0]), meter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
  if (received === 0) throw new Error('archive is empty')
  if (!sameDigest(sha512.digest(), sri.digest)) throw new Error('archive SRI verification failed')
  const actualSha1 = sha1?.digest('hex')
  if (metadata.dist.shasum && actualSha1?.toLowerCase() !== metadata.dist.shasum.toLowerCase()) {
    throw new Error('archive shasum verification failed')
  }
  return { archiveSize: received, sri: sri.canonical, shasum: actualSha1 }
}

export async function extractExactBinary(archive: string, memberName: string, destination: string): Promise<number> {
  const extractor = extract()
  let members = 0
  let found = false
  let extractedSize = 0
  let unpackedSize = 0
  let pendingWrite: Promise<void> | undefined
  const rejectEntry = (stream: NodeReadable, next: (error?: Error) => void, error: Error): void => {
    stream.resume()
    stream.once('end', () => next(error))
  }
  extractor.on('entry', (header: Header, stream, next) => {
    members += 1
    if (members > MAX_ARCHIVE_MEMBERS) {
      rejectEntry(stream as unknown as NodeReadable, next, new Error('archive has too many members'))
      return
    }
    if (!Number.isSafeInteger(header.size) || header.size < 0 || header.size > MAX_BINARY_BYTES) {
      rejectEntry(stream as unknown as NodeReadable, next, new Error('archive member is too large'))
      return
    }
    unpackedSize += header.size
    if (!Number.isSafeInteger(unpackedSize) || unpackedSize > MAX_BINARY_BYTES) {
      rejectEntry(stream as unknown as NodeReadable, next, new Error('archive unpacked size is too large'))
      return
    }
    if (header.name !== memberName) {
      if (header.type !== 'file' && header.type !== 'directory') {
        rejectEntry(stream as unknown as NodeReadable, next, new Error('archive contains a link or special member'))
        return
      }
      stream.resume()
      stream.once('end', () => next())
      return
    }
    if (found || header.type !== 'file' || header.size <= 0) {
      rejectEntry(stream as unknown as NodeReadable, next, new Error('archive binary member is invalid'))
      return
    }
    found = true
    extractedSize = header.size
    pendingWrite = pipeline(stream, createWriteStream(destination, { flags: 'wx', mode: 0o700 }))
    pendingWrite.then(() => next(), next)
  })
  await pipeline(createReadStream(archive), createGunzip(), extractor)
  await pendingWrite
  if (!found || extractedSize <= 0) throw new Error('binary not found in tarball')
  const info = await stat(destination)
  if (!info.isFile() || info.size !== extractedSize) throw new Error('extracted binary size does not match archive header')
  const handle = await open(destination, 'r+')
  try { await handle.sync() } finally { await handle.close() }
  return extractedSize
}
