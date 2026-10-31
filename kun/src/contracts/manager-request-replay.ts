import { z } from 'zod'

export const MANAGER_MUTATION_REPLAY_CAPABILITY = 'mutation-replay-v1'
export const MANAGER_MUTATION_REPLAY_MAX_WINDOW_MS = 120_000
export const ManagerMutationReplaySchema = z.object({
  requestId: z.string().uuid(),
  managerInstanceId: z.string().min(1).max(256),
  expiresAt: z.number().int().positive()
}).strict()
export type ManagerMutationReplay = z.infer<typeof ManagerMutationReplaySchema>
