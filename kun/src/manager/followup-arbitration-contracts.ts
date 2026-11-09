import { z } from 'zod'
import { ManagerResourceFenceSchema } from './resource-lease-state.js'

export const FollowUpArbitrationFenceSchema = z.object({
  fence: ManagerResourceFenceSchema, commitId: z.string().min(1).max(256)
}).strict()
export type FollowUpArbitrationFence = z.infer<typeof FollowUpArbitrationFenceSchema>
