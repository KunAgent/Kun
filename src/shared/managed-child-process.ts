import { z } from 'zod'

export const ManagedChildCleanupPolicy = z.enum([
  'terminate',
  'terminate-tree',
  'preserve'
])
export type ManagedChildCleanupPolicy = z.infer<typeof ManagedChildCleanupPolicy>

/** Cross-module identity and lifecycle metadata for a real child process. */
export const ManagedChildProcessSchema = z.object({
  id: z.string().min(1).max(128),
  ownerKind: z.string().min(1).max(64),
  ownerId: z.string().min(1).max(128),
  pid: z.number().int().positive().safe(),
  startedAt: z.string().datetime({ offset: true }),
  detached: z.boolean(),
  cleanupPolicy: ManagedChildCleanupPolicy.default('terminate-tree')
}).strict()

export type ManagedChildProcess = z.infer<typeof ManagedChildProcessSchema>
