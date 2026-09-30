import { z } from 'zod'
import { id, pageToken, query, scopes, type GoogleWorkspaceMethod } from './catalog-types.js'

const file = { fileId: id }
const fields = 'id,name,mimeType,size,modifiedTime,webViewLink,description,parents,capabilities(canDownload)'
export const GOOGLE_WORKSPACE_EXPORT_MIME_TYPES = ['text/plain', 'text/csv', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] as const
export const driveMethods: GoogleWorkspaceMethod[] = [
  {
    method: 'drive.files.list', description: 'Search Drive metadata with q; Docs and Sheets can be read via files.export. One bounded page; no writes or permission changes.',
    service: 'drive', risk: 'read', scopes: scopes.driveRead,
    params: z.object({ q: query.optional(), pageSize: z.number().int().min(1).max(100).default(25), pageToken: pageToken.optional(), orderBy: z.enum(['name', 'modifiedTime desc', 'createdTime desc']).optional() }).strict(),
    transform: (params) => ({ params: { ...params, fields: `nextPageToken,files(${fields})`, spaces: 'drive' } })
  },
  {
    method: 'drive.files.get', description: 'Read metadata for one Drive file. No arbitrary alt, fields or output path.',
    service: 'drive', risk: 'read', scopes: scopes.driveRead, params: z.object(file).strict(),
    transform: (params) => ({ params: { ...params, fields } })
  },
  {
    method: 'drive.files.download', description: 'Download one ordinary Drive file (at most 2 MiB) as base64 or a complete stored artifact. No persistent output path. JSON media is unsupported by the pinned CLI. Use export for Docs/Sheets.',
    service: 'drive', risk: 'read', scopes: scopes.driveRead, params: z.object(file).strict(),
    command: ['drive', 'files', 'get'], responseFormat: 'media', transform: (params) => ({ params: { ...params, alt: 'media' } })
  },
  {
    method: 'drive.files.export', description: 'Export Docs/Sheets read-only as text/plain, text/csv, PDF, DOCX or XLSX (at most 2 MiB). Text is decoded; large exports are stored as complete artifacts. No persistent output path.',
    service: 'drive', risk: 'read', scopes: scopes.driveRead,
    params: z.object({ ...file, mimeType: z.enum(GOOGLE_WORKSPACE_EXPORT_MIME_TYPES) }).strict(), responseFormat: 'media'
  }
]
