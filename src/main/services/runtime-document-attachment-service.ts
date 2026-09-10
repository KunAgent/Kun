import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { RuntimeRequestResult } from '../../shared/kun-gui-api'
import type {
  RuntimeDocumentAttachmentUploadRequest,
  RuntimeDocumentAttachmentUploadResult
} from '../../shared/runtime-document-attachment'
import { MAX_RUNTIME_DOCUMENT_SOURCE_BYTES } from '../ipc/app-ipc-schemas/runtime-document-attachment'
import { CLIPBOARD_TEMP_DIR } from './workspace-file-core'
import {
  attachmentUploadResponseSchema,
  runtimeResponseError
} from './runtime-image-attachment-service'

type RuntimeRequest = (
  path: string,
  method?: string,
  body?: string,
  headers?: Record<string, string>
) => Promise<RuntimeRequestResult>

/**
 * Document counterpart of the image attachment pipeline: bytes are read from
 * the local path in the main process and forwarded over HTTP, keeping large
 * base64 payloads out of the renderer's size-capped `runtime:request` IPC.
 */
export async function uploadRuntimeDocumentAttachment(
  request: RuntimeDocumentAttachmentUploadRequest,
  dependencies: { runtimeRequest: RuntimeRequest }
): Promise<RuntimeDocumentAttachmentUploadResult> {
  let temporaryPath: string | null = null
  try {
    const temporaryText = 'temporaryText' in request ? request.temporaryText : undefined
    const temporary = typeof temporaryText === 'string'
    if (temporaryText !== undefined) {
      const data = Buffer.from(temporaryText, 'utf8')
      if (data.byteLength <= 0) throw new Error('Document source is empty.')
      if (data.byteLength > MAX_RUNTIME_DOCUMENT_SOURCE_BYTES) {
        throw new Error(`Document source exceeds the ${MAX_RUNTIME_DOCUMENT_SOURCE_BYTES} byte limit.`)
      }
      await mkdir(CLIPBOARD_TEMP_DIR, { recursive: true, mode: 0o700 })
      temporaryPath = join(CLIPBOARD_TEMP_DIR, `pasted-text-${Date.now()}-${randomUUID()}.txt`)
      await writeFile(temporaryPath, data, { mode: 0o600 })
    }
    const sourcePath = temporaryPath ?? ('path' in request && request.path ? request.path : '')
    const info = await stat(sourcePath)
    if (!info.isFile()) throw new Error('Document source path is not a file.')
    if (info.size <= 0) throw new Error('Document source is empty.')
    if (info.size > MAX_RUNTIME_DOCUMENT_SOURCE_BYTES) {
      throw new Error(`Document source exceeds the ${MAX_RUNTIME_DOCUMENT_SOURCE_BYTES} byte limit.`)
    }
    const data = await readFile(sourcePath)
    const response = await dependencies.runtimeRequest(
      '/v1/attachments',
      'POST',
      JSON.stringify({
        name: request.name?.trim() || basename(sourcePath) || 'document',
        ...(temporary ? { mimeType: 'text/plain', documentFormat: 'text' } : request.mimeType ? { mimeType: request.mimeType } : {}),
        dataBase64: data.toString('base64'),
        ...(!temporary && request.documentText ? { documentText: request.documentText } : {}),
        ...(!temporary && request.documentFormat ? { documentFormat: request.documentFormat } : {}),
        ...(request.sourceSha256 ? { sourceSha256: request.sourceSha256 } : {}),
        ...(request.pageCount ? { pageCount: request.pageCount } : {}),
        ...(!temporary ? { localFilePath: sourcePath } : {}),
        ...(request.visualPreview ? { visualPreview: request.visualPreview } : {}),
        ...(request.threadId ? { threadId: request.threadId } : {}),
        ...(request.workspace ? { workspace: request.workspace } : {})
      })
    )
    if (!response.ok) throw new Error(runtimeResponseError(response, 'attachment upload failed'))
    const parsed = attachmentUploadResponseSchema.parse(JSON.parse(response.body))
    return { ok: true, attachment: parsed.attachment }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
