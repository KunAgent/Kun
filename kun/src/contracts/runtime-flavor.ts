import { z } from 'zod'
import { RuntimeBuildIdSchema } from './runtime-info.js'
import { RuntimeClientOwnerKindSchema } from './runtime-owner.js'

export const RuntimeFlavorSchema = z.enum(['production', 'development'])
export type RuntimeFlavor = z.infer<typeof RuntimeFlavorSchema>

export const RuntimeRegistrationSchema = z.object({
  flavor: RuntimeFlavorSchema,
  instanceId: z.string().min(1).max(256),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65_535),
  baseUrl: z.string().url().max(2_048),
  runtimeToken: z.string().max(16_384),
  clientOwnerKind: RuntimeClientOwnerKindSchema.optional(),
  buildId: RuntimeBuildIdSchema.optional(),
  logPath: z.string().min(1).max(4_096).optional()
})
export type RuntimeRegistration = z.infer<typeof RuntimeRegistrationSchema>

export const ThreadExecutionLeaseSchema = z.object({
  threadId: z.string().min(1).max(256),
  turnId: z.string().min(1).max(256),
  ownerFlavor: RuntimeFlavorSchema,
  ownerInstanceId: z.string().min(1).max(256),
  fencingToken: z.number().int().positive(),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime()
})
export type ThreadExecutionLease = z.infer<typeof ThreadExecutionLeaseSchema>

export const TurnMutationFenceSchema = ThreadExecutionLeaseSchema.pick({
  threadId: true,
  turnId: true,
  ownerFlavor: true,
  ownerInstanceId: true,
  fencingToken: true
}).strict()
export type TurnMutationFence = z.infer<typeof TurnMutationFenceSchema>

export type RevisionedSnapshot<T> = {
  revision: number
  value: T
}
