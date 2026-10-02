import { z } from 'zod'

const Id = z.string().min(1).max(256)
const titleSnapshot = z.string().max(300).optional()
const relativePath = z.string().min(1).max(4096).refine((value) => !value.startsWith('/') &&
  !value.includes('\\') && !value.includes('\0') && !/^[A-Za-z]:/.test(value) &&
  !value.split('/').some((part) => !part || part === '.' || part === '..'), 'relative repository path required')

export const RoomContentReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent_file'), workspaceId: Id, relativePath, titleSnapshot, artifactId: Id.optional(), artifactVersion: z.number().int().positive().optional() }).strict(),
  z.object({ kind: z.literal('attachment'), attachmentId: Id, titleSnapshot }).strict(),
  z.object({ kind: z.literal('repository_file'), repositoryId: Id, relativePath, titleSnapshot }).strict(),
  z.object({ kind: z.literal('task'), taskId: Id, titleSnapshot }).strict(),
  z.object({ kind: z.literal('delivery'), taskId: Id, deliveryId: Id, titleSnapshot }).strict(),
  z.object({ kind: z.literal('board_card'), repositoryId: Id, cardId: Id, titleSnapshot }).strict(),
  /** One of the user's Code sessions, referenced from Code ("send to bot") or by an Agent that read it. */
  z.object({ kind: z.literal('code_thread'), threadId: Id, turnId: Id.optional(), titleSnapshot }).strict(),
  /** A document inside a registered Work workspace. */
  z.object({ kind: z.literal('work_document'), workspaceRoot: z.string().min(1).max(4096), relativePath, titleSnapshot }).strict()
])
export type RoomContentReference = z.infer<typeof RoomContentReferenceSchema>

export const ROOM_BUILTIN_AVATAR_IDS = ['coordinator', 'coder', 'reviewer', 'detective', 'designer', 'architect',
  'scientist', 'security', 'writer', 'researcher', 'data', 'operations', 'astronaut', 'pilot', 'navigator',
  'librarian', 'musician', 'gardener', 'chef', 'medic', 'photographer', 'athlete', 'explorer', 'storyteller',
  'magician', 'night-thinker', 'barista', 'maker', 'courier', 'strategist'] as const
export const RoomAvatarReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), id: z.enum(ROOM_BUILTIN_AVATAR_IDS) }).strict(),
  z.object({ kind: z.literal('uploaded'), attachmentId: z.string().regex(/^att_[a-f0-9]{24}$/) }).strict()
])
export type RoomAvatarReference = z.infer<typeof RoomAvatarReferenceSchema>
export const RoomAvatarAssetSchema = z.object({
  attachmentId: z.string().regex(/^att_[a-f0-9]{24}$/), hash: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.literal('image/jpeg'), width: z.literal(128), height: z.literal(128),
  byteSize: z.number().int().positive().max(192 * 1024), createdAt: z.string().datetime()
}).strict()
export type RoomAvatarAsset = z.infer<typeof RoomAvatarAssetSchema>
export type RoomPreviewImage = { dataBase64: string; mimeType: string; width: number; height: number }
export type RoomContentOpenTarget =
  | { kind: 'code_file' | 'work_file'; workspaceRoot: string; relativePath: string }
  | { kind: 'thread'; threadId: string; turnId?: string }
  | { kind: 'board'; workspaceRoot: string; cardId: string }
  | { kind: 'excalidraw_board'; workspaceRoot: string; boardId: string }
/** A validated source in the current personal Agent conversation, never a raw thread redirect. */
export type RoomArtifactSourceTarget = {
  roomId: string
  participantAgentId: string
  runId: string
  messageId?: string
}
export type RoomContentResult = {
  reference: RoomContentReference
  state: 'available' | 'unavailable'
  reason?: string
  title: string
  kind?: 'image' | 'file' | 'audio' | 'video' | 'task' | 'delivery' | 'board_card' | 'code_thread' | 'work_document'
  description?: string
  mimeType?: string
  byteSize?: number
  width?: number
  height?: number
  status?: string
  version?: string
  thumbnail?: RoomPreviewImage
  preview?: { type: 'text'; text: string; truncated: boolean } | { type: 'image'; image: RoomPreviewImage } |
    { type: 'media'; dataBase64: string; mimeType: string }
  sourceTarget?: RoomArtifactSourceTarget
  openTarget?: RoomContentOpenTarget
}
export type RoomLinkPreview = {
  state: 'available' | 'unavailable' | 'none'
  url?: string
  title?: string
  description?: string
  siteName?: string
  hasImage?: boolean
  reason?: string
}
