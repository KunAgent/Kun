import { z } from 'zod'

/** Populated by the room coordinator, never accepted from a public thread request. */
export const RoomThreadContextSchema = z.object({
  requestId: z.string().min(1).max(128).optional(),
  roomId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  memberId: z.string().min(1),
  kind: z.enum(['coordination', 'discussion', 'execution', 'review']),
  allowedToolNames: z.array(z.string()).optional(),
  blockedToolNames: z.array(z.string()).default([]),
  blockedProviderIds: z.array(z.string()).default([]),
  blockedSkillIds: z.array(z.string()).default([]),
  skillsEnabled: z.boolean().optional()
}).strict()
