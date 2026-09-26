import { z } from 'zod'
import { ParticipantAgentId, type AgentIdentity } from './agent-identities.js'
import { RoomAvatarReferenceSchema } from './room-content.js'

export const OnboardingRequest = z.object({
  clientRequestId: ParticipantAgentId,
  expectedRevision: z.number().int().nonnegative().nullable(),
  action: z.enum(['initialize', 'complete', 'dismiss', 'seen']),
  selections: z.array(z.object({ templateId: z.string().min(1).max(80),
    agentId: ParticipantAgentId.nullable(), revision: z.number().int().nonnegative().optional() }).strict()).length(5).optional()
}).strict()
export type OnboardingState = {
  completed: boolean; dismissed: boolean; seen: boolean; revision: number | null; fresh: boolean
  slots: Array<{ templateId: string; name: string; title: string; agent?: AgentIdentity }>
  bindings?: Record<string, string>; groupId?: string; coordinatorRoomId?: string
}
export const RoomUserProfileSchema = z.object({ avatar: RoomAvatarReferenceSchema.nullable().default(null) }).strict()
export type RoomUserProfile = z.infer<typeof RoomUserProfileSchema>
export type RoomUserProfileDetail = { profile: RoomUserProfile; revision: number | null }
export const UpdateRoomUserProfile = RoomUserProfileSchema.extend({
  clientRequestId: ParticipantAgentId, expectedRevision: z.number().int().nonnegative().nullable()
}).strict()
