import { z } from 'zod'
import { RoomAvatarReferenceSchema } from './room-content.js'

export const ParticipantAgentId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
export const ConversationKind = z.enum(['group', 'user_agent', 'agent_agent'])
export const AgentRole = z.enum(['coordinator', 'developer', 'reviewer', 'diagnostician'])
export const AgentModelRef = z.object({
  providerId: z.string().min(1).max(256), model: z.string().min(1).max(256),
  accountId: z.string().min(1).max(256).optional()
}).strict()
export const AgentCapabilityOverrides = z.object({
  allowedTools: z.array(z.string().min(1).max(256)).max(256).optional(),
  blockedTools: z.array(z.string().min(1).max(256)).max(256).default([]),
  blockedMcpServers: z.array(z.string().min(1).max(256)).max(100).default([]),
  blockedSkills: z.array(z.string().min(1).max(256)).max(100).default([]),
  skillsEnabled: z.boolean().optional()
}).strict()
export const AgentMemorySettings = z.object({
  readEnabled: z.boolean().default(true), captureEnabled: z.boolean().default(true)
}).strict()
const fields = {
  templateId: z.string().min(1).max(80).optional(),
  templateVersion: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().max(160).default(''),
  instructions: z.string().max(8000).default(''),
  defaultRole: AgentRole.default('developer'),
  presetId: z.string().min(1).max(256).default('general'),
  avatar: RoomAvatarReferenceSchema.optional(),
  modelRef: AgentModelRef.optional(),
  capabilityOverrides: AgentCapabilityOverrides.optional(),
  allowedRepositoryRoots: z.array(z.string().min(1).max(4096)).max(100).optional(),
  reviewerAgentId: ParticipantAgentId.optional(),
  memory: AgentMemorySettings.default({ readEnabled: true, captureEnabled: true })
}
export const AgentIdentitySchema = z.object({
  schemaVersion: z.literal(1), id: ParticipantAgentId, ...fields,
  revision: z.number().int().nonnegative(), createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(), archivedAt: z.string().datetime().optional(),
  migratedFrom: z.object({ roomId: ParticipantAgentId, memberId: ParticipantAgentId,
    roomName: z.string().max(120) }).strict().optional()
}).strict()
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>
export const CreateAgentRequest = z.object({
  clientRequestId: ParticipantAgentId, ...fields,
  copyFromAgentId: ParticipantAgentId.optional()
}).strict()
export const UpdateAgentRequest = z.object({
  ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.optional()])) as {
    [K in keyof typeof fields]: z.ZodOptional<(typeof fields)[K]>
  },
  expectedRevision: z.number().int().nonnegative(), clientRequestId: ParticipantAgentId,
  archived: z.boolean().optional(),
  modelRef: AgentModelRef.nullable().optional(), avatar: RoomAvatarReferenceSchema.nullable().optional(),
  capabilityOverrides: AgentCapabilityOverrides.nullable().optional(),
  allowedRepositoryRoots: z.array(z.string().min(1).max(4096)).max(100).nullable().optional(),
  reviewerAgentId: ParticipantAgentId.nullable().optional()
}).strict()
export const AgentPageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.coerce.number().int().nonnegative().optional(),
  search: z.string().trim().max(200).optional(),
  archivedOnly: z.boolean().default(false)
}).strict()
export type AgentActivity = { conversationId?: string; unread: boolean;
  runs: Array<{ id: string; roomId: string; phase: string; status: string }> }
export type AgentPage = { agents: AgentIdentity[]; nextCursor?: string; activities?: Record<string, AgentActivity> }
export const AgentFeaturesSchema = z.object({
  identities: z.boolean().default(true), memory: z.boolean().default(true),
  collaboration: z.boolean().default(true)
}).strict()
export type AgentFeatures = z.infer<typeof AgentFeaturesSchema>
