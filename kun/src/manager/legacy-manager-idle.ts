import { z } from 'zod'
import { AppSessionOwnerSchema, type AppSessionOwner } from '../contracts/app-session-owner.js'
import {
  runtimeProcessIsAlive,
  type RuntimeProcessIsAlive
} from '../server/runtime-process-identity.js'

export const LEGACY_MANAGER_OWNED_MESSAGE =
  'Manager belongs to an application session; quit its owning application'
export const LEGACY_MANAGER_BUSY_MESSAGE =
  'Manager has an application owner or Runtime slots; close its clients before retiring it'

const ManagerStatusSlotSchema = z.object({
  registration: z.object({
    pid: z.number().int().positive(),
    startedAt: z.string().datetime()
  }).passthrough()
}).passthrough()

/** Fail closed: an unreadable owner is treated as a live application session. */
export function liveApplicationOwner(
  value: unknown,
  isAlive: RuntimeProcessIsAlive = runtimeProcessIsAlive
): AppSessionOwner | undefined {
  if (value === undefined || value === null) return undefined
  const parsed = AppSessionOwnerSchema.safeParse(value)
  if (!parsed.success) throw new Error(LEGACY_MANAGER_OWNED_MESSAGE)
  const owner = parsed.data
  return isAlive(owner.ownerPid, {
    startedAt: owner.ownerStartedAt,
    processIdentity: owner.ownerProcessIdentity
  }) ? owner : undefined
}

/**
 * Status slots are `{ registration: { pid, startedAt }, lastHeartbeatAt }`.
 * Unparseable entries are live work: never retire around them.
 */
export function liveRuntimeSlots(
  slots: readonly unknown[],
  isAlive: RuntimeProcessIsAlive = runtimeProcessIsAlive
): unknown[] {
  const live: unknown[] = []
  for (const slot of slots) {
    const parsed = ManagerStatusSlotSchema.safeParse(slot)
    if (!parsed.success) throw new Error(LEGACY_MANAGER_BUSY_MESSAGE)
    const registration = parsed.data.registration
    if (isAlive(registration.pid, { startedAt: registration.startedAt })) live.push(slot)
  }
  return live
}

/** Verified-dead owners and slots do not block idle retirement. */
export function assertLegacyManagerIdle(input: {
  discoveryOwner?: unknown
  healthOwner?: unknown
  statusOwner?: unknown
  slots: readonly unknown[]
}, isAlive: RuntimeProcessIsAlive = runtimeProcessIsAlive): void {
  if (liveApplicationOwner(input.discoveryOwner, isAlive)) {
    throw new Error(LEGACY_MANAGER_OWNED_MESSAGE)
  }
  if (liveApplicationOwner(input.healthOwner, isAlive)
    || liveApplicationOwner(input.statusOwner, isAlive)
    || liveRuntimeSlots(input.slots, isAlive).length > 0) {
    throw new Error(LEGACY_MANAGER_BUSY_MESSAGE)
  }
}
