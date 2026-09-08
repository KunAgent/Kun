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
 * Local documents are read by the main process. Pasted text is materialized
 * there as a short-lived file so neither form crosses the generic runtime IPC
 * body as renderer-created base64.
 */
type RuntimeDocumentAttachmentUploadBase = {
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

export type RuntimeDocumentAttachmentUploadRequest = RuntimeDocumentAttachmentUploadBase & (
  | { path: string; temporaryText?: never }
  | { temporaryText: string; path?: never }
)

export type RuntimeDocumentAttachmentUploadResult =
  | { ok: true; attachment: RuntimeImageAttachmentMetadata }
  | { ok: false; message: string }
