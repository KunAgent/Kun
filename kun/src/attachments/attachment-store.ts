import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AttachmentsCapabilityConfig } from '../contracts/capabilities.js'
import type {
  AttachmentDiagnostics,
  AttachmentMetadata,
  AttachmentTextFallback,
  AttachmentVisualPreview
} from '../contracts/attachments.js'
import { AttachmentMetadata as AttachmentMetadataSchema } from '../contracts/attachments.js'
import { applyPosixMode } from '../security/posix-permissions.js'
import { jpegDimensions } from './jpeg-dimensions.js'

const ATTACHMENT_ID_PATTERN = /^att_[0-9a-f]{24}$/
const PendingAttachmentLeaseSchema = z.object({
  id: z.string().min(8).max(128),
  createdAt: z.string()
}).strict()
const StoredAttachmentMetadataSchema = AttachmentMetadataSchema.extend({
  pendingLeases: z.array(PendingAttachmentLeaseSchema).default([]),
  leaseManaged: z.boolean().default(false)
}).strict()
type StoredAttachmentMetadata = z.infer<typeof StoredAttachmentMetadataSchema>

export type AttachmentContent = AttachmentMetadata & {
  data: Buffer
}

export interface AttachmentStore {
  create(input: {
    name: string
    data: Buffer
    mimeType?: string
    documentText?: string
    documentFormat?: AttachmentMetadata['documentFormat']
    sourceSha256?: string
    pageCount?: number
    localFilePath?: string
    textFallback?: AttachmentTextFallback
    visualPreview?: AttachmentVisualPreview
    leaseId?: string
    threadId?: string
    workspace?: string
  }): Promise<AttachmentMetadata>
  get(id: string): Promise<AttachmentMetadata | null>
  bindScope(id: string, scope: { threadId?: string; workspace?: string }): Promise<AttachmentMetadata>
  bindScopes(ids: readonly string[], scope: { threadId?: string; workspace?: string }): Promise<AttachmentMetadata[]>
  delete?(id: string): Promise<void>
  releaseLease?(id: string, leaseId: string, referenced: boolean): Promise<boolean>
  pruneExpiredLeases?(
    referencedIds: ReadonlySet<string>,
    expiresBeforeIso: string
  ): Promise<{ deleted: number; released: number }>
  replaceMetadata?(metadata: AttachmentMetadata): Promise<void>
  resolveContent(id: string, scope: { threadId?: string; workspace?: string }): Promise<AttachmentContent>
  textFallbackPolicy(): Pick<
    AttachmentsCapabilityConfig,
    'textFallbackMaxBase64Bytes' | 'textFallbackMaxImageDimension' | 'textFallbackPreferredMimeType'
  >
  diagnostics(): Promise<AttachmentDiagnostics>
}

export class FileAttachmentStore implements AttachmentStore {
  private readonly mutations = new Map<string, Promise<void>>()

  constructor(
    private readonly options: {
      rootDir: string
      config: AttachmentsCapabilityConfig
      nowIso?: () => string
      isRetained?: (id: string) => Promise<boolean>
    }
  ) {}

  async create(input: {
    name: string
    data: Buffer
    mimeType?: string
    documentText?: string
    documentFormat?: AttachmentMetadata['documentFormat']
    sourceSha256?: string
    pageCount?: number
    localFilePath?: string
    textFallback?: AttachmentTextFallback
    visualPreview?: AttachmentVisualPreview
    leaseId?: string
    threadId?: string
    workspace?: string
  }): Promise<AttachmentMetadata> {
    await this.ensureRoot()
    const image = detectImage(input.data)
    const descriptor = image ? this.describeImage(image, input) : this.describeDocument(input)
    if (input.textFallback) validateTextFallback(input.textFallback, this.options.config)
    if (input.visualPreview) validateTextFallback(input.visualPreview, this.options.config)
    const hash = createHash('sha256').update(input.data).digest('hex')
    if (input.sourceSha256 && input.sourceSha256 !== hash) {
      throw new Error('declared source SHA-256 does not match attachment content')
    }
    const id = `att_${hash.slice(0, 24)}`
    const contentPath = this.contentPath(id)
    const metadataPath = this.metadataPath(id)
    const now = this.options.nowIso?.() ?? new Date().toISOString()
    return this.mutate(id, async () => {
      const existing = await this.getStored(id)
      if (existing) {
        const next = mergeScope(mergeLease({
          ...existing,
          kind: descriptor.kind,
          mimeType: descriptor.mimeType,
          ...(descriptor.width ? { width: descriptor.width } : {}),
          ...(descriptor.height ? { height: descriptor.height } : {}),
          ...(input.localFilePath ? { localFilePath: input.localFilePath } : {}),
          ...(input.textFallback ? { textFallback: input.textFallback } : {}),
          ...(input.visualPreview ? { visualPreview: input.visualPreview } : {}),
          ...(descriptor.documentText !== undefined ? { documentText: descriptor.documentText } : {}),
          ...(input.documentFormat ? { documentFormat: input.documentFormat } : {}),
          sourceSha256: hash,
          ...(descriptor.pageCount ? { pageCount: descriptor.pageCount } : {}),
          ...(descriptor.truncated !== undefined ? { truncated: descriptor.truncated } : {}),
          updatedAt: now
        }, input.leaseId, now), input)
        await writeFile(contentPath, input.data, { mode: 0o600 })
        await writeFile(metadataPath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
        return publicMetadata(next)
      }
      const metadata = StoredAttachmentMetadataSchema.parse(mergeScope(mergeLease({
        id,
        name: input.name,
        kind: descriptor.kind,
        mimeType: descriptor.mimeType,
        byteSize: input.data.byteLength,
        hash,
        ...(descriptor.width ? { width: descriptor.width } : {}),
        ...(descriptor.height ? { height: descriptor.height } : {}),
        ...(descriptor.documentText !== undefined ? { documentText: descriptor.documentText } : {}),
        ...(input.documentFormat ? { documentFormat: input.documentFormat } : {}),
        sourceSha256: hash,
        ...(descriptor.pageCount ? { pageCount: descriptor.pageCount } : {}),
        ...(descriptor.truncated !== undefined ? { truncated: descriptor.truncated } : {}),
        ...(input.localFilePath ? { localFilePath: input.localFilePath } : {}),
        ...(input.textFallback ? { textFallback: input.textFallback } : {}),
        ...(input.visualPreview ? { visualPreview: input.visualPreview } : {}),
        pendingLeases: [],
        leaseManaged: false,
        threadIds: [],
        workspaces: [],
        createdAt: now,
        updatedAt: now
      }, input.leaseId, now), input))
      await writeFile(contentPath, input.data, { mode: 0o600 })
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), { encoding: 'utf8', mode: 0o600 })
      return publicMetadata(metadata)
    })
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
    const stored = await this.getStored(id)
    return stored ? publicMetadata(stored) : null
  }

  private async getStored(id: string): Promise<StoredAttachmentMetadata | null> {
    if (!ATTACHMENT_ID_PATTERN.test(id)) return null
    try {
      return StoredAttachmentMetadataSchema.parse(JSON.parse(await readFile(this.metadataPath(id), 'utf8')))
    } catch {
      return null
    }
  }

  async bindScope(id: string, scope: { threadId?: string; workspace?: string }): Promise<AttachmentMetadata> {
    const [metadata] = await this.bindScopes([id], scope)
    return metadata
  }

  async bindScopes(
    ids: readonly string[],
    scope: { threadId?: string; workspace?: string }
  ): Promise<AttachmentMetadata[]> {
    const attachmentIds = [...new Set(ids)]
    if (attachmentIds.length === 0) return []
    return withAttachmentStoreLock(this.options.rootDir, async () => {
      await this.ensureRoot()
      const records = await Promise.all(attachmentIds.map(async (id) => {
        if (!ATTACHMENT_ID_PATTERN.test(id)) throw new Error(`invalid attachment id: ${id}`)
        const metadataText = await readFile(this.metadataPath(id), 'utf8')
          .catch(() => null)
        if (metadataText === null) throw new Error(`attachment not found: ${id}`)
        let metadata: StoredAttachmentMetadata
        try {
          metadata = StoredAttachmentMetadataSchema.parse(JSON.parse(metadataText))
        } catch {
          throw new Error(`attachment not found: ${id}`)
        }
        if (!isAuthorized(metadata, scope)) {
          throw new Error(`attachment is not authorized for this turn: ${id}`)
        }
        await readFile(this.contentPath(id))
        return { id, metadata, metadataText }
      }))
      const now = this.options.nowIso?.() ?? new Date().toISOString()
      const nextRecords = records.map(({ metadata }) =>
        StoredAttachmentMetadataSchema.parse(mergeScope({
          ...metadata,
          updatedAt: now
        }, scope))
      )
      const written: number[] = []
      try {
        for (let index = 0; index < records.length; index += 1) {
          await writeFile(
            this.metadataPath(records[index].id),
            JSON.stringify(nextRecords[index], null, 2),
            { encoding: 'utf8', mode: 0o600 }
          )
          written.push(index)
        }
      } catch (error) {
        await Promise.allSettled(written.map((index) =>
          writeFile(this.metadataPath(records[index].id), records[index].metadataText, {
            encoding: 'utf8',
            mode: 0o600
          })
        ))
        throw error
      }
      return nextRecords.map(publicMetadata)
    })
  }

  async delete(id: string): Promise<void> {
    if (!ATTACHMENT_ID_PATTERN.test(id)) throw new Error(`invalid attachment id: ${id}`)
    await this.mutate(id, () => this.deleteFiles(id))
  }

  private async deleteFiles(id: string): Promise<void> {
    await Promise.all([
      rm(this.contentPath(id), { force: true }),
      rm(this.metadataPath(id), { force: true })
    ])
  }

  async releaseLease(id: string, leaseId: string, referenced: boolean): Promise<boolean> {
    return this.mutate(id, async () => {
      const metadata = await this.getStored(id)
      if (!metadata) return false
      if (!metadata.pendingLeases.some((candidate) => candidate.id === leaseId)) return false
      const pendingLeases = metadata.pendingLeases.filter((candidate) => candidate.id !== leaseId)
      if (!referenced && pendingLeases.length === 0 && !await this.options.isRetained?.(id)) {
        await this.deleteFiles(id)
        return true
      }
      await this.writeStored({
        ...metadata,
        pendingLeases,
        updatedAt: this.options.nowIso?.() ?? new Date().toISOString()
      })
      return true
    })
  }

  async pruneExpiredLeases(
    referencedIds: ReadonlySet<string>,
    expiresBeforeIso: string
  ): Promise<{ deleted: number; released: number }> {
    await this.ensureRoot()
    const entries = await readdir(this.options.rootDir).catch(() => [])
    const ids = entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => entry.slice(0, -'.json'.length))
      .filter((id) => ATTACHMENT_ID_PATTERN.test(id))
    let deleted = 0
    let released = 0
    for (const id of ids) {
      await this.mutate(id, async () => {
        const metadata = await this.getStored(id)
        if (!metadata?.leaseManaged) return
        const pendingLeases = metadata.pendingLeases.filter(
          (lease) => lease.createdAt >= expiresBeforeIso
        )
        released += metadata.pendingLeases.length - pendingLeases.length
        if (pendingLeases.length === 0 && !referencedIds.has(id) && !await this.options.isRetained?.(id)) {
          await this.deleteFiles(id)
          deleted += 1
          return
        }
        if (pendingLeases.length !== metadata.pendingLeases.length) {
          await this.writeStored({
            ...metadata,
            pendingLeases,
            updatedAt: this.options.nowIso?.() ?? new Date().toISOString()
          })
        }
      })
    }
    return { deleted, released }
  }

  async replaceMetadata(metadata: AttachmentMetadata): Promise<void> {
    const parsed = AttachmentMetadataSchema.parse(metadata)
    if (!ATTACHMENT_ID_PATTERN.test(parsed.id)) throw new Error(`invalid attachment id: ${parsed.id}`)
    await this.ensureRoot()
    await this.mutate(parsed.id, async () => {
      await readFile(this.contentPath(parsed.id))
      const existing = await this.getStored(parsed.id)
      await this.writeStored(StoredAttachmentMetadataSchema.parse({
        ...parsed,
        pendingLeases: existing?.pendingLeases ?? [],
        leaseManaged: existing?.leaseManaged ?? false
      }))
    })
  }

  async resolveContent(id: string, scope: { threadId?: string; workspace?: string }): Promise<AttachmentContent> {
    if (!ATTACHMENT_ID_PATTERN.test(id)) throw new Error(`invalid attachment id: ${id}`)
    const stored = await this.getStored(id)
    const metadata = stored ? publicMetadata(stored) : null
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
          .then((text) => publicMetadata(StoredAttachmentMetadataSchema.parse(JSON.parse(text))))
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

  private async writeStored(metadata: StoredAttachmentMetadata): Promise<void> {
    const parsed = StoredAttachmentMetadataSchema.parse(metadata)
    await writeFile(this.metadataPath(parsed.id), JSON.stringify(parsed, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
  }

  private async mutate<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(id) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const settled = result.then(() => undefined, () => undefined)
    this.mutations.set(id, settled)
    try {
      return await result
    } finally {
      if (this.mutations.get(id) === settled) this.mutations.delete(id)
    }
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.options.rootDir, { recursive: true, mode: 0o700 })
    await applyPosixMode(this.options.rootDir, 0o700)
  }
}

const attachmentStoreLocks = new Map<string, Promise<void>>()

async function withAttachmentStoreLock<T>(rootDir: string, operation: () => Promise<T>): Promise<T> {
  const previous = attachmentStoreLocks.get(rootDir) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  attachmentStoreLocks.set(rootDir, tail)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (attachmentStoreLocks.get(rootDir) === tail) attachmentStoreLocks.delete(rootDir)
  }
}

function mergeScope<T extends AttachmentMetadata>(metadata: T, input: { threadId?: string; workspace?: string }): T {
  return {
    ...metadata,
    threadIds: mergeUnique(metadata.threadIds, input.threadId),
    workspaces: mergeUnique(metadata.workspaces, input.workspace)
  }
}

function mergeLease<T extends StoredAttachmentMetadata>(
  metadata: T,
  leaseId: string | undefined,
  createdAt: string
): T {
  if (!leaseId || metadata.pendingLeases.some((lease) => lease.id === leaseId)) return metadata
  return {
    ...metadata,
    leaseManaged: true,
    pendingLeases: [...metadata.pendingLeases, { id: leaseId, createdAt }]
  }
}

function publicMetadata(metadata: StoredAttachmentMetadata): AttachmentMetadata {
  const { pendingLeases: _pendingLeases, leaseManaged: _leaseManaged, ...value } = metadata
  return AttachmentMetadataSchema.parse(value)
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
  const declared = input.mimeType?.trim().toLowerCase()
  const isPdf = input.data.length >= 5 &&
    input.data.subarray(0, 5).toString('ascii') === '%PDF-'
  if (isPdf) {
    if (declared && declared !== 'application/pdf') {
      throw new Error(`declared MIME type does not match PDF content: ${declared}`)
    }
    return 'application/pdf'
  }
  if (declared === 'application/pdf') return undefined

  if (declared && isOoxmlMimeType(declared)) {
    const zipSignature = input.data.length >= 4
      ? input.data.subarray(0, 4).toString('hex')
      : ''
    if (!['504b0304', '504b0506', '504b0708'].includes(zipSignature)) return undefined
  }
  return declared || undefined
}

function isOoxmlMimeType(mimeType: string): boolean {
  return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

function decodeTextDocument(mimeType: string, data: Buffer): string | undefined {
  if (
    !mimeType.startsWith('text/') &&
    mimeType !== 'application/json' &&
    mimeType !== 'application/xml'
  ) return undefined
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    const body = data.subarray(2, data.length - ((data.length - 2) % 2))
    return body.toString('utf16le')
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    const body = Buffer.from(data.subarray(2, data.length - ((data.length - 2) % 2)))
    for (let index = 0; index + 1 < body.length; index += 2) {
      const first = body[index]
      body[index] = body[index + 1]
      body[index + 1] = first
    }
    return body.toString('utf16le')
  }
  return data.toString('utf8').replace(/^\uFEFF/, '')
}

export function detectImage(buffer: Buffer): { mimeType: string; width?: number; height?: number } | null {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', ...jpegDimensions(buffer) }
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp' }
  }
  return null
}
