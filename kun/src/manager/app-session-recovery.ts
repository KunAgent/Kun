import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { z } from 'zod'
import { sameAppSessionOwner } from '../contracts/app-session-owner.js'
import { requireRuntimeProcessIdentity, runtimeProcessIsAlive } from '../server/runtime-process-identity.js'
import {
  AppSessionConflictError, AppSessionParticipantSchema, AppSessionReservationSchema,
  canonicalSessionPath, type AppSessionReservation
} from './app-session-reservation.js'
import { readManagerHandoffDiscoveryStrict, removeManagerDiscovery, withManagerStartLock } from './manager-discovery.js'

type Reservation = z.infer<typeof AppSessionReservationSchema>
type Participant = z.infer<typeof AppSessionParticipantSchema>

/** Explicit recovery of a recorded orphan; an unresponsive HTTP endpoint is not identity evidence. */
export async function retireOrphanedAppSessionManager(input: AppSessionReservation['profile'] & {
  signal?: AbortSignal
  graceMs?: number
  exitTimeoutMs?: number
}): Promise<void> {
  const profile = {
    dataDir: await canonicalSessionPath(input.dataDir),
    controlDir: await canonicalSessionPath(input.controlDir),
    settingsPath: await canonicalSessionPath(input.settingsPath)
  }
  const paths = [...new Set([join(profile.dataDir, '.app-session'),
    join(profile.controlDir, '.app-session'), `${profile.settingsPath}.kun-app-session`])].sort()
  // Use the same ordered election locks as acquisition. Hold them until the
  // exact process exits; a competing desktop must not replace the evidence.
  const lock = (index: number): Promise<void> => index === paths.length
    ? recover()
    : withManagerStartLock(`${paths[index]}.election`, () => lock(index + 1), input.signal)
  await lock(0)

  async function recover(): Promise<void> {
    input.signal?.throwIfAborted()
    const records = await Promise.all(paths.map(readReservation))
    const reservation = records.find((record) => record !== null)
    if (!reservation) return
    for (const record of records) {
      if (!record || record.token !== reservation.token || !sameAppSessionOwner(record.owner, reservation.owner) ||
        Object.entries(profile).some(([key, value]) => record[key as keyof typeof profile] !== value)) {
        throw new Error('Application session recovery could not verify all profile reservations')
      }
    }
    const assertOwnerExited = () => {
      input.signal?.throwIfAborted()
      const owner = reservation.owner
      if (runtimeProcessIsAlive(owner.ownerPid, {
        startedAt: owner.ownerStartedAt, processIdentity: owner.ownerProcessIdentity
      })) throw new AppSessionConflictError(profile.dataDir, `application pid ${owner.ownerPid} is still running; close it before retrying`)
    }
    assertOwnerExited()
    const participants = (await Promise.all(paths.map(readParticipants))).flat()
    const live = participants.filter((participant) => runtimeProcessIsAlive(participant.pid, participant))
    if (live.length === 0) return
    const manager = await readManagerHandoffDiscoveryStrict(profile.controlDir)
    if (!manager?.appOwner || !sameAppSessionOwner(manager.appOwner, {
      ...reservation.owner, generation: manager.appOwner.generation
    }) || await canonicalSessionPath(manager.dataDir) !== profile.dataDir ||
      await canonicalSessionPath(manager.settingsPath) !== profile.settingsPath) {
      throw new Error('Leftover Manager does not match the recorded application session')
    }
    const participant = live[0]!
    if (live.some((entry) => entry.pid !== manager.pid ||
      entry.instanceId !== `manager-${manager.appOwner!.generation}` ||
      entry.processIdentity !== participant.processIdentity)) {
      throw new Error('Application Runtime processes are still running or their identities changed; wait for them to exit, then retry')
    }
    const assertEvidence = async () => {
      assertOwnerExited()
      for (const path of paths) {
        const current = await readReservation(path)
        if (JSON.stringify(current) !== JSON.stringify(reservation)) {
          throw new Error('Application session changed during recovery; retry to recheck ownership')
        }
      }
      const current = await readManagerHandoffDiscoveryStrict(profile.controlDir)
      if (current && (current.instanceId !== manager.instanceId || current.pid !== manager.pid ||
        current.startedAt !== manager.startedAt || !sameAppSessionOwner(current.appOwner, manager.appOwner))) {
        throw new Error('Manager identity changed during recovery')
      }
      const remaining = (await Promise.all(paths.map(readParticipants))).flat()
      if (remaining.some((entry) => runtimeProcessIsAlive(entry.pid, entry) &&
        (entry.pid !== participant.pid || entry.processIdentity !== participant.processIdentity ||
          entry.instanceId !== participant.instanceId))) {
        throw new Error('Application participants changed during recovery')
      }
      assertOwnerExited()
    }
    const signalManager = async (signal: NodeJS.Signals) => {
      await assertEvidence()
      if (!runtimeProcessIsAlive(participant.pid, participant)) return
      // The liveness helper deliberately treats inspection failures as alive.
      // Sending a signal requires positive birth identity, including at escalation.
      if (participant.pid === process.pid || requireRuntimeProcessIdentity(participant.pid) !== participant.processIdentity) {
        throw new Error('Leftover Manager process identity could not be verified')
      }
      input.signal?.throwIfAborted()
      try { process.kill(participant.pid, signal) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    await signalManager('SIGTERM')
    await waitForExit(participant, input.graceMs ?? 3_000, input.signal)
    if (runtimeProcessIsAlive(participant.pid, participant)) {
      await signalManager('SIGKILL')
      await waitForExit(participant, input.exitTimeoutMs ?? 2_000, input.signal)
    }
    if (runtimeProcessIsAlive(participant.pid, participant)) {
      throw new Error(`Leftover Manager pid ${participant.pid} did not exit; ownership has been preserved`)
    }
    await removeManagerDiscovery(profile.controlDir, manager.instanceId, manager)
    // Acquisition reclaims the dead session claims. Never remove business data.
  }
}

async function readReservation(path: string): Promise<Reservation | null> {
  try { return AppSessionReservationSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

async function readParticipants(path: string): Promise<Participant[]> {
  const entries = await readdir(path)
  return Promise.all(entries.filter((name) => name.startsWith('process-')).sort().map(async (name) =>
    AppSessionParticipantSchema.parse(JSON.parse(await readFile(join(path, name), 'utf8')))))
}

async function waitForExit(participant: Participant, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (runtimeProcessIsAlive(participant.pid, participant) && Date.now() < deadline) {
    signal?.throwIfAborted()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  signal?.throwIfAborted()
}
