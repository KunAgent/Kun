import type {
  CoreAttachmentMetadataJson,
  CoreAttachmentTextFallbackJson
} from '../agent/kun-contract'
import { getProvider } from '../agent/registry'
import type { AgentProvider, AttachmentReference } from '../agent/types'

export type RuntimeAttachmentUploadInput = {
  name: string
  mimeType?: string
  dataBase64: string
  documentText?: string
  documentFormat?: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'csv' | 'json' | 'xml'
  sourceSha256?: string
  pageCount?: number
  localFilePath?: string
  textFallback?: CoreAttachmentTextFallbackJson
  visualPreview?: CoreAttachmentTextFallbackJson
  threadId?: string
  workspace?: string
}

export function pastedTextAttachmentName(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `pasted-text-${timestamp}.txt`
}

function pastedTextPreview(text: string): string {
  return text.split(/\r?\n/u).map((line) => line.trim()).find(Boolean)?.slice(0, 240)
    ?? text.trim().slice(0, 240)
}

export async function uploadRuntimePastedText(input: {
  text: string
  threadId?: string
  workspace?: string
  now?: Date
}): Promise<AttachmentReference> {
  if (typeof window.kunGui?.uploadRuntimeDocumentAttachment !== 'function') {
    throw new Error('Runtime attachment upload is unavailable.')
  }
  const result = await window.kunGui.uploadRuntimeDocumentAttachment({
    temporaryText: input.text,
    name: pastedTextAttachmentName(input.now),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {})
  })
  if (!result.ok) throw new Error(result.message)
  return {
    id: result.attachment.id,
    kind: 'document',
    name: result.attachment.name,
    mimeType: result.attachment.mimeType,
    byteSize: result.attachment.byteSize,
    documentFormat: 'text',
    truncated: result.attachment.truncated,
    textPreview: pastedTextPreview(input.text)
  }
}

/**
 * Generic runtime attachment entry point. Image callers remain compatible
 * with the dedicated desktop image pipeline inside the provider, while
 * documents use the same authenticated attachment-store contract.
 */
export async function uploadRuntimeAttachment(
  input: RuntimeAttachmentUploadInput,
  provider: AgentProvider = getProvider()
): Promise<CoreAttachmentMetadataJson> {
  if (typeof provider.uploadAttachment !== 'function') {
    throw new Error('Runtime attachment upload is unavailable.')
  }
  return provider.uploadAttachment(input)
}
