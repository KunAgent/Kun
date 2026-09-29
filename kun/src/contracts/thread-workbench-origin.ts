import { z } from 'zod'

/**
 * Host-written provenance for a Code or Work thread that a bot Agent started
 * on the user's behalf. Never accepted from a public thread request; it only
 * marks the thread so the sidebar can say where it came from.
 */
export const ThreadWorkbenchOriginSchema = z.object({
  kind: z.literal('bot'),
  roomId: z.string().min(1).max(128),
  linkId: z.string().min(1).max(128),
  agentId: z.string().min(1).max(128),
  agentName: z.string().max(120).default(''),
  /** Card message in the bot conversation that tracks this task. */
  messageId: z.string().min(1).max(256).optional()
}).strict()
export type ThreadWorkbenchOrigin = z.infer<typeof ThreadWorkbenchOriginSchema>
