import type {
  RuntimeImageAttachmentMetadata,
  RuntimeImageAttachmentTextFallback
} from './runtime-image-attachment'

export type RuntimeDocumentFormat =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'text'
  | 'csv'
  | 'json'
  | 'xml'

/**
 * Document uploads always carry a local absolute path: the main process reads
 * the bytes and forwards them to the runtime over HTTP directly, so large
 * PDF/Office files never travel through the size-capped `runtime:request`
 * IPC body as inline base64.
 */
export type RuntimeDocumentAttachmentUploadRequest = {
  path: string
  name?: string
  mimeType?: string
  documentText?: string
  documentFormat?: RuntimeDocumentFormat
  sourceSha256?: string
  pageCount?: number
  visualPreview?: RuntimeImageAttachmentTextFallback
  threadId?: string
  workspace?: string
}

export type RuntimeDocumentAttachmentUploadResult =
  | { ok: true; attachment: RuntimeImageAttachmentMetadata }
  | { ok: false; message: string }
