import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, rename, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { brotliCompress, brotliDecompress, constants as zlibConstants } from 'node:zlib'
import { promisify } from 'node:util'
import {
  PromptManifestSchema,
  PROMPT_MANIFEST_SCHEMA_VERSION,
  type PromptBlobRef,
  type PromptManifest
} from '../contracts/trajectory.js'
import { applyPosixMode } from '../security/posix-permissions.js'
import { redactBrowserUseDebugContent } from './llm-debug-recorder-support.js'
import { redactModelTraceValues } from './model-request-trace-safety.js'

const compress = promisify(brotliCompress)
const decompress = promisify(brotliDecompress)

export const TRAJECTORY_MAX_TOTAL_DETAIL_BYTES = 512 * 1024 * 1024
export const TRAJECTORY_MAX_THREAD_DETAIL_BYTES = 64 * 1024 * 1024
export const TRAJECTORY_INLINE_PREVIEW_BYTES = 16 * 1024
export const TRAJECTORY_SEARCH_PREVIEW_BYTES = 2 * 1024
export const TRAJECTORY_MAX_BLOB_BYTES = 8 * 1024 * 1024
export const TRAJECTORY_BLOB_HEAD_BYTES = 512 * 1024
export const TRAJECTORY_BLOB_TAIL_BYTES = 64 * 1024

type StoredPromptPart = { kind: PromptBlobRef['kind']; value: unknown }

/** Filesystem-authoritative, immutable prompt detail shared across threads. */
export class TrajectoryContentStore {
  private readonly root: string
  private readonly manifestsRoot: string
  private readonly blobsRoot: string
  private maintenanceAt = 0

  constructor(dataDir: string) {
    this.root = join(dataDir, 'observability', 'trajectory')
    this.manifestsRoot = join(this.root, 'manifests')
    this.blobsRoot = join(this.root, 'blobs')
  }

  async captureRequest(input: {
    threadId: string
    requestId: string
    bodyText: string
    secretValues: readonly string[]
  }): Promise<PromptManifest> {
    await this.ensureReady()
    const sanitized = sanitizePromptValue(parsePromptBody(redactModelTraceValues(
      redactBrowserUseDebugContent(input.bodyText),
      input.secretValues
    )))
    const refs: PromptBlobRef[] = []
    for (const part of promptParts(sanitized)) refs.push(await this.putBlob(part))
    const manifest: PromptManifest = {
      schemaVersion: PROMPT_MANIFEST_SCHEMA_VERSION,
      manifestId: input.requestId,
      threadId: input.threadId,
      requestId: input.requestId,
      createdAt: new Date().toISOString(),
      blobs: refs,
      messageItemIds: collectStringIds(sanitized, ['itemId', 'item_id', 'messageId', 'message_id']),
      attachmentIds: collectStringIds(sanitized, ['attachmentId', 'attachment_id']),
      retainedBytes: refs.reduce((total, ref) => total + ref.compressedSize, 0)
    }
    const dir = this.threadManifestDir(input.threadId)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await applyPosixMode(dir, 0o700)
    const path = this.manifestPath(input.threadId, input.requestId)
    await privateAtomicWrite(path, `${JSON.stringify(manifest)}\n`)
    await this.enforceThreadBudget(input.threadId)
    if (Date.now() >= this.maintenanceAt) {
      this.maintenanceAt = Date.now() + 5 * 60 * 1_000
      await this.enforceGlobalBudget()
    }
    return manifest
  }

  async loadManifest(threadId: string, manifestId: string): Promise<PromptManifest | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.manifestPath(threadId, manifestId), 'utf8'))
      const parsed = PromptManifestSchema.safeParse(value)
      return parsed.success && parsed.data.threadId === threadId ? parsed.data : null
    } catch (error) {
      return isMissing(error) ? null : Promise.reject(error)
    }
  }

  async loadManifestContent(threadId: string, manifestId: string): Promise<{
    manifest: PromptManifest
    parts: Array<{ kind: PromptBlobRef['kind']; content: unknown; truncated: boolean }>
  } | null> {
    const manifest = await this.loadManifest(threadId, manifestId)
    if (!manifest) return null
    const parts = []
    for (const ref of manifest.blobs) {
      const text = await this.loadBlob(ref.blobId)
      if (text === null) continue
      parts.push({ kind: ref.kind, content: parseStoredContent(text), truncated: ref.truncated })
    }
    return { manifest, parts }
  }

  async deleteThread(threadId: string): Promise<void> {
    await rm(this.threadManifestDir(threadId), { recursive: true, force: true })
    await this.collectUnreferencedBlobs()
  }

  private async putBlob(part: StoredPromptPart): Promise<PromptBlobRef> {
    const text = typeof part.value === 'string' ? part.value : JSON.stringify(part.value)
    const full = Buffer.from(text ?? '', 'utf8')
    const blobId = createHash('sha256').update(full).digest('hex')
    const truncated = full.byteLength > TRAJECTORY_MAX_BLOB_BYTES
    const retained = truncated
      ? Buffer.concat([
          full.subarray(0, TRAJECTORY_BLOB_HEAD_BYTES),
          Buffer.from('\n...[trajectory blob truncated]...\n'),
          full.subarray(Math.max(0, full.byteLength - TRAJECTORY_BLOB_TAIL_BYTES))
        ])
      : full
    const compressed = await compress(retained, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 }
    })
    const path = this.blobPath(blobId)
    try {
      await writeFile(path, compressed, { flag: 'wx', mode: 0o600 })
      await applyPosixMode(path, 0o600)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
    return {
      blobId,
      kind: part.kind,
      codec: 'br',
      rawSize: full.byteLength,
      compressedSize: compressed.byteLength,
      truncated
    }
  }

  private async loadBlob(blobId: string): Promise<string | null> {
    try {
      return (await decompress(await readFile(this.blobPath(blobId)))).toString('utf8')
    } catch (error) {
      return isMissing(error) ? null : Promise.reject(error)
    }
  }

  private async ensureReady(): Promise<void> {
    await Promise.all([
      mkdir(this.manifestsRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.blobsRoot, { recursive: true, mode: 0o700 })
    ])
    await Promise.all([
      applyPosixMode(this.root, 0o700),
      applyPosixMode(this.manifestsRoot, 0o700),
      applyPosixMode(this.blobsRoot, 0o700)
    ])
  }

  private async enforceThreadBudget(threadId: string): Promise<void> {
    const entries = await this.listManifests(this.threadManifestDir(threadId))
    let retained = entries.reduce((total, entry) => total + entry.manifest.retainedBytes, 0)
    for (const entry of entries.sort((a, b) => a.createdAt - b.createdAt)) {
      if (retained <= TRAJECTORY_MAX_THREAD_DETAIL_BYTES) break
      await rm(entry.path, { force: true })
      retained -= entry.manifest.retainedBytes
    }
    if (retained !== entries.reduce((total, entry) => total + entry.manifest.retainedBytes, 0)) {
      await this.collectUnreferencedBlobs()
    }
  }

  private async enforceGlobalBudget(): Promise<void> {
    const threadDirs = await safeReadDir(this.manifestsRoot)
    const manifests = (await Promise.all(threadDirs.map((name) =>
      this.listManifests(join(this.manifestsRoot, name))))).flat()
    let retained = manifests.reduce((total, entry) => total + entry.manifest.retainedBytes, 0)
    for (const entry of manifests.sort((a, b) => a.createdAt - b.createdAt)) {
      if (retained <= TRAJECTORY_MAX_TOTAL_DETAIL_BYTES) break
      await rm(entry.path, { force: true })
      retained -= entry.manifest.retainedBytes
    }
    await this.collectUnreferencedBlobs()
  }

  private async collectUnreferencedBlobs(): Promise<void> {
    const threadDirs = await safeReadDir(this.manifestsRoot)
    const manifests = (await Promise.all(threadDirs.map((name) =>
      this.listManifests(join(this.manifestsRoot, name))))).flat()
    const referenced = new Set(manifests.flatMap((entry) =>
      entry.manifest.blobs.map((blob) => blob.blobId)))
    for (const name of await safeReadDir(this.blobsRoot)) {
      if (!name.endsWith('.br') || referenced.has(name.slice(0, -3))) continue
      await rm(join(this.blobsRoot, name), { force: true })
    }
  }

  private async listManifests(dir: string): Promise<Array<{
    path: string
    createdAt: number
    manifest: PromptManifest
  }>> {
    const out = []
    for (const name of await safeReadDir(dir)) {
      if (!name.endsWith('.json')) continue
      const path = join(dir, name)
      try {
        const parsed = PromptManifestSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) continue
        const info = await stat(path)
        out.push({ path, createdAt: Date.parse(parsed.data.createdAt) || info.mtimeMs, manifest: parsed.data })
      } catch {
        // Corrupt manifests are ignored; detail APIs surface unavailable state.
      }
    }
    return out
  }

  private threadManifestDir(threadId: string): string {
    return join(this.manifestsRoot, Buffer.from(threadId, 'utf8').toString('base64url') || 'empty')
  }

  private manifestPath(threadId: string, manifestId: string): string {
    const name = Buffer.from(manifestId, 'utf8').toString('base64url') || 'empty'
    return join(this.threadManifestDir(threadId), `${name}.json`)
  }

  private blobPath(blobId: string): string {
    return join(this.blobsRoot, `${blobId}.br`)
  }
}

function parsePromptBody(value: string): unknown {
  try { return JSON.parse(value) as unknown } catch { return { rawText: value } }
}

function promptParts(value: unknown): StoredPromptPart[] {
  if (!isRecord(value)) return [{ kind: 'message', value }]
  const nested = isRecord(value.request) ? value.request : undefined
  const source = nested ?? value
  const parts: StoredPromptPart[] = []
  const system = source.system ?? source.instructions ?? source.systemInstruction
  if (system !== undefined) parts.push({ kind: 'system', value: system })
  if (source.tools !== undefined) parts.push({ kind: 'tools', value: source.tools })
  const messages = source.messages ?? source.input ?? source.contents
  if (Array.isArray(messages)) {
    for (const message of messages) parts.push({ kind: 'message', value: message })
  } else if (messages !== undefined) {
    parts.push({ kind: 'message', value: messages })
  }
  const structural = new Set(['system', 'instructions', 'systemInstruction', 'tools', 'messages', 'input', 'contents'])
  const config = Object.fromEntries(Object.entries(source).filter(([key]) => !structural.has(key)))
  if (nested) Object.assign(config, Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'request')))
  if (Object.keys(config).length) parts.push({ kind: 'config', value: config })
  return parts
}

function sanitizePromptValue(value: unknown, key = ''): unknown {
  if (sensitiveKey(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    if (/^data:[^;,]+;base64,/i.test(value) || looksLikeLargeBase64(value)) return '[BINARY OMITTED]'
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizePromptValue(entry))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => [
    name,
    sanitizePromptValue(entry, name)
  ]))
}

function collectStringIds(value: unknown, keys: readonly string[]): string[] {
  const wanted = new Set(keys)
  const found = new Set<string>()
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) return entry.forEach(visit)
    if (!isRecord(entry)) return
    for (const [key, child] of Object.entries(entry)) {
      if (wanted.has(key) && typeof child === 'string' && child) found.add(child)
      visit(child)
    }
  }
  visit(value)
  return [...found]
}

async function privateAtomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, path)
  await applyPosixMode(path, 0o600)
}

async function safeReadDir(path: string): Promise<string[]> {
  try { return await readdir(path) } catch (error) { return isMissing(error) ? [] : Promise.reject(error) }
}

function parseStoredContent(value: string): unknown {
  try { return JSON.parse(value) as unknown } catch { return value }
}

function looksLikeLargeBase64(value: string): boolean {
  return value.length > 4_096 && value.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(value)
}

function sensitiveKey(value: string): boolean {
  return /authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|cookie|secret|private[_-]?key|credential/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
}
