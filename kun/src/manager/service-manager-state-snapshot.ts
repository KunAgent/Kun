import { z } from 'zod'
export { FENCE_FLOOR_KEY } from './service-manager-state-fence-floor.js'
import {
  RuntimeRegistrationSchema,
  ThreadExecutionLeaseSchema
} from '../contracts/runtime-flavor.js'
import {
  LegacyManagerResourceLeaseSchema,
  ManagerResourceLeaseSchema
} from './resource-lease-state.js'

const LegacyThreadExecutionLeaseSchema = ThreadExecutionLeaseSchema.omit({
  fencingToken: true
}).strict()

const RuntimeSlotSnapshotField = {
  slots: z.array(z.object({
    registration: RuntimeRegistrationSchema,
    lastHeartbeatAt: z.string().datetime()
  }).strict())
}

export const ManagerHostLivenessSnapshotSchema = z.object({
  suspendedAtMs: z.number().nonnegative().nullable(),
  lastReconcileAtMs: z.number().nonnegative().nullable(),
  lastReportObservedAtMs: z.number().nonnegative().nullable(),
  lastReportSourceId: z.string().min(1).max(256).nullable(),
  lastReportPhase: z.enum(['suspend', 'resume']).nullable(),
  sequences: z.record(z.string(), z.number().int().positive())
}).strict()

const ServiceManagerStateSnapshotV1Schema = z.object({
  version: z.literal(1),
  ...RuntimeSlotSnapshotField,
  leases: z.array(LegacyThreadExecutionLeaseSchema),
  resourceLeases: z.array(LegacyManagerResourceLeaseSchema)
}).strict()

const ServiceManagerStateSnapshotV2Schema = z.object({
  version: z.literal(2),
  ...RuntimeSlotSnapshotField,
  leases: z.array(LegacyThreadExecutionLeaseSchema),
  resourceLeases: z.array(ManagerResourceLeaseSchema),
  resourceFenceHighWater: z.record(z.string(), z.number().int().nonnegative())
}).strict()

const ServiceManagerStateSnapshotV3Schema = z.object({
  version: z.literal(3),
  ...RuntimeSlotSnapshotField,
  leases: z.array(ThreadExecutionLeaseSchema),
  threadLeaseFenceHighWater: z.record(z.string(), z.number().int().nonnegative()),
  resourceLeases: z.array(ManagerResourceLeaseSchema),
  resourceFenceHighWater: z.record(z.string(), z.number().int().nonnegative())
}).strict()

const ServiceManagerStateSnapshotV4Schema = z.object({
  version: z.literal(4),
  ...RuntimeSlotSnapshotField,
  leases: z.array(ThreadExecutionLeaseSchema),
  pendingExpiredLeases: z.array(ThreadExecutionLeaseSchema),
  threadLeaseFenceHighWater: z.record(z.string(), z.number().int().nonnegative()),
  resourceLeases: z.array(ManagerResourceLeaseSchema),
  resourceFenceHighWater: z.record(z.string(), z.number().int().nonnegative())
}).strict()

/** The version every current Manager writes. */
export const ServiceManagerStateSnapshotV5Schema = z.object({
  version: z.literal(5),
  ...RuntimeSlotSnapshotField,
  leases: z.array(ThreadExecutionLeaseSchema),
  pendingExpiredLeases: z.array(ThreadExecutionLeaseSchema),
  threadLeaseFenceHighWater: z.record(z.string(), z.number().int().nonnegative()),
  resourceLeases: z.array(ManagerResourceLeaseSchema),
  resourceFenceHighWater: z.record(z.string(), z.number().int().nonnegative()),
  hostLiveness: ManagerHostLivenessSnapshotSchema
}).strict()

/**
 * Restores every historical layout. Dispatching on `version` validates a
 * document against one layout only; a plain union re-parsed the fence maps once
 * per older layout before accepting the current one.
 */
export const ServiceManagerStateSnapshotSchema = z.discriminatedUnion('version', [
  ServiceManagerStateSnapshotV1Schema,
  ServiceManagerStateSnapshotV2Schema,
  ServiceManagerStateSnapshotV3Schema,
  ServiceManagerStateSnapshotV4Schema,
  ServiceManagerStateSnapshotV5Schema
])

export type ServiceManagerStateSnapshot = z.infer<typeof ServiceManagerStateSnapshotSchema>
export type CurrentServiceManagerStateSnapshot = z.infer<typeof ServiceManagerStateSnapshotV5Schema>
