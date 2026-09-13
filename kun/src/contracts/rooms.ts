import { z } from 'zod'

export const RoomIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
const Revision = z.number().int().nonnegative()
const Timestamp = z.string().datetime({ offset: true })
const UniqueIds = z.array(RoomIdSchema).max(100).refine(
  (ids) => new Set(ids).size === ids.length, 'duplicate identifiers'
)

export const RoomMemberSchema = z.object({
  id: RoomIdSchema,
  displayName: z.string().trim().min(1).max(80),
  presetId: z.string().min(1).max(256),
  role: z.enum(['coordinator', 'developer', 'reviewer', 'diagnostician']),
  roleNotes: z.string().max(8000).default(''),
  enabled: z.boolean().default(true),
  removedAt: Timestamp.optional(),
  defaultRepositoryId: RoomIdSchema.optional(),
  allowedRepositoryIds: UniqueIds.default([]),
  revision: Revision,
  modelRef: z.object({
    providerId: z.string().min(1).max(256),
    model: z.string().min(1).max(256),
    accountId: z.string().min(1).max(256).optional()
  }).strict().optional(),
  capabilityOverrides: z.object({
    allowedTools: z.array(z.string().min(1).max(256)).max(256).optional(),
    blockedTools: z.array(z.string().min(1).max(256)).max(256).default([]),
    blockedMcpServers: z.array(z.string().min(1).max(256)).max(100).default([]),
    blockedSkills: z.array(z.string().min(1).max(256)).max(100).default([]),
    skillsEnabled: z.boolean().optional()
  }).strict().optional(),
  reviewPolicy: z.object({
    reviewerMemberId: RoomIdSchema,
    allowAutomaticRework: z.boolean().default(false),
    maxReworkRounds: z.number().int().min(0).max(2).default(2)
  }).strict().optional()
}).strict()
export type RoomMember = z.infer<typeof RoomMemberSchema>

export const RoomRepositorySchema = z.object({
  id: RoomIdSchema,
  displayName: z.string().trim().min(1).max(120),
  displayPath: z.string().min(1).max(4096),
  canonicalRoot: z.string().min(1).max(4096),
  gitCommonDir: z.string().min(1).max(4096),
  defaultBaseRef: z.string().min(1).max(256).optional(),
  availability: z.enum(['available', 'missing', 'unverified'])
}).strict()
export type RoomRepository = z.infer<typeof RoomRepositorySchema>

export const RoomSchema = z.object({
  schemaVersion: z.literal(1),
  id: RoomIdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(8000).default(''),
  collaborationMode: z.enum(['autonomous', 'directed', 'peer']).default('autonomous'),
  maxDiscussionRounds: z.number().int().min(1).max(3).default(3),
  maxConcurrentTasks: z.number().int().min(1).max(2).default(2),
  pinned: z.boolean().default(false),
  archivedAt: Timestamp.optional(),
  defaultMemberId: RoomIdSchema,
  members: z.array(RoomMemberSchema).min(1).max(100),
  repositories: z.array(RoomRepositorySchema).max(100),
  revision: Revision,
  createdAt: Timestamp,
  updatedAt: Timestamp
}).strict().superRefine((room, ctx) => {
  const issue = (message: string): void => ctx.addIssue({ code: 'custom', message })
  const members = new Set(room.members.map((member) => member.id))
  const repositories = new Set(room.repositories.map((repository) => repository.id))
  if (members.size !== room.members.length) issue('duplicate member identifiers')
  if (repositories.size !== room.repositories.length) issue('duplicate repository identifiers')
  const active = (id: string): boolean => room.members.some(
    (member) => member.id === id && member.enabled && !member.removedAt
  )
  if (!active(room.defaultMemberId)) issue('default member must be enabled')
  for (const member of room.members) {
    if (member.allowedRepositoryIds.some((id) => !repositories.has(id))) {
      issue('member references an unknown repository')
    }
    if (member.defaultRepositoryId && !member.allowedRepositoryIds.includes(member.defaultRepositoryId)) {
      issue('default repository must be explicitly allowed')
    }
    if (member.reviewPolicy && (!active(member.reviewPolicy.reviewerMemberId) ||
      member.reviewPolicy.reviewerMemberId === member.id)) {
      issue('reviewer must be a different enabled member')
    }
  }
})
export type Room = z.infer<typeof RoomSchema>

export const SendRoomMessageSchema = z.object({
  clientRequestId: RoomIdSchema,
  rootRequestId: RoomIdSchema.optional(),
  executionIntent: z.enum(['auto', 'discussion', 'execute']).default('auto'),
  body: z.string().max(64000),
  mentionMemberIds: UniqueIds.default([]),
  replyToMessageId: RoomIdSchema.optional(),
  taskId: RoomIdSchema.optional(),
  repositoryId: RoomIdSchema.optional(),
  attachmentIds: z.array(z.string().min(1).max(256)).max(20).default([])
}).strict().refine((value) => value.body.trim().length > 0 || value.attachmentIds.length > 0,
  'message requires text or an attachment')
export type SendRoomMessage = z.infer<typeof SendRoomMessageSchema>

export const RoomMessageSchema = z.object({
  id: RoomIdSchema,
  roomId: RoomIdSchema,
  rootRequestId: RoomIdSchema.optional(),
  sourceRequestId: RoomIdSchema.optional(),
  originRunId: RoomIdSchema.optional(),
  status: z.enum(['streaming', 'final', 'failed']).optional(),
  messageSeq: z.number().int().positive(),
  authorKind: z.enum(['user', 'member', 'system']),
  authorMemberId: RoomIdSchema.optional(),
  authorLabelSnapshot: z.string().max(120),
  body: z.string().max(64000),
  bodyRevision: Revision,
  mentionMemberIds: UniqueIds,
  replyToMessageId: RoomIdSchema.optional(),
  taskId: RoomIdSchema.optional(),
  attachmentIds: z.array(z.string().min(1).max(256)).max(20),
  clientRequestId: RoomIdSchema.optional(),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  createdAt: Timestamp
}).strict()
export type RoomMessage = z.infer<typeof RoomMessageSchema>
