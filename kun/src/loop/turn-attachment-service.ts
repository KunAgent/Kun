import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { AttachmentContent, AttachmentStore } from '../attachments/attachment-store.js'
import { detectImage } from '../attachments/attachment-store.js'
import { MAX_TURN_ATTACHMENT_BYTES, MAX_TURN_ATTACHMENT_IDS } from '../contracts/attachments.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type {
  ModelDocumentAttachment,
  ModelInputAttachment,
  ModelMessageAttachments,
  ModelTextAttachmentFallback,
  ModelToolSpec
} from '../ports/model-client.js'
import type { TurnItem } from '../contracts/items.js'
import type { ToolResultImage } from './tool-result-image.js'
import type { ResolvedTurnAttachments } from './turn-execution-types.js'
import type { AttachmentAliases } from '../contracts/attachment-aliases.js'
import { projectSharedAttachment } from '../attachments/shared-attachment-content.js'

const MAX_TURN_DOCUMENT_CHARS = 400_000

/**
 * Owns attachment materialization for one prepared model request. It does not
 * write session/thread state; access authorization remains with AttachmentStore.
 */
export class TurnAttachmentService {
  constructor(
    private readonly attachmentStoreSource?:
      | AttachmentStore
      | (() => AttachmentStore | undefined)
  ) {}

  async resolveTurnAttachments(input: {
    attachmentIds: readonly string[]
    threadId: string
    workspace: string
    modelCapabilities: ModelCapabilityMetadata
    attachmentAliases?: AttachmentAliases
  }): Promise<ResolvedTurnAttachments> {
    if (input.attachmentIds.length === 0) {
      return { imageAttachments: [], textFallbacks: [], documents: [] }
    }
    if (input.attachmentIds.length > MAX_TURN_ATTACHMENT_IDS) {
      throw new Error(`turn exceeds ${MAX_TURN_ATTACHMENT_IDS} attachment limit`)
    }
    if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
      throw new Error('turn attachment ids must not contain duplicates')
    }
    const attachmentStore = this.attachmentStore()
    if (!attachmentStore) throw new Error('attachment store is unavailable')

    const supportsImageInput = input.modelCapabilities.inputModalities.includes('image')
    const textFallbackPolicy = attachmentStore.textFallbackPolicy()
    const imageAttachments: ModelInputAttachment[] = []
    const textFallbacks: ModelTextAttachmentFallback[] = []
    const documents: ModelDocumentAttachment[] = []
    let remainingDocumentChars = MAX_TURN_DOCUMENT_CHARS
    let totalAttachmentBytes = 0
    for (const id of input.attachmentIds) {
      const original = await attachmentStore.resolveContent(id, {
        threadId: input.threadId,
        workspace: input.workspace
      })
      const attachment = await projectSharedAttachment(original, input.threadId, input.attachmentAliases)
      totalAttachmentBytes += attachment.data.byteLength
      if (totalAttachmentBytes > MAX_TURN_ATTACHMENT_BYTES) {
        throw new Error(`turn attachments exceed ${MAX_TURN_ATTACHMENT_BYTES} byte limit`)
      }
      if (attachment.kind === 'document') {
        const fullText = attachment.documentText ?? ''
        const text = fullText.slice(0, Math.max(0, remainingDocumentChars))
        remainingDocumentChars -= text.length
        documents.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          text,
          byteSize: attachment.byteSize,
          ...(attachment.documentFormat ? { documentFormat: attachment.documentFormat } : {}),
          ...(attachment.sourceSha256 ? { sourceSha256: attachment.sourceSha256 } : {}),
          ...(attachment.pageCount ? { pageCount: attachment.pageCount } : {}),
          ...(attachment.truncated || text.length < fullText.length ? { truncated: true } : {}),
          ...(attachment.localFilePath ? { localFilePath: attachment.localFilePath } : {})
        })
        if (supportsImageInput && attachment.visualPreview) {
          const preview = attachment.visualPreview
          const previewBase64Bytes = Buffer.byteLength(preview.dataBase64, 'utf8')
          if (previewBase64Bytes > textFallbackPolicy.textFallbackMaxBase64Bytes) {
            throw new Error(
              `attachment ${attachment.id} visual preview exceeds ${textFallbackPolicy.textFallbackMaxBase64Bytes} base64 byte limit`
            )
          }
          totalAttachmentBytes += preview.byteSize
          if (totalAttachmentBytes > MAX_TURN_ATTACHMENT_BYTES) {
            throw new Error(`turn attachments exceed ${MAX_TURN_ATTACHMENT_BYTES} byte limit`)
          }
          imageAttachments.push({
            id: `${attachment.id}_preview`,
            name: `${attachment.name} preview`,
            mimeType: preview.mimeType,
            dataBase64: preview.dataBase64,
            ...(preview.width ? { width: preview.width } : {}),
            ...(preview.height ? { height: preview.height } : {}),
            ...(attachment.localFilePath ? { localFilePath: attachment.localFilePath } : {})
          })
        }
        if (remainingDocumentChars <= 0) break
        continue
      }
      if (supportsImageInput) {
        imageAttachments.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataBase64: attachment.data.toString('base64'),
          ...(attachment.width ? { width: attachment.width } : {}),
          ...(attachment.height ? { height: attachment.height } : {}),
          ...(attachment.localFilePath ? { localFilePath: attachment.localFilePath } : {})
        })
        continue
      }
      textFallbacks.push(buildTextAttachmentFallback(
        attachment,
        textFallbackPolicy.textFallbackMaxBase64Bytes
      ))
    }
    return { imageAttachments, textFallbacks, documents }
  }

  async resolveHistoryAttachments(input: {
    items: readonly TurnItem[]
    threadId: string
    workspace: string
    modelCapabilities: ModelCapabilityMetadata
    restrictMetadata?: boolean
  }): Promise<NonNullable<import('../ports/model-client.js').ModelRequest['messageAttachments']>> {
    const users = input.items.filter(
      (item): item is Extract<TurnItem, { kind: 'user_message' }> =>
        item.kind === 'user_message' && Boolean(item.attachmentIds?.length)
    )
    const resolved = await Promise.all(users.map(async (item) => {
      const attachmentIds = item.attachmentIds ?? []
      const payload = await this.resolveMessageAttachments({
        attachmentIds,
        threadId: input.threadId,
        workspace: input.workspace,
        modelCapabilities: input.modelCapabilities,
        attachmentAliases: item.attachmentAliases ?? (input.restrictMetadata ? [] : undefined)
      })
      return [item.id, payload] as const
    }))
    return Object.fromEntries(resolved)
  }

  private async resolveMessageAttachments(input: {
    attachmentIds: readonly string[]
    threadId: string
    workspace: string
    modelCapabilities: ModelCapabilityMetadata
    attachmentAliases?: AttachmentAliases
  }): Promise<ModelMessageAttachments> {
    try {
      const attachments = await this.resolveTurnAttachments(input)
      return orderedMessageAttachments(input.attachmentIds, attachments)
    } catch {
      // One missing historical blob must not suppress the other attachments
      // from the same retained user message. Resolve each original ID in
      // order and replace only the unavailable entry with a stable marker.
      const payload: ModelMessageAttachments = {
        images: [], textFallbacks: [], documents: [], unavailable: [], order: []
      }
      for (const id of input.attachmentIds) {
        try {
          const attachment = await this.resolveTurnAttachments({ ...input, attachmentIds: [id] })
          appendResolvedAttachments(payload, attachment)
        } catch {
          payload.unavailable.push(unavailableAttachment(id))
          payload.order?.push({ kind: 'unavailable', index: payload.unavailable.length - 1 })
        }
      }
      return payload
    }
  }

  /**
   * Resolve generated-image bytes for one transient follow-up request. Prefer
   * the scoped attachment created by the tool, then safely degrade to its
   * recorded file path if the attachment is unavailable.
   */
  async resolveGeneratedImageForForward(
    output: Record<string, unknown>,
    threadId: string,
    workspace: string | undefined
  ): Promise<ToolResultImage | null> {
    const fromBytes = (data: Buffer, fallbackMime?: string): ToolResultImage => {
      const detected = detectImage(data)
      return {
        mimeType: detected?.mimeType ?? fallbackMime ?? 'image/png',
        dataBase64: data.toString('base64'),
        ...(detected?.width !== undefined ? { width: detected.width } : {}),
        ...(detected?.height !== undefined ? { height: detected.height } : {})
      }
    }
    const attachments = Array.isArray(output.attachments) ? output.attachments : []
    const firstAttachment = attachments[0]
    const attachmentId =
      firstAttachment && typeof firstAttachment === 'object' &&
      typeof (firstAttachment as { id?: unknown }).id === 'string'
        ? (firstAttachment as { id: string }).id
        : ''
    const attachmentStore = this.attachmentStore()
    if (attachmentId && attachmentStore) {
      try {
        const content = await attachmentStore.resolveContent(attachmentId, {
          threadId,
          ...(workspace ? { workspace } : {})
        })
        return fromBytes(content.data, content.mimeType)
      } catch {
        // Fall through to the recorded file path.
      }
    }
    const files = Array.isArray(output.files) ? output.files : []
    const firstFile = files[0]
    const absolutePath =
      firstFile && typeof firstFile === 'object' &&
      typeof (firstFile as { absolutePath?: unknown }).absolutePath === 'string'
        ? (firstFile as { absolutePath: string }).absolutePath
        : ''
    if (absolutePath) {
      try {
        return fromBytes(await readFile(absolutePath))
      } catch {
        // No image forwarding is preferable to failing a completed tool turn.
      }
    }
    return null
  }

  private attachmentStore(): AttachmentStore | undefined {
    return typeof this.attachmentStoreSource === 'function'
      ? this.attachmentStoreSource()
      : this.attachmentStoreSource
  }
}

function orderedMessageAttachments(
  attachmentIds: readonly string[],
  attachments: ResolvedTurnAttachments
): ModelMessageAttachments {
  const payload: ModelMessageAttachments = {
    images: [...attachments.imageAttachments],
    textFallbacks: [...attachments.textFallbacks],
    documents: [...attachments.documents],
    unavailable: [],
    order: []
  }
  for (const id of attachmentIds) {
    payload.images.forEach((attachment, index) => {
      if (attachment.id === id || attachment.id === `${id}_preview`) {
        payload.order?.push({ kind: 'image', index })
      }
    })
    payload.textFallbacks.forEach((attachment, index) => {
      if (attachment.id === id) payload.order?.push({ kind: 'text_fallback', index })
    })
    payload.documents.forEach((attachment, index) => {
      if (attachment.id === id) payload.order?.push({ kind: 'document', index })
    })
  }
  return payload
}

function appendResolvedAttachments(
  payload: ModelMessageAttachments,
  attachments: ResolvedTurnAttachments
): void {
  for (const image of attachments.imageAttachments) {
    payload.images.push(image)
    payload.order?.push({ kind: 'image', index: payload.images.length - 1 })
  }
  for (const fallback of attachments.textFallbacks) {
    payload.textFallbacks.push(fallback)
    payload.order?.push({ kind: 'text_fallback', index: payload.textFallbacks.length - 1 })
  }
  for (const document of attachments.documents) {
    payload.documents.push(document)
    payload.order?.push({ kind: 'document', index: payload.documents.length - 1 })
  }
}

function unavailableAttachment(id: string): import('../ports/model-client.js').ModelUnavailableAttachment {
  return {
    id,
    text: `[Attachment unavailable]\nAttachmentId: ${id}\nThe retained attachment content could not be resolved. Do not infer its contents.\n[/Attachment unavailable]`
  }
}

export function attachmentRequestPipelineDetails(input: {
  attachmentIds: readonly string[]
  imageAttachments: readonly ModelInputAttachment[]
  textFallbacks: readonly ModelTextAttachmentFallback[]
  documents?: readonly ModelDocumentAttachment[]
  modelCapabilities: ModelCapabilityMetadata
}): Record<string, unknown> {
  const documents = input.documents ?? []
  if (
    input.attachmentIds.length === 0 &&
    input.imageAttachments.length === 0 &&
    input.textFallbacks.length === 0 &&
    documents.length === 0
  ) return {}
  return {
    attachmentIds: [...input.attachmentIds],
    modelInputModalities: [...input.modelCapabilities.inputModalities],
    modelMessageParts: [...input.modelCapabilities.messageParts],
    imageAttachmentCount: input.imageAttachments.length,
    imageAttachmentBase64Bytes: input.imageAttachments.reduce(
      (total, attachment) => total + Buffer.byteLength(attachment.dataBase64, 'base64'),
      0
    ),
    imageAttachmentMimeTypes: [...new Set(input.imageAttachments.map((attachment) => attachment.mimeType))],
    textFallbackCount: input.textFallbacks.length,
    textFallbackBase64Bytes: input.textFallbacks.reduce(
      (total, attachment) => total + Buffer.byteLength(attachment.dataBase64, 'utf8'),
      0
    ),
    textFallbackMimeTypes: [...new Set(input.textFallbacks.map((attachment) => attachment.mimeType))],
    documentCount: documents.length,
    documentTextChars: documents.reduce((total, document) => total + document.text.length, 0),
    documentMimeTypes: [...new Set(documents.map((document) => document.mimeType))]
  }
}

export function imageGenerationReferenceInstructions(input: {
  imageAttachments: readonly ModelInputAttachment[]
  textFallbacks: readonly ModelTextAttachmentFallback[]
  workspace: string
  tools: readonly Pick<ModelToolSpec, 'name' | 'inputSchema'>[]
}): string[] {
  const generateImage = input.tools.find((tool) => tool.name === 'generate_image')
  if (!generateImage || !toolSchemaHasProperty(generateImage.inputSchema, 'reference_attachment_ids')) {
    return []
  }
  const references = [...input.imageAttachments, ...input.textFallbacks]
    .filter((attachment) => attachment.mimeType.startsWith('image/'))
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      path: workspaceRelativeAttachmentPath(attachment.localFilePath, input.workspace)
    }))
  if (references.length === 0) return []
  return [[
    'Image-to-image reference images are available for this turn:',
    ...references.map((reference) => [
      `- ${reference.name}: attachment ID ${reference.id}`,
      ...(reference.path ? [`; workspace path ${reference.path}`] : [])
    ].join('')),
    'For uploaded, pasted, or canvas-exported images without a workspace path, call `generate_image` with the matching ID(s) in `reference_attachment_ids`.',
    'For images that also have a workspace-relative path, you may instead use `reference_image_paths`. Do not copy temporary files into the workspace.'
  ].join('\n')]
}

function toolSchemaHasProperty(inputSchema: Record<string, unknown>, property: string): boolean {
  const properties = inputSchema.properties
  return Boolean(
    properties &&
    typeof properties === 'object' &&
    Object.prototype.hasOwnProperty.call(properties, property)
  )
}

function buildTextAttachmentFallback(
  attachment: AttachmentContent,
  maxBase64Bytes: number
): ModelTextAttachmentFallback {
  const fallback = attachment.textFallback
  if (fallback) {
    const fallbackBase64Bytes = Buffer.byteLength(fallback.dataBase64, 'utf8')
    if (fallbackBase64Bytes > maxBase64Bytes) {
      throw new Error(`attachment ${attachment.id} text fallback exceeds ${maxBase64Bytes} base64 byte limit`)
    }
    return {
      id: attachment.id,
      name: attachment.name,
      mimeType: fallback.mimeType,
      dataBase64: fallback.dataBase64,
      byteSize: fallback.byteSize,
      ...(fallback.width ? { width: fallback.width } : {}),
      ...(fallback.height ? { height: fallback.height } : {}),
      ...(attachment.localFilePath ? { localFilePath: attachment.localFilePath } : {}),
      ...(fallback.wasCompressed !== undefined ? { wasCompressed: fallback.wasCompressed } : {})
    }
  }
  const originalBase64 = attachment.data.toString('base64')
  if (Buffer.byteLength(originalBase64, 'utf8') > maxBase64Bytes) {
    throw new Error(
      `attachment ${attachment.id} is missing a compressed text fallback and original base64 exceeds ${maxBase64Bytes} byte limit`
    )
  }
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    dataBase64: originalBase64,
    byteSize: attachment.byteSize,
    ...(attachment.width ? { width: attachment.width } : {}),
    ...(attachment.height ? { height: attachment.height } : {}),
    ...(attachment.localFilePath ? { localFilePath: attachment.localFilePath } : {}),
    wasCompressed: false
  }
}

function workspaceRelativeAttachmentPath(
  localFilePath: string | undefined,
  workspace: string
): string | null {
  const workspaceRoot = workspace.trim()
  const rawPath = localFilePath?.trim()
  if (!workspaceRoot || !rawPath) return null
  const workspaceAbsolute = resolve(workspaceRoot)
  const fileAbsolute = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceAbsolute, rawPath)
  const relativePath = relative(workspaceAbsolute, fileAbsolute)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return null
  return relativePath.replace(/\\/g, '/')
}
