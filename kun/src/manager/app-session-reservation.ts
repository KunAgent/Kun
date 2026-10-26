import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { AppSessionOwnerSchema, type AppSessionOwner } from '../contracts/app-session-owner.js'
import { requireRuntimeProcessIdentity, runtimeProcessIsAlive } from '../server/runtime-process-identity.js'
import { sameCanonicalPath } from './canonical-path.js'
import { readManagerHandoffDiscoveryStrict, withManagerStartLock } from './manager-discovery.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'

export const AppSessionParticipantSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  processIdentity: z.string().min(1),
  instanceId: z.string().min(1)
})
export const AppSessionReservationSchema = z.object({
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

export class OrphanedAppSessionError extends AppSessionConflictError {}

type LiveParticipant = z.infer<typeof AppSessionParticipantSchema>

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
): OrphanedAppSessionError {
  const pids = [...new Set(orphans.map((orphan) => orphan.pid))]
  const listed = orphans.map((orphan) => `pid ${orphan.pid} (${orphan.instanceId})`).join(', ')
  const stop = platform === 'win32'
    ? pids.map((pid) => `taskkill /PID ${pid} /T /F`).join(' && ')
    : `kill ${pids.join(' ')}`
  return new OrphanedAppSessionError(
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
      await withManagerStartLock(`${path}.election`,
        () => claimAppSessionReservation(path, record, { signal: input.signal }), input.signal)
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
      const value = AppSessionParticipantSchema.parse({ ...participant, processIdentity, startedAt: participant.startedAt ?? new Date().toISOString() })
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

const CLAIM_PUBLICATION_GRACE_MS = 5_000
const CLAIM_RETRY_MS = 50

type ClaimOwnerState =
  | { kind: 'record'; value: z.infer<typeof AppSessionReservationSchema> }
  | { kind: 'missing' }
  | { kind: 'unreadable' }

/**
 * Claim one profile path. An owner record that cannot be read is never treated
 * as a free profile: live processes and a live Runtime Manager still block the
 * claim, and a directory that stays unreadable past the publication grace is
 * archived with its evidence before the claim is retried.
 */
export async function claimAppSessionReservation(
  path: string,
  record: z.infer<typeof AppSessionReservationSchema>,
  options: { signal?: AbortSignal; publicationGraceMs?: number } = {}
): Promise<void> {
  const graceMs = options.publicationGraceMs ?? CLAIM_PUBLICATION_GRACE_MS
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  for (;;) {
    options.signal?.throwIfAborted()
    try {
      await mkdir(path, { mode: 0o700 })
      try { await writeFile(join(path, 'owner.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600 }) }
      catch (error) { await rm(path, { recursive: true, force: true }); throw error }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const owner = await readClaimOwner(path)
    if (owner.kind === 'record') {
      if (runtimeProcessIsAlive(owner.value.owner.ownerPid, {
        startedAt: owner.value.owner.ownerStartedAt, processIdentity: owner.value.owner.ownerProcessIdentity
      })) {
        throw new AppSessionConflictError(
          path,
          `a running ${owner.value.owner.ownerKind} application session (pid ${owner.value.owner.ownerPid}) owns this profile`
        )
      }
      const orphans = await liveParticipants(path)
      if (orphans.length > 0) throw orphanedReservationError(path, owner.value.owner, orphans)
      await retireClaimDirectory(path)
      continue
    }
    // Only a claim directory that nobody published into can be abandoned. A
    // live writer publishes owner.json within the grace window below.
    const participantConflict = await claimParticipantConflict(path)
    if (participantConflict) throw participantConflict
    const managerConflict = await claimManagerConflict(path, record)
    if (managerConflict) throw managerConflict
    const ageMs = await claimDirectoryAgeMs(path)
    if (ageMs === undefined) continue
    if (ageMs < graceMs) { await delay(CLAIM_RETRY_MS); continue }
    await archiveUnverifiedClaim(path)
  }
}

async function readClaimOwner(path: string): Promise<ClaimOwnerState> {
  let text: string
  try { text = await readFile(join(path, 'owner.json'), 'utf8') } catch (error) {
    // A missing record may be a writer that has not published yet; every other
    // read failure is real evidence and must never read as "no owner".
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw error
  }
  try { return { kind: 'record', value: AppSessionReservationSchema.parse(JSON.parse(text)) } }
  catch { return { kind: 'unreadable' } }
}

/** Directory mtime dates the last publish attempt, so it outlives a corrupt payload. */
async function claimDirectoryAgeMs(path: string): Promise<number | undefined> {
  try { return Date.now() - (await stat(path)).mtimeMs } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function claimParticipantConflict(path: string): Promise<AppSessionConflictError | undefined> {
  let live: LiveParticipant[]
  try { live = await liveParticipants(path) } catch {
    return new AppSessionConflictError(path,
      'its leftover process records are unreadable, so ownership cannot be verified',
      'Quit every Kun client, then inspect the app-session directory for diagnosis and retry')
  }
  if (live.length === 0) return undefined
  const pids = [...new Set(live.map((participant) => participant.pid))]
  const listed = live.map((participant) => `pid ${participant.pid} (${participant.instanceId})`).join(', ')
  const stop = process.platform === 'win32'
    ? pids.map((pid) => `taskkill /PID ${pid} /T /F`).join(' && ')
    : `kill ${pids.join(' ')}`
  return new AppSessionConflictError(
    path,
    `its owner record is unreadable, but processes it started are still running and did not shut down: ${listed}`,
    `Stop them (\`${stop}\`), then retry`)
}

async function claimManagerConflict(
  path: string,
  record: z.infer<typeof AppSessionReservationSchema>
): Promise<AppSessionConflictError | undefined> {
  let manager
  try { manager = await readManagerHandoffDiscoveryStrict(record.controlDir) } catch {
    return new AppSessionConflictError(path,
      'its Runtime Manager record is unreadable, so no owner can be verified',
      'Quit every Kun client, then inspect manager.json in the control directory and retry')
  }
  if (!manager || !sameCanonicalPath(manager.dataDir, record.dataDir)) return undefined
  if (!runtimeProcessIsAlive(manager.pid, { startedAt: manager.startedAt })) return undefined
  return new AppSessionConflictError(path, `a Runtime Manager (pid ${manager.pid}) still owns this profile`)
}

async function retireClaimDirectory(path: string): Promise<void> {
  const stale = `${path}.retired-${randomUUID()}`
  try { await rename(path, stale) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await rm(stale, { recursive: true, force: true })
}

/** Keep the unreadable record instead of deleting it: it is the only trace of that owner. */
async function archiveUnverifiedClaim(path: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  try { await rename(path, `${path}.unverified-${stamp}-${randomUUID().slice(0, 8)}`) } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    throw new AppSessionConflictError(path,
      `its unreadable owner record could not be archived (${code ?? 'unknown error'})`,
      `Check that ${dirname(path)} is writable, then retry`)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    const value = AppSessionParticipantSchema.parse(JSON.parse(await readFile(join(path, entry), 'utf8')))
    if (runtimeProcessIsAlive(value.pid, value)) live.push(value)
  }
  return live
}

async function releaseMatching(path: string, token: string): Promise<void> {
  let value: z.infer<typeof AppSessionReservationSchema>
  try { value = AppSessionReservationSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  if (value.token === token) await rm(path, { recursive: true, force: true })
}

export async function assertReservation(path: string, ownerSessionId: string): Promise<void> {
  const value = AppSessionReservationSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')))
  if (value.owner.ownerSessionId !== ownerSessionId) throw new AppSessionConflictError(path)
}

export async function assertManagerSessionReservation(path: string, owner: AppSessionOwner, profile: {
  dataDir: string; controlDir: string; settingsPath: string
}): Promise<void> {
  const value = AppSessionReservationSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')))
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
  const record = AppSessionReservationSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')))
  if (record.owner.ownerSessionId !== owner.ownerSessionId ||
    record.owner.ownerProcessIdentity !== owner.ownerProcessIdentity) throw new AppSessionConflictError(path)
  const processIdentity = requireRuntimeProcessIdentity(participant.pid)
  const value = AppSessionParticipantSchema.parse({ ...participant, processIdentity })
  for (const directory of [...new Set([
    join(record.dataDir, '.app-session'), join(record.controlDir, '.app-session'),
    `${record.settingsPath}.kun-app-session`
  ])]) {
    await assertReservation(directory, owner.ownerSessionId)
    await atomicWriteFile(join(directory, `process-${participant.instanceId.replace(/[^a-zA-Z0-9_-]/gu, '_')}.json`), JSON.stringify(value))
  }
}
