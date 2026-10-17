import { z } from 'zod'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
export const SharedAttachmentId = z.string().regex(/^att_[a-f0-9]{24}$/)
const Hash = z.string().regex(/^[a-f0-9]{64}$/)
export const SHARED_FILE_MAX = 25 * 1024 * 1024
// eslint-disable-next-line no-control-regex -- shared file names reject ASCII controls
const Name = z.string().min(1).max(180).refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
// eslint-disable-next-line no-control-regex -- MIME types reject header-splitting controls
const Mime = z.string().min(1).max(120).refine((value) => !/[\r\n\u0000]/.test(value))
export const SharedReceiveParams = z.object({ transferId: z.string().uuid(), name: Name, mimeType: Mime,
  size: z.number().int().positive().max(SHARED_FILE_MAX), sha256: Hash }).strict()
export const SharedExportParams = z.union([
  z.object({ threadId: Id, attachmentId: SharedAttachmentId }).strict(),
  z.object({ threadId: Id, artifactId: Id }).strict()
])
export const SharedFileCallSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('attachment.receive'), requestId: Id, expiresAt: z.number().int().positive(), params: SharedReceiveParams }).strict(),
  z.object({ method: z.literal('attachment.export'), requestId: Id, expiresAt: z.number().int().positive(), params: SharedExportParams }).strict()
])
export const SharedFileListSchema = z.object({ resource: z.object({ kind: z.literal('code'), id: Id }).strict(),
  cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).optional() }).strict()
export const SharedExportResult = z.object({ transferId: z.string().uuid(), name: Name, mimeType: Mime,
  size: z.number().int().positive().max(SHARED_FILE_MAX), sha256: Hash }).strict()
export type SharedFileEntry = { resource: { kind: 'code'; id: string }; threadId: string; id: string; name: string;
  size: number; mimeType: string; available: boolean; attachmentId?: string }
export type SharedAttachmentProof = { ownerAccountId: string; hostDeviceId: string; shareId: string; resourceHandle: string;
  memberId: string; guestAccountId: string; memberVersion: number; shareVersion: number; sourceDeviceId: string;
  threadId: string; attachmentId: string; receiptId: string; confirmedAt: number; name?: string }
