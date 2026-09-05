import type { CoreAttachmentMetadataJson } from './kun-contract'
import type { RuntimeAttachmentUploadInput } from '../lib/runtime-attachment'

export async function uploadAttachmentViaDesktop(
  input: RuntimeAttachmentUploadInput
): Promise<CoreAttachmentMetadataJson | null> {
  if (
    input.mimeType?.startsWith('image/') &&
    typeof window.kunGui?.uploadRuntimeImageAttachment === 'function'
  ) {
    const result = await window.kunGui.uploadRuntimeImageAttachment({
      source: input.localFilePath
        ? { kind: 'localPath', path: input.localFilePath }
        : { kind: 'base64', dataBase64: input.dataBase64, mimeType: input.mimeType },
      name: input.name,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {})
    })
    if (!result.ok) throw new Error(result.message)
    return result.attachment
  }
  // Documents with a local path upload through the desktop bridge: the main
  // process reads the bytes and forwards them over HTTP, keeping large
  // base64 payloads out of the size-capped `runtime:request` IPC body.
  if (
    input.localFilePath &&
    typeof window.kunGui?.uploadRuntimeDocumentAttachment === 'function'
  ) {
    const result = await window.kunGui.uploadRuntimeDocumentAttachment({
      path: input.localFilePath,
      name: input.name,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.documentText ? { documentText: input.documentText } : {}),
      ...(input.documentFormat ? { documentFormat: input.documentFormat } : {}),
      ...(input.sourceSha256 ? { sourceSha256: input.sourceSha256 } : {}),
      ...(input.pageCount ? { pageCount: input.pageCount } : {}),
      ...(input.visualPreview ? { visualPreview: input.visualPreview } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {})
    })
    if (!result.ok) throw new Error(result.message)
    return result.attachment
  }
  return null
}
