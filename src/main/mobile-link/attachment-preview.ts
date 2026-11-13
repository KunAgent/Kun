import { createHash } from 'node:crypto'
import { nativeImage } from 'electron'
import { ATTACHMENT_PREVIEW_LIMITS, validateAttachmentPreviewParams, type AttachmentPreview } from '@kun/remote-protocol'
import type { LinkDependencies } from './service-dependencies'
import { runtimeExportSource } from './export-source'
import { readFileBody } from './file-body'

/** Use the same thread-membership checked source as an original export, without creating a transfer or receipt. */
export const previewAttachment: NonNullable<LinkDependencies['files']> = async (scope, call): Promise<AttachmentPreview> => {
  const params = validateAttachmentPreviewParams('attachment.preview', call.params)
  const lease = await scope.lease()
  if (!scope.current()) throw Error('ACCOUNT_CHANGED')
  if (!lease.baseUrl) throw Error('RUNTIME_UNAVAILABLE')
  const source = runtimeExportSource(params, scope, lease.runtimeToken)
  const response = await fetch(lease.baseUrl + source.path, {
    headers: source.headers, signal: AbortSignal.timeout(30000)
  })
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw Error('FILE_NOT_ALLOWED') }
  if (!scope.current()) { await response.body?.cancel().catch(() => {}); throw Error('ACCOUNT_CHANGED') }
  const result: AttachmentPreview = {
    attachmentId: params.attachmentId,
    name: (decodeURIComponent(response.headers.get('X-Kun-File-Name') ?? 'attachment') || 'attachment').slice(0, 180),
    mimeType: (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream').slice(0, 120),
    thumbnail: null
  }
  if (!result.mimeType.startsWith('image/')) {
    await response.body?.cancel().catch(() => {})
    return result
  }
  const bytes = await readFileBody(response, 25 * 1024 * 1024)
  if (!scope.current()) throw Error('ACCOUNT_CHANGED')
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) return result
  const size = image.getSize(), scale = Math.min(1, ATTACHMENT_PREVIEW_LIMITS.edge / Math.max(size.width, size.height))
  const width = Math.max(1, Math.round(size.width * scale)), height = Math.max(1, Math.round(size.height * scale))
  const resized = image.resize({ width, height, quality: 'good' })
  let data = resized.toPNG(), mimeType: 'image/png' | 'image/jpeg' = 'image/png'
  // Preserve alpha where it fits; photograph thumbnails have a bounded JPEG fallback.
  for (const quality of [75, 55, 35]) {
    if (data.length <= ATTACHMENT_PREVIEW_LIMITS.bytes) break
    data = resized.toJPEG(quality); mimeType = 'image/jpeg'
  }
  if (!scope.current()) throw Error('ACCOUNT_CHANGED')
  if (!data.length || data.length > ATTACHMENT_PREVIEW_LIMITS.bytes) return result
  result.thumbnail = { width, height, mimeType, size: data.length,
    sha256: createHash('sha256').update(data).digest('hex'), dataBase64: data.toString('base64') }
  return result
}
