import { z } from 'zod'

/** Durable receipt for a background result, separate from admission/execution. */
export const RoomResultInboxSchema = z.object({
  id: z.string(), roomId: z.string(), participantAgentId: z.string(),
  rootRequestId: z.string(), requestId: z.string(), threadId: z.string(), sourceTurnId: z.string(),
  kind: z.enum(['background_subagent', 'background_shell', 'workbench_task']),
  prompt: z.string(), fingerprint: z.string(),
  status: z.enum(['pending', 'admitted', 'completed', 'failed', 'revoked']),
  receivedAt: z.string().datetime(), updatedAt: z.string().datetime(),
  turnId: z.string().optional(), reason: z.string().optional()
}).strict()
export type RoomResultInbox = z.infer<typeof RoomResultInboxSchema>
