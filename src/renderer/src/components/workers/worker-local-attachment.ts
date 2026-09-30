import type { AttachmentReference } from '../../agent/types'
import { runtimeImagePreviewUrl, runtimeImageSourceForFile, uploadRuntimeImageAttachment } from '../../lib/runtime-image-attachment'

const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'json', 'xml'
])

/** Use the existing authenticated attachment bridge with the worker ID. */
export async function uploadWorkerLocalAttachment(
  file: File,
  workerId: string
): Promise<AttachmentReference> {
  const localPath = window.kunGui?.getPathForFile?.(file)?.trim() ?? ''
  if (file.type.startsWith('image/')) {
    const result = await uploadRuntimeImageAttachment({
      source: await runtimeImageSourceForFile(file, localPath),
      name: file.name,
      threadId: workerId
    })
    return {
      id: result.attachment.id,
      kind: 'image',
      name: result.attachment.name,
      mimeType: result.attachment.mimeType,
      width: result.attachment.width,
      height: result.attachment.height,
      previewUrl: runtimeImagePreviewUrl(result)
    }
  }
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
  if (!DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error('This attachment type is not supported.')
  }
  const upload = window.kunGui?.uploadRuntimeDocumentAttachment
  if (!upload) throw new Error('Document attachment upload is unavailable.')
  if (!localPath && !['txt', 'md', 'csv', 'json', 'xml'].includes(extension)) {
    throw new Error('This document needs a local file path to upload.')
  }
  const result = await upload(localPath
    ? { path: localPath, name: file.name, mimeType: file.type || undefined, threadId: workerId }
    : { temporaryText: await file.text(), name: file.name, threadId: workerId })
  if (!result.ok) throw new Error(result.message)
  return {
    id: result.attachment.id,
    kind: 'document',
    name: result.attachment.name,
    mimeType: result.attachment.mimeType,
    byteSize: result.attachment.byteSize,
    documentFormat: result.attachment.documentFormat,
    truncated: result.attachment.truncated
  }
}
