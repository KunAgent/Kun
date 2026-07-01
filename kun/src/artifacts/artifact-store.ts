/**
 * Content-addressed Artifact Store (P0 #5).
 *
 * A unified mechanism for large tool results — MCP payloads, browser output,
 * big JSON, remote logs, attachments — so the model only ever sees a bounded
 * summary + a stable artifact id, and can fetch specific byte/line ranges on
 * demand. Content is addressed by hash, so identical results dedupe. Two
 * implementations: an in-memory store (tests / ephemeral runtime) and a
 * file-backed store (persistent, survives restart for replay/audit).
 */

import { mkdir, readFile, readdir, rename, rm, writeFile, stat as fsStat, open as fsOpen } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { artifactId, summarizeForModel, type ArtifactSummary } from './artifact-summary.js'

export type ArtifactSourceKind = 'mcp' | 'web' | 'bash' | 'attachment' | 'remote-log' | 'tool' | 'other'

export type StoredArtifactMeta = {
  id: string
  byteSize: number
  lineCount: number
  mimeType?: string
  source?: ArtifactSourceKind
  /** Tool / origin label, e.g. an MCP tool name or `web_fetch`. */
  origin?: string
  createdAt: string
}

export type PutArtifactInput = {
  content: string
  mimeType?: string
  source?: ArtifactSourceKind
  origin?: string
  /** Inline preview budget handed to the model. Default 4000. */
  maxInlineChars?: number
}

export type PutArtifactResult = {
  meta: StoredArtifactMeta
  summary: ArtifactSummary
  /** True when this content already existed (deduped by hash). */
  deduped: boolean
}

export type ReadRangeOptions = {
  /** Byte offset (UTF-8) for a raw slice. */
  offset?: number
  length?: number
  /** 1-indexed inclusive line range (takes precedence over byte offset). */
  startLine?: number
  endLine?: number
}

export interface ArtifactStore {
  put(input: PutArtifactInput): Promise<PutArtifactResult>
  get(id: string): Promise<string | null>
  readRange(id: string, options: ReadRangeOptions): Promise<string | null>
  stat(id: string): Promise<StoredArtifactMeta | null>
}

const DEFAULT_MAX_INLINE = 4_000

/** Hard cap on any single artifact read: bytes and lines (P0 #5). A read that
 * would exceed these is clamped and a cursor is returned so the caller pages. */
export const ARTIFACT_MAX_READ_BYTES = 1_048_576
export const ARTIFACT_MAX_READ_LINES = 2_000

/** Artifact ids are content hashes; reject anything else so an id can never
 * escape the store directory (path traversal) when used in a file path. */
const ARTIFACT_ID_PATTERN = /^art_[0-9a-f]{1,64}$/

export function isValidArtifactId(id: string): boolean {
  return ARTIFACT_ID_PATTERN.test(id)
}

export type BoundedArtifactRead = {
  content: string
  range: ReadRangeOptions
  /** True when more content remains beyond what was returned. */
  truncated: boolean
  /** Byte cursor for the next page (byte-range reads). */
  nextOffset?: number
  /** Line cursor for the next page (line-range reads). */
  nextStartLine?: number
}

/**
 * Read an artifact with a HARD upper bound (P0 #5). Any request — including one
 * with no range, or a range larger than the cap — is clamped to at most
 * {@link ARTIFACT_MAX_READ_BYTES} / {@link ARTIFACT_MAX_READ_LINES}, and a
 * cursor (`nextOffset` / `nextStartLine`) is returned when content remains so a
 * caller can page instead of pulling a multi-GB artifact into memory/context.
 * Byte accounting is derived from the requested window + the artifact size (not
 * the decoded string) so the cursor is exact even when a byte slice lands on a
 * multibyte UTF-8 boundary.
 */
export async function readArtifactBounded(
  store: ArtifactStore,
  id: string,
  meta: StoredArtifactMeta,
  requested: ReadRangeOptions
): Promise<BoundedArtifactRead | null> {
  const lineMode = requested.startLine !== undefined || requested.endLine !== undefined
  if (lineMode) {
    const startLine = Math.max(1, requested.startLine ?? 1)
    const requestedEnd = requested.endLine ?? startLine + ARTIFACT_MAX_READ_LINES - 1
    const endLine = Math.min(requestedEnd, startLine + ARTIFACT_MAX_READ_LINES - 1)
    const range: ReadRangeOptions = { startLine, endLine }
    const content = await store.readRange(id, range)
    if (content === null) return null
    const truncated = endLine < meta.lineCount
    return { content, range, truncated, ...(truncated ? { nextStartLine: endLine + 1 } : {}) }
  }
  const offset = Math.max(0, requested.offset ?? 0)
  const requestedLen = requested.length ?? ARTIFACT_MAX_READ_BYTES
  const length = Math.min(Math.max(0, requestedLen), ARTIFACT_MAX_READ_BYTES)
  const content = await store.readRange(id, { offset, length })
  if (content === null) return null
  const bytesConsumed = Buffer.byteLength(content, 'utf8')
  const range: ReadRangeOptions = { offset, length: bytesConsumed }
  const truncated = offset + bytesConsumed < meta.byteSize
  return { content, range, truncated, ...(truncated ? { nextOffset: offset + bytesConsumed } : {}) }
}

function buildMeta(input: PutArtifactInput, id: string, nowIso: () => string): StoredArtifactMeta {
  const byteSize = Buffer.byteLength(input.content, 'utf8')
  const lineCount = input.content.length === 0 ? 0 : input.content.split('\n').length
  return {
    id,
    byteSize,
    lineCount,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.origin ? { origin: input.origin } : {}),
    createdAt: nowIso()
  }
}

function sliceContent(content: string, options: ReadRangeOptions): string {
  if (options.startLine !== undefined || options.endLine !== undefined) {
    const lines = content.split('\n')
    const start = Math.max(1, options.startLine ?? 1)
    const end = Math.min(lines.length, options.endLine ?? lines.length)
    if (start > end) return ''
    return lines.slice(start - 1, end).join('\n')
  }
  if (options.offset !== undefined || options.length !== undefined) {
    const buffer = Buffer.from(content, 'utf8')
    const offset = Math.max(0, options.offset ?? 0)
    const length = options.length !== undefined ? Math.max(0, options.length) : buffer.length - offset
    return decodeUtf8Window(buffer.subarray(offset, offset + length + 3), length)
  }
  return content
}

export class InMemoryArtifactStore implements ArtifactStore {
  private readonly contents = new Map<string, string>()
  private readonly metas = new Map<string, StoredArtifactMeta>()

  constructor(private readonly nowIso: () => string = () => new Date().toISOString()) {}

  async put(input: PutArtifactInput): Promise<PutArtifactResult> {
    const id = artifactId(input.content)
    const summary = summarizeForModel({
      content: input.content,
      maxInlineChars: input.maxInlineChars ?? DEFAULT_MAX_INLINE
    })
    const deduped = this.contents.has(id)
    if (!deduped) {
      this.contents.set(id, input.content)
      this.metas.set(id, buildMeta(input, id, this.nowIso))
    }
    return { meta: this.metas.get(id)!, summary, deduped }
  }

  async get(id: string): Promise<string | null> {
    return this.contents.get(id) ?? null
  }

  async readRange(id: string, options: ReadRangeOptions): Promise<string | null> {
    const content = this.contents.get(id)
    if (content === undefined) return null
    return sliceContent(content, options)
  }

  async stat(id: string): Promise<StoredArtifactMeta | null> {
    return this.metas.get(id) ?? null
  }
}

export class FileArtifactStore implements ArtifactStore {
  private ready?: Promise<void>

  constructor(
    private readonly dir: string,
    private readonly nowIso: () => string = () => new Date().toISOString(),
    private readonly limits: { maxTotalBytes?: number; maxArtifacts?: number } = {}
  ) {}

  private async ensureDir(): Promise<void> {
    if (!this.ready) this.ready = mkdir(this.dir, { recursive: true }).then(() => undefined)
    return this.ready
  }

  private contentPath(id: string): string {
    return join(this.dir, `${id}.bin`)
  }

  private metaPath(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  async put(input: PutArtifactInput): Promise<PutArtifactResult> {
    await this.ensureDir()
    const id = artifactId(input.content)
    const summary = summarizeForModel({
      content: input.content,
      maxInlineChars: input.maxInlineChars ?? DEFAULT_MAX_INLINE
    })
    let deduped = true
    try {
      await Promise.all([fsStat(this.contentPath(id)), fsStat(this.metaPath(id))])
    } catch {
      deduped = false
    }
    let meta: StoredArtifactMeta
    if (!deduped) {
      meta = buildMeta(input, id, this.nowIso)
      await this.enforceQuota(meta.byteSize)
      const suffix = `${process.pid}.${Date.now()}.tmp`
      const contentTemporaryPath = `${this.contentPath(id)}.${suffix}`
      const metaTemporaryPath = `${this.metaPath(id)}.${suffix}`
      try {
        await writeFile(contentTemporaryPath, input.content, 'utf8')
        await writeFile(metaTemporaryPath, JSON.stringify(meta), 'utf8')
        await rename(contentTemporaryPath, this.contentPath(id))
        await rename(metaTemporaryPath, this.metaPath(id))
      } finally {
        await Promise.all([
          rm(contentTemporaryPath, { force: true }),
          rm(metaTemporaryPath, { force: true })
        ]).catch(() => undefined)
      }
    } else {
      meta = (await this.stat(id)) ?? buildMeta(input, id, this.nowIso)
    }
    return { meta, summary, deduped }
  }

  async get(id: string): Promise<string | null> {
    if (!isValidArtifactId(id)) return null
    try {
      return await readFile(this.contentPath(id), 'utf8')
    } catch {
      return null
    }
  }

  async readRange(id: string, options: ReadRangeOptions): Promise<string | null> {
    if (!isValidArtifactId(id)) return null
    if (options.startLine !== undefined || options.endLine !== undefined) {
      return this.readLineRange(id, options.startLine, options.endLine)
    }
    if (options.offset !== undefined || options.length !== undefined) {
      return this.readByteRange(id, options.offset ?? 0, options.length)
    }
    return this.get(id)
  }

  /** True seek read of a byte window — never loads the whole artifact. */
  private async readByteRange(id: string, offset: number, length?: number): Promise<string | null> {
    let handle: import('node:fs/promises').FileHandle | undefined
    try {
      handle = await fsOpen(this.contentPath(id), 'r')
      const { size } = await handle.stat()
      const start = Math.max(0, Math.min(offset, size))
      const want = length !== undefined ? Math.max(0, length) : size - start
      const count = Math.min(want + 3, size - start)
      if (count <= 0) return ''
      const buffer = Buffer.alloc(count)
      await handle.read(buffer, 0, count, start)
      return decodeUtf8Window(buffer, want)
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  /**
   * Stream a 1-indexed inclusive line window, stopping once `endLine` is read —
   * so a small slice of a multi-GB artifact stays cheap. Only the selected
   * lines are buffered.
   */
  private async readLineRange(id: string, startLine?: number, endLine?: number): Promise<string | null> {
    const start = Math.max(1, startLine ?? 1)
    const end = endLine ?? Number.MAX_SAFE_INTEGER
    if (start > end) return ''
    let handle: import('node:fs/promises').FileHandle | undefined
    try {
      handle = await fsOpen(this.contentPath(id), 'r')
    } catch {
      return null
    }
    try {
      const collected: string[] = []
      let lineNo = 1
      let pending = ''
      // Decode incrementally so a multibyte UTF-8 sequence split across a 64KiB
      // read boundary is buffered and stitched, not turned into replacement
      // characters (P2-04).
      const decoder = new StringDecoder('utf8')
      const chunk = Buffer.alloc(64 * 1_024)
      for (;;) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
        if (bytesRead === 0) break
        pending += decoder.write(chunk.subarray(0, bytesRead))
        let nl = pending.indexOf('\n')
        while (nl !== -1) {
          const line = pending.slice(0, nl)
          if (lineNo >= start && lineNo <= end) collected.push(line)
          lineNo += 1
          if (lineNo > end) return collected.join('\n')
          pending = pending.slice(nl + 1)
          nl = pending.indexOf('\n')
        }
      }
      // Flush any bytes the decoder was holding for an incomplete sequence.
      pending += decoder.end()
      // Trailing line without a final newline.
      if (lineNo >= start && lineNo <= end && pending.length > 0) collected.push(pending)
      return collected.join('\n')
    } catch {
      return null
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  async stat(id: string): Promise<StoredArtifactMeta | null> {
    if (!isValidArtifactId(id)) return null
    try {
      return JSON.parse(await readFile(this.metaPath(id), 'utf8')) as StoredArtifactMeta
    } catch {
      return null
    }
  }

  private async enforceQuota(incomingBytes: number): Promise<void> {
    const maxTotalBytes = this.limits.maxTotalBytes ?? 512 * 1024 * 1024
    const maxArtifacts = this.limits.maxArtifacts ?? 2_000
    if (incomingBytes > maxTotalBytes) throw new Error(`artifact exceeds ${maxTotalBytes} byte store quota`)
    const entries = await readdir(this.dir).catch(() => [])
    const metas = (await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) => {
        try {
          return JSON.parse(await readFile(join(this.dir, entry), 'utf8')) as StoredArtifactMeta
        } catch {
          return null
        }
      })))
      .filter((meta): meta is StoredArtifactMeta => Boolean(meta && isValidArtifactId(meta.id)))
    const totalBytes = metas.reduce((sum, meta) => sum + meta.byteSize, 0)
    if (totalBytes + incomingBytes > maxTotalBytes || metas.length + 1 > maxArtifacts) {
      throw new Error('artifact store quota exceeded; remove unneeded artifacts before retrying')
    }
  }
}

function decodeUtf8Window(buffer: Buffer, requestedBytes: number): string {
  const decode = (bytes: Buffer): string => {
    const decoder = new StringDecoder('utf8')
    return decoder.write(bytes)
  }
  const bounded = buffer.subarray(0, Math.min(requestedBytes, buffer.length))
  const text = decode(bounded)
  if (text || bounded.length === 0 || buffer.length <= bounded.length) return text
  // Very small ranges can end before the first multibyte code point completes.
  // Include that one complete character so the cursor advances without losing
  // bytes or looping forever; the overrun is at most three bytes.
  return decode(buffer.subarray(0, Math.min(requestedBytes + 3, buffer.length)))
}
