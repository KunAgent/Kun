import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { AppSessionOwnerSchema, type AppSessionOwner } from '../contracts/app-session-owner.js'
import { requireRuntimeProcessIdentity, runtimeProcessIsAlive } from '../server/runtime-process-identity.js'
import { withManagerStartLock } from './manager-discovery.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'

const ParticipantSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  processIdentity: z.string().min(1),
  instanceId: z.string().min(1)
})
const ReservationSchema = z.object({
  token: z.string().min(1),
  owner: AppSessionOwnerSchema,
  dataDir: z.string(),
  controlDir: z.string(),
  settingsPath: z.string()
})
export type AppSessionReservation = {
  path: string
  profile: { dataDir: string; controlDir: string; settingsPath: string }
  recordProcess(input: { pid: number; instanceId: string; startedAt?: string }): Promise<void>
  release(): Promise<void>
}

const DEFAULT_CONFLICT_HINT = 'Close that client first, or isolate dataDir, controlDir and settingsPath'

export class AppSessionConflictError extends Error {
  readonly code = 'app_session_owner_busy'
  constructor(path: string, detail = 'another application session owns this profile', hint = DEFAULT_CONFLICT_HINT) {
    super(`Kun profile is already owned: ${path}; ${detail}. ${hint}.`)
    this.name = 'AppSessionConflictError'
  }
}

type LiveParticipant = z.infer<typeof ParticipantSchema>

/**
 * The owner exited but processes it recorded are still alive: owner-loss
 * cleanup stalled (for example a wedged Manager). Name them so the user can
 * stop exactly those processes instead of hunting for a "client" that is gone.
 */
export function orphanedReservationError(
  path: string,
  owner: AppSessionOwner,
  orphans: readonly Pick<LiveParticipant, 'pid' | 'instanceId'>[],
  platform: NodeJS.Platform = process.platform
): AppSessionConflictError {
  const pids = [...new Set(orphans.map((orphan) => orphan.pid))]
  const listed = orphans.map((orphan) => `pid ${orphan.pid} (${orphan.instanceId})`).join(', ')
  const stop = platform === 'win32'
    ? pids.map((pid) => `taskkill /PID ${pid} /T /F`).join(' && ')
    : `kill ${pids.join(' ')}`
  return new AppSessionConflictError(
    path,
    `its ${owner.ownerKind} application (pid ${owner.ownerPid}) has exited, but processes it started are still running and did not shut down: ${listed}`,
    `Stop them (\`${stop}\`), then retry`
  )
}

/** Resolve existing ancestors too, so an absent settings file behind a symlink cannot alias a profile. */
export async function canonicalSessionPath(path: string): Promise<string> {
  const absolute = resolve(path)
  try { return normalize(await realpath(absolute)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(absolute)
    if (parent === absolute) throw error
    return normalize(join(await canonicalSessionPath(parent), basename(absolute)))
  }
}
function normalize(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export async function acquireAppSessionReservation(input: {
  owner: AppSessionOwner
  dataDir: string
  controlDir: string
  settingsPath: string
  signal?: AbortSignal
}): Promise<AppSessionReservation> {
  const profile = {
    dataDir: await canonicalSessionPath(input.dataDir),
    controlDir: await canonicalSessionPath(input.controlDir),
    settingsPath: await canonicalSessionPath(input.settingsPath)
  }
  const paths = [...new Set([
    join(profile.dataDir, '.app-session'),
    join(profile.controlDir, '.app-session'),
    `${profile.settingsPath}.kun-app-session`
  ])].sort()
  const record = { token: randomUUID(), owner: input.owner, ...profile }
  const owned: string[] = []
  try {
    for (const path of paths) {
      await withManagerStartLock(`${path}.election`, () => claim(path, record), input.signal)
      owned.push(path)
    }
  } catch (error) {
    await Promise.allSettled(owned.map((path) => releaseMatching(path, record.token)))
    throw error
  }
  const path = join(profile.dataDir, '.app-session')
  return {
    path,
    profile,
    recordProcess: async (participant) => {
      const processIdentity = requireRuntimeProcessIdentity(participant.pid)
      const value = ParticipantSchema.parse({ ...participant, processIdentity, startedAt: participant.startedAt ?? new Date().toISOString() })
      // All profile claims retain participants, including shared settings with a different dataDir.
      for (const directory of paths) {
        await assertReservation(directory, input.owner.ownerSessionId)
        await atomicWriteFile(join(directory, `process-${participant.instanceId.replace(/[^a-zA-Z0-9_-]/gu, '_')}.json`), JSON.stringify(value))
      }
    },
    release: async () => {
      for (const directory of paths) {
        if (await participantsAlive(directory)) throw new Error(`Owned processes remain alive for ${directory}`)
      }
      await Promise.all(paths.map((directory) => releaseMatching(directory, record.token)))
    }
  }
}

async function claim(path: string, record: z.infer<typeof ReservationSchema>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  for (;;) {
    try {
      await mkdir(path, { mode: 0o700 })
      try { await writeFile(join(path, 'owner.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600 }) }
      catch (error) { await rm(path, { recursive: true, force: true }); throw error }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    let existing: z.infer<typeof ReservationSchema>
    try { existing = ReservationSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'))) }
    catch { throw new AppSessionConflictError(path, 'owner identity is starting or cannot be verified') }
    if (runtimeProcessIsAlive(existing.owner.ownerPid, {
      startedAt: existing.owner.ownerStartedAt, processIdentity: existing.owner.ownerProcessIdentity
    })) {
      throw new AppSessionConflictError(
        path,
        `a running ${existing.owner.ownerKind} application session (pid ${existing.owner.ownerPid}) owns this profile`
      )
    }
    const orphans = await liveParticipants(path)
    if (orphans.length > 0) throw orphanedReservationError(path, existing.owner, orphans)
    const stale = `${path}.retired-${randomUUID()}`
    try { await rename(path, stale) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    await rm(stale, { recursive: true, force: true })
  }
}

async function participantsAlive(path: string): Promise<boolean> {
  return (await liveParticipants(path)).length > 0
}

async function liveParticipants(path: string): Promise<LiveParticipant[]> {
  const entries = await readdir(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  const live: LiveParticipant[] = []
  for (const entry of entries.filter((name) => name.startsWith('process-')).sort()) {
    const value = ParticipantSchema.parse(JSON.parse(await readFile(join(path, entry), 'utf8')))
    if (runtimeProcessIsAlive(value.pid, value)) live.push(value)
  }
  return live
}

async function releaseMatching(path: string, token: string): Promise<void> {
  let value: z.infer<typeof ReservationSchema>
  try { value = ReservationSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  if (value.token === token) await rm(path, { recursive: true, force: true })
}

export async function assertReservation(path: string, ownerSessionId: string): Promise<void> {
  const value = ReservationSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')))
  if (value.owner.ownerSessionId !== ownerSessionId) throw new AppSessionConflictError(path)
}

export async function assertManagerSessionReservation(path: string, owner: AppSessionOwner, profile: {
  dataDir: string; controlDir: string; settingsPath: string
}): Promise<void> {
  const value = ReservationSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')))
  if (value.owner.ownerSessionId !== owner.ownerSessionId || value.owner.ownerPid !== owner.ownerPid ||
    value.owner.ownerProcessIdentity !== owner.ownerProcessIdentity || value.owner.ownerKind !== owner.ownerKind) {
    throw new AppSessionConflictError(path, 'application owner identity changed')
  }
  for (const key of ['dataDir', 'controlDir', 'settingsPath'] as const) {
    if (value[key] !== await canonicalSessionPath(profile[key])) {
      throw new AppSessionConflictError(path, 'Manager profile is outside the application reservation')
    }
  }
}

export async function assertNoAppSessionReservation(profile: {
  dataDir: string; controlDir: string; settingsPath: string
}): Promise<void> {
  const paths = [join(await canonicalSessionPath(profile.dataDir), '.app-session'),
    join(await canonicalSessionPath(profile.controlDir), '.app-session'),
    `${await canonicalSessionPath(profile.settingsPath)}.kun-app-session`]
  for (const path of paths) {
    try { await stat(path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    throw new AppSessionConflictError(path, 'this profile requires application-owned Manager startup')
  }
}

export async function recordAppSessionParticipant(path: string, owner: AppSessionOwner, participant: {
  pid: number; instanceId: string; startedAt: string
}): Promise<void> {
  // Foreground serve is its own application owner; the owner claim already
  // fences it and must be releasable after its stores close, before process exit.
  if (participant.pid === owner.ownerPid) return
  const record = ReservationSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')))
  if (record.owner.ownerSessionId !== owner.ownerSessionId ||
    record.owner.ownerProcessIdentity !== owner.ownerProcessIdentity) throw new AppSessionConflictError(path)
  const processIdentity = requireRuntimeProcessIdentity(participant.pid)
  const value = ParticipantSchema.parse({ ...participant, processIdentity })
  for (const directory of [...new Set([
    join(record.dataDir, '.app-session'), join(record.controlDir, '.app-session'),
    `${record.settingsPath}.kun-app-session`
  ])]) {
    await assertReservation(directory, owner.ownerSessionId)
    await atomicWriteFile(join(directory, `process-${participant.instanceId.replace(/[^a-zA-Z0-9_-]/gu, '_')}.json`), JSON.stringify(value))
  }
}
