import { z } from 'zod'
import { MAX_BODY_BYTES, MAX_ID_LENGTH, MAX_PATH_LENGTH } from './common'

// Mirrors the runtime's 10 MiB decoded attachment allowance so oversized
// documents fail fast in the desktop bridge instead of at the HTTP server.
export const MAX_RUNTIME_DOCUMENT_SOURCE_BYTES = 10 * 1024 * 1024

function isAbsoluteDocumentPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

const visualPreviewSchema = z.strictObject({
  dataBase64: z.string().min(1).max(MAX_BODY_BYTES),
  mimeType: z.string().trim().min(3).max(128),
  byteSize: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  wasCompressed: z.boolean().optional()
})

export const runtimeDocumentAttachmentUploadPayloadSchema = z.strictObject({
  path: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PATH_LENGTH)
    .refine(isAbsoluteDocumentPath, 'document path must be absolute'),
  name: z.string().trim().min(1).max(512).optional(),
  mimeType: z.string().trim().min(3).max(128).optional(),
  documentText: z.string().max(MAX_BODY_BYTES).optional(),
  documentFormat: z
    .enum(['pdf', 'docx', 'xlsx', 'pptx', 'text', 'csv', 'json', 'xml'])
    .optional(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  pageCount: z.number().int().positive().optional(),
  visualPreview: visualPreviewSchema.optional(),
  threadId: z.string().trim().min(1).max(MAX_ID_LENGTH).optional(),
  workspace: z.string().trim().min(1).max(MAX_PATH_LENGTH).optional()
})
