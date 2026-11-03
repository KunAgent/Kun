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

/** Stop a dead application's recorded consumers before its data writer.
 * An unresponsive HTTP endpoint is not identity evidence. */
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
    const states = await Promise.all(paths.map(readReservation))
    // An unreadable record is not evidence that its owner exited. Stopping
    // processes on unknown ownership is destructive, so the claim path repairs
    // that path instead: it verifies live owners and archives the rest.
    if (states.some((state) => state.kind === 'unreadable')) return
    const records = states.map((state) => state.kind === 'record' ? state.value : null)
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
    const snapshots = await Promise.all(paths.map(readParticipants))
    const live = verifiedLiveParticipants(snapshots)
    if (live.length === 0) return
    const manager = await readManagerHandoffDiscoveryStrict(profile.controlDir)
    if (manager && (!manager.appOwner || !sameAppSessionOwner(manager.appOwner, {
      ...reservation.owner, generation: manager.appOwner.generation
    }) || await canonicalSessionPath(manager.dataDir) !== profile.dataDir ||
      await canonicalSessionPath(manager.settingsPath) !== profile.settingsPath)) {
      throw new Error('Leftover Manager does not match the recorded application session')
    }
    const managers = live.filter((entry) => entry.instanceId.startsWith('manager-'))
    const runtimes = live.filter((entry) => !entry.instanceId.startsWith('manager-'))
    if (managers.some((entry) => !manager?.appOwner || entry.pid !== manager.pid ||
      entry.instanceId !== `manager-${manager.appOwner.generation}`) ||
      (manager && runtimeProcessIsAlive(manager.pid, manager) && !managers.some((entry) => entry.pid === manager.pid))) {
      throw new Error('Leftover Manager does not match the recorded application session')
    }
    const assertEvidence = async () => {
      assertOwnerExited()
      for (const path of paths) {
        const current = await readReservation(path)
        if (current.kind !== 'record' || JSON.stringify(current.value) !== JSON.stringify(reservation)) {
          throw new Error('Application session changed during recovery; retry to recheck ownership')
        }
      }
      const current = await readManagerHandoffDiscoveryStrict(profile.controlDir)
      if (current && JSON.stringify(current) !== JSON.stringify(manager)) {
        throw new Error('Manager identity changed during recovery')
      }
      const remaining = await Promise.all(paths.map(readParticipants))
      if (verifiedLiveParticipants(remaining).some((entry) => !live.some((original) => sameParticipant(entry, original))) ||
        live.some((entry) => runtimeProcessIsAlive(entry.pid, entry) &&
          remaining.some((snapshot) => !snapshot.some((current) => sameParticipant(entry, current))))) {
        throw new Error('Application participants changed during recovery')
      }
      assertOwnerExited()
    }
    const signalParticipant = async (participant: Participant, signal: NodeJS.Signals) => {
      await assertEvidence()
      // The liveness helper deliberately treats inspection failures as alive.
      // Sending a signal requires positive birth identity, including at escalation.
      if (!verifySignalTarget(participant)) return
      input.signal?.throwIfAborted()
      try { process.kill(participant.pid, signal) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    const stopParticipants = async (participants: Participant[], graceMs: number) => {
      for (const participant of participants) await signalParticipant(participant, 'SIGTERM')
      await waitForExit(participants, graceMs, input.signal)
      for (const participant of participants) {
        if (runtimeProcessIsAlive(participant.pid, participant)) await signalParticipant(participant, 'SIGKILL')
      }
      await waitForExit(participants, input.exitTimeoutMs ?? 2_000, input.signal)
      const remaining = participants.filter((entry) => runtimeProcessIsAlive(entry.pid, entry))
      if (remaining.length) {
        throw new Error(`Leftover Kun processes did not exit (pid ${remaining.map((entry) => entry.pid).join(', ')}); ownership has been preserved`)
      }
    }
    // Verify the entire set before stopping anything. Records in all canonical
    // claims, not a port scan or stale PID alone, grant orphan recovery authority.
    for (const participant of live) verifySignalTarget(participant)
    // Leave time for serve's own 10-second cleanup deadline before escalation.
    await stopParticipants(runtimes, input.graceMs ?? 15_000)
    await assertEvidence()
    await stopParticipants(managers, input.graceMs ?? 3_000)
    await assertEvidence()
    if (manager) await removeManagerDiscovery(profile.controlDir, manager.instanceId, manager)
    // Acquisition reclaims the dead session claims. Never remove business data.
  }
}

type ReservationState =
  | { kind: 'record'; value: Reservation }
  | { kind: 'missing' }
  | { kind: 'unreadable' }

async function readReservation(path: string): Promise<ReservationState> {
  let text: string
  try { text = await readFile(join(path, 'owner.json'), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw error
  }
  try { return { kind: 'record', value: AppSessionReservationSchema.parse(JSON.parse(text)) } }
  catch { return { kind: 'unreadable' } }
}

async function readParticipants(path: string): Promise<Participant[]> {
  const entries = await readdir(path)
  return Promise.all(entries.filter((name) => name.startsWith('process-')).sort().map(async (name) =>
    AppSessionParticipantSchema.parse(JSON.parse(await readFile(join(path, name), 'utf8')))))
}

function sameParticipant(left: Participant, right: Participant): boolean {
  return left.pid === right.pid && left.instanceId === right.instanceId &&
    left.startedAt === right.startedAt && left.processIdentity === right.processIdentity
}

function verifiedLiveParticipants(snapshots: Participant[][]): Participant[] {
  const live = new Map<number, Participant>()
  const candidates = new Map(snapshots.flat().map((entry) => [JSON.stringify(entry), entry]))
  for (const entry of candidates.values()) {
    if (!runtimeProcessIsAlive(entry.pid, entry)) continue
    if (snapshots.some((snapshot) => !snapshot.some((current) => sameParticipant(entry, current))) ||
      (live.has(entry.pid) && !sameParticipant(live.get(entry.pid)!, entry))) {
      throw new Error('Application participant identities do not match all profile reservations')
    }
    live.set(entry.pid, entry)
  }
  return [...live.values()]
}

function verifySignalTarget(participant: Participant): boolean {
  if (!runtimeProcessIsAlive(participant.pid, participant)) return false
  try {
    if (participant.pid !== process.pid && requireRuntimeProcessIdentity(participant.pid) === participant.processIdentity) return true
  } catch (error) {
    if (!runtimeProcessIsAlive(participant.pid, participant)) return false
    throw error
  }
  throw new Error(`Leftover Kun process identity could not be verified (pid ${participant.pid})`)
}

async function waitForExit(participants: Participant[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (participants.some((entry) => runtimeProcessIsAlive(entry.pid, entry)) && Date.now() < deadline) {
    signal?.throwIfAborted()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  signal?.throwIfAborted()
}
