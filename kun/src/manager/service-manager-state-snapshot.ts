import { z } from 'zod'
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

export const ServiceManagerStateSnapshotSchema = z.union([
  z.object({
    version: z.literal(1),
    ...RuntimeSlotSnapshotField,
    leases: z.array(LegacyThreadExecutionLeaseSchema),
    resourceLeases: z.array(LegacyManagerResourceLeaseSchema)
  }).strict(),
  z.object({
    version: z.literal(2),
    ...RuntimeSlotSnapshotField,
    leases: z.array(LegacyThreadExecutionLeaseSchema),
    resourceLeases: z.array(ManagerResourceLeaseSchema),
    resourceFenceHighWater: z.record(z.string(), z.number().int().nonnegative())
  }).strict(),
  z.object({
    version: z.literal(3),
    ...RuntimeSlotSnapshotField,
    leases: z.array(ThreadExecutionLeaseSchema),
    threadLeaseFenceHighWater: z.record(z.string(), z.number().int().nonnegative()),
    resourceLeases: z.array(ManagerResourceLeaseSchema),
    resourceFenceHighWater: z.record(z.string(), z.number().int().nonnegative())
  }).strict(),
  z.object({
    version: z.literal(4),
    ...RuntimeSlotSnapshotField,
    leases: z.array(ThreadExecutionLeaseSchema),
    pendingExpiredLeases: z.array(ThreadExecutionLeaseSchema),
    threadLeaseFenceHighWater: z.record(z.string(), z.number().int().nonnegative()),
    resourceLeases: z.array(ManagerResourceLeaseSchema),
    resourceFenceHighWater: z.record(z.string(), z.number().int().nonnegative())
  }).strict(),
  z.object({
    version: z.literal(5),
    ...RuntimeSlotSnapshotField,
    leases: z.array(ThreadExecutionLeaseSchema),
    pendingExpiredLeases: z.array(ThreadExecutionLeaseSchema),
    threadLeaseFenceHighWater: z.record(z.string(), z.number().int().nonnegative()),
    resourceLeases: z.array(ManagerResourceLeaseSchema),
    resourceFenceHighWater: z.record(z.string(), z.number().int().nonnegative()),
    hostLiveness: ManagerHostLivenessSnapshotSchema
  }).strict()
])

export type ServiceManagerStateSnapshot = z.infer<typeof ServiceManagerStateSnapshotSchema>
