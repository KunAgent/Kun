import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AttachmentsCapabilityConfig } from '../contracts/capabilities.js'
import type { AttachmentDiagnostics, AttachmentMetadata, AttachmentTextFallback } from '../contracts/attachments.js'
import { AttachmentMetadata as AttachmentMetadataSchema } from '../contracts/attachments.js'

const ATTACHMENT_ID_PATTERN = /^att_[0-9a-f]{24}$/

export type AttachmentContent = AttachmentMetadata & {
  data: Buffer
}

export interface AttachmentStore {
  create(input: {
    name: string
    data: Buffer
    mimeType?: string
    documentText?: string
    pageCount?: number
    localFilePath?: string
    textFallback?: AttachmentTextFallback
    threadId?: string
    workspace?: string
  }): Promise<AttachmentMetadata>
  get(id: string): Promise<AttachmentMetadata | null>
  delete?(id: string): Promise<void>
  replaceMetadata?(metadata: AttachmentMetadata): Promise<void>
  resolveContent(id: string, scope: { threadId?: string; workspace?: string }): Promise<AttachmentContent>
  textFallbackPolicy(): Pick<
    AttachmentsCapabilityConfig,
    'textFallbackMaxBase64Bytes' | 'textFallbackMaxImageDimension' | 'textFallbackPreferredMimeType'
  >
  diagnostics(): Promise<AttachmentDiagnostics>
}

export class FileAttachmentStore implements AttachmentStore {
  constructor(
    private readonly options: {
      rootDir: string
      config: AttachmentsCapabilityConfig
      nowIso?: () => string
    }
  ) {}

  async create(input: {
    name: string
    data: Buffer
    mimeType?: string
    documentText?: string
    pageCount?: number
    localFilePath?: string
    textFallback?: AttachmentTextFallback
    threadId?: string
    workspace?: string
  }): Promise<AttachmentMetadata> {
    await this.ensureRoot()
    const image = detectImage(input.data)
    const descriptor = image ? this.describeImage(image, input) : this.describeDocument(input)
    if (input.textFallback) validateTextFallback(input.textFallback, this.options.config)
    const hash = createHash('sha256').update(input.data).digest('hex')
    const id = `att_${hash.slice(0, 24)}`
    const contentPath = this.contentPath(id)
    const metadataPath = this.metadataPath(id)
    const now = this.options.nowIso?.() ?? new Date().toISOString()
    const existing = await this.get(id)
    if (existing) {
      const next = mergeScope({
        ...existing,
        kind: descriptor.kind,
        mimeType: descriptor.mimeType,
        ...(input.localFilePath ? { localFilePath: input.localFilePath } : {}),
        ...(input.textFallback ? { textFallback: input.textFallback } : {}),
        ...(descriptor.documentText !== undefined ? { documentText: descriptor.documentText } : {}),
        ...(descriptor.pageCount ? { pageCount: descriptor.pageCount } : {}),
        ...(descriptor.truncated !== undefined ? { truncated: descriptor.truncated } : {}),
        updatedAt: now
      }, input)
      await writeFile(contentPath, input.data, { mode: 0o600 })
      await writeFile(metadataPath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
      return next
    }
    const metadata: AttachmentMetadata = AttachmentMetadataSchema.parse(mergeScope({
      id,
      name: input.name,
      kind: descriptor.kind,
      mimeType: descriptor.mimeType,
      byteSize: input.data.byteLength,
      hash,
      ...(descriptor.width ? { width: descriptor.width } : {}),
      ...(descriptor.height ? { height: descriptor.height } : {}),
      ...(descriptor.documentText !== undefined ? { documentText: descriptor.documentText } : {}),
      ...(descriptor.pageCount ? { pageCount: descriptor.pageCount } : {}),
      ...(descriptor.truncated !== undefined ? { truncated: descriptor.truncated } : {}),
      ...(input.localFilePath ? { localFilePath: input.localFilePath } : {}),
      ...(input.textFallback ? { textFallback: input.textFallback } : {}),
      threadIds: [],
      workspaces: [],
      createdAt: now,
      updatedAt: now
    }, input))
    await writeFile(contentPath, input.data, { mode: 0o600 })
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), { encoding: 'utf8', mode: 0o600 })
    return metadata
  }

  private describeImage(
    image: { mimeType: string; width?: number; height?: number },
    input: { data: Buffer; mimeType?: string }
  ): AttachmentDescriptor {
    if (input.mimeType && input.mimeType !== image.mimeType) throw new Error('declared MIME type does not match image content')
    if (!this.options.config.allowedMimeTypes.includes(image.mimeType)) throw new Error(`image MIME type is not allowed: ${image.mimeType}`)
    if (input.data.byteLength > this.options.config.maxImageBytes) throw new Error(`image exceeds ${this.options.config.maxImageBytes} byte limit`)
    const maxDimension = Math.max(image.width ?? 0, image.height ?? 0)
    if (maxDimension > this.options.config.maxImageDimension) {
      throw new Error(`image exceeds ${this.options.config.maxImageDimension}px dimension limit`)
    }
    return { kind: 'image', mimeType: image.mimeType, width: image.width, height: image.height }
  }

  private describeDocument(input: {
    data: Buffer
    mimeType?: string
    documentText?: string
    pageCount?: number
  }): AttachmentDescriptor {
    const mimeType = resolveDocumentMimeType(input)
    const allowed = this.options.config.allowedDocumentMimeTypes
    if (!mimeType || !allowed.includes(mimeType)) {
      throw new Error(`unsupported attachment type (expected an image or an allowed document, got ${mimeType ?? input.mimeType ?? 'unknown'})`)
    }
    if (input.data.byteLength > this.options.config.maxDocumentBytes) {
      throw new Error(`document exceeds ${this.options.config.maxDocumentBytes} byte limit`)
    }
    const rawText = input.documentText ?? decodeTextDocument(mimeType, input.data)
    if (rawText === undefined) {
      throw new Error(`document text is required for ${mimeType} attachments`)
    }
    const limit = this.options.config.maxDocumentTextChars
    const truncated = rawText.length > limit
    return {
      kind: 'document',
      mimeType,
      documentText: truncated ? rawText.slice(0, limit) : rawText,
      ...(input.pageCount ? { pageCount: input.pageCount } : {}),
      ...(truncated ? { truncated: true } : {})
    }
  }

  async get(id: string): Promise<AttachmentMetadata | null> {
    if (!ATTACHMENT_ID_PATTERN.test(id)) return null
    try {
      return AttachmentMetadataSchema.parse(JSON.parse(await readFile(this.metadataPath(id), 'utf8')))
    } catch {
      return null
    }
  }

  async delete(id: string): Promise<void> {
    if (!ATTACHMENT_ID_PATTERN.test(id)) throw new Error(`invalid attachment id: ${id}`)
    await Promise.all([
      rm(this.contentPath(id), { force: true }),
      rm(this.metadataPath(id), { force: true })
    ])
  }

  async replaceMetadata(metadata: AttachmentMetadata): Promise<void> {
    const parsed = AttachmentMetadataSchema.parse(metadata)
    if (!ATTACHMENT_ID_PATTERN.test(parsed.id)) throw new Error(`invalid attachment id: ${parsed.id}`)
    await this.ensureRoot()
    await readFile(this.contentPath(parsed.id))
    await writeFile(this.metadataPath(parsed.id), JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o600 })
  }

  async resolveContent(id: string, scope: { threadId?: string; workspace?: string }): Promise<AttachmentContent> {
    if (!ATTACHMENT_ID_PATTERN.test(id)) throw new Error(`invalid attachment id: ${id}`)
    const metadata = await this.get(id)
    if (!metadata) throw new Error(`attachment not found: ${id}`)
    if (!isAuthorized(metadata, scope)) throw new Error(`attachment is not authorized for this turn: ${id}`)
    return {
      ...metadata,
      data: await readFile(this.contentPath(id))
    }
  }

  async diagnostics(): Promise<AttachmentDiagnostics> {
    await this.ensureRoot()
    const entries = await readdir(this.options.rootDir).catch(() => [])
    const metadata = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => readFile(join(this.options.rootDir, entry), 'utf8')
          .then((text) => AttachmentMetadataSchema.parse(JSON.parse(text)))
          .catch(() => null))
    )
    const records = metadata.filter((record): record is AttachmentMetadata => Boolean(record))
    return {
      enabled: this.options.config.enabled,
      rootDir: this.options.rootDir,
      count: records.length,
      totalBytes: records.reduce((total, record) => total + record.byteSize, 0)
    }
  }

  textFallbackPolicy(): Pick<
    AttachmentsCapabilityConfig,
    'textFallbackMaxBase64Bytes' | 'textFallbackMaxImageDimension' | 'textFallbackPreferredMimeType'
  > {
    return {
      textFallbackMaxBase64Bytes: this.options.config.textFallbackMaxBase64Bytes,
      textFallbackMaxImageDimension: this.options.config.textFallbackMaxImageDimension,
      textFallbackPreferredMimeType: this.options.config.textFallbackPreferredMimeType
    }
  }

  private contentPath(id: string): string {
    return join(this.options.rootDir, `${id}.bin`)
  }

  private metadataPath(id: string): string {
    return join(this.options.rootDir, `${id}.json`)
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.options.rootDir, { recursive: true, mode: 0o700 })
    await chmod(this.options.rootDir, 0o700)
  }
}

function mergeScope<T extends AttachmentMetadata>(metadata: T, input: { threadId?: string; workspace?: string }): T {
  return {
    ...metadata,
    threadIds: mergeUnique(metadata.threadIds, input.threadId),
    workspaces: mergeUnique(metadata.workspaces, input.workspace)
  }
}

function mergeUnique(values: string[], value: string | undefined): string[] {
  return value && !values.includes(value) ? [...values, value] : values
}

function isAuthorized(metadata: AttachmentMetadata, scope: { threadId?: string; workspace?: string }): boolean {
  if (metadata.threadIds.length === 0 && metadata.workspaces.length === 0) return true
  if (scope.threadId && metadata.threadIds.includes(scope.threadId)) return true
  if (scope.workspace && metadata.workspaces.includes(scope.workspace)) return true
  return false
}

function validateTextFallback(fallback: AttachmentTextFallback, config: AttachmentsCapabilityConfig): void {
  if (!config.allowedMimeTypes.includes(fallback.mimeType)) {
    throw new Error(`fallback image MIME type is not allowed: ${fallback.mimeType}`)
  }
  if (Buffer.byteLength(fallback.dataBase64, 'utf8') > config.textFallbackMaxBase64Bytes) {
    throw new Error(`fallback image exceeds ${config.textFallbackMaxBase64Bytes} base64 byte limit`)
  }
  const maxDimension = Math.max(fallback.width ?? 0, fallback.height ?? 0)
  if (maxDimension > config.textFallbackMaxImageDimension) {
    throw new Error(`fallback image exceeds ${config.textFallbackMaxImageDimension}px dimension limit`)
  }
}

type AttachmentDescriptor = {
  kind: 'image' | 'document'
  mimeType: string
  width?: number
  height?: number
  documentText?: string
  pageCount?: number
  truncated?: boolean
}

function resolveDocumentMimeType(input: { data: Buffer; mimeType?: string }): string | undefined {
  if (input.data.length >= 5 && input.data.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf'
  }
  return input.mimeType?.trim().toLowerCase() || undefined
}

function decodeTextDocument(mimeType: string, data: Buffer): string | undefined {
  if (!mimeType.startsWith('text/') && mimeType !== 'application/json') return undefined
  return data.toString('utf8').replace(/^\uFEFF/, '')
}

export function detectImage(buffer: Buffer): { mimeType: string; width?: number; height?: number } | null {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg' }
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp' }
  }
  return null
}
