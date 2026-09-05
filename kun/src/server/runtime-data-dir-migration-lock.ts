import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  isValidRuntimeProcessIdentity,
  runtimeProcessIdentity,
  runtimeProcessIsAlive,
  type RuntimeProcessIsAlive
} from './runtime-process-identity.js'

export const RUNTIME_DATA_DIR_MIGRATION_LOCK_SUFFIX = '.kun-runtime-migration.lock'
export const RUNTIME_DATA_DIR_OWNER_FILE = '.kun-runtime-owner.json'
export const RUNTIME_DATA_DIR_CLAIMS_SUFFIX = '.kun-runtime-writer-claims'

type RuntimeDataDirWriterClaimKind = 'runtime' | 'migration' | 'config' | 'ancillary'

type RuntimeDataDirWriterClaimRecord = {
  schemaVersion: 1
  kind: RuntimeDataDirWriterClaimKind
  pid: number
  token: string
  startedAt: string
  processIdentity?: string
  dataDir: string
}

export type RuntimeDataDirWriterClaim = {
  path: string
  release(): Promise<void>
}

type RuntimeDataDirMigrationLockOwner = {
  schemaVersion: 1
  pid: number
  token: string
  startedAt: string
  processIdentity?: string
  dataDir: string
}

type RuntimeDataDirOwner = {
  schemaVersion: 1
  pid: number
  token: string
  startedAt: string
  processIdentity?: string
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
}

function parseOwner(raw: string): RuntimeDataDirMigrationLockOwner | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeDataDirMigrationLockOwner>
    return parsed.schemaVersion === 1 &&
      Number.isSafeInteger(parsed.pid) &&
      (parsed.pid ?? 0) > 0 &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      typeof parsed.startedAt === 'string' &&
      isValidRuntimeProcessIdentity(parsed.processIdentity) &&
      typeof parsed.dataDir === 'string' &&
      parsed.dataDir.length > 0
      ? parsed as RuntimeDataDirMigrationLockOwner
      : null
  } catch {
    return null
  }
}

function parseRuntimeOwner(raw: string): RuntimeDataDirOwner | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeDataDirOwner>
    return parsed.schemaVersion === 1 &&
      Number.isSafeInteger(parsed.pid) &&
      (parsed.pid ?? 0) > 0 &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      typeof parsed.startedAt === 'string' &&
      isValidRuntimeProcessIdentity(parsed.processIdentity)
      ? parsed as RuntimeDataDirOwner
      : null
  } catch {
    return null
  }
}

function parseWriterClaim(raw: string): RuntimeDataDirWriterClaimRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeDataDirWriterClaimRecord>
    return parsed.schemaVersion === 1 &&
      (
        parsed.kind === 'runtime' ||
        parsed.kind === 'migration' ||
        parsed.kind === 'config' ||
        parsed.kind === 'ancillary'
      ) &&
      Number.isSafeInteger(parsed.pid) &&
      (parsed.pid ?? 0) > 0 &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      typeof parsed.startedAt === 'string' &&
      isValidRuntimeProcessIdentity(parsed.processIdentity) &&
      typeof parsed.dataDir === 'string' &&
      parsed.dataDir.length > 0
      ? parsed as RuntimeDataDirWriterClaimRecord
      : null
  } catch {
    return null
  }
}

export function runtimeDataDirOwnerPath(dataDir: string): string {
  return join(dataDir, RUNTIME_DATA_DIR_OWNER_FILE)
}

export function runtimeDataDirClaimsPath(dataDir: string): string {
  const canonical = resolve(dataDir)
  return join(dirname(canonical), `.${basename(canonical)}${RUNTIME_DATA_DIR_CLAIMS_SUFFIX}`)
}

function writerClaimFilename(pid: number, token: string): string {
  return `claim-${pid}-${token}.json`
}

function claimFilenamePid(filename: string): number | undefined {
  const matched = /^claim-(\d+)-[0-9a-f-]+\.json$/iu.exec(filename)
  if (!matched) return undefined
  const pid = Number(matched[1])
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

function claimConflictMessage(claim: RuntimeDataDirWriterClaimRecord, dataDir: string): string {
  if (claim.kind === 'migration') {
    return `Kun Runtime data migration is active in process ${claim.pid}: ${dataDir}`
  }
  if (claim.kind === 'config') {
    return `Kun Runtime config synchronization is active in process ${claim.pid}: ${dataDir}`
  }
  if (claim.kind === 'ancillary') {
    return `Kun Runtime ancillary data write is active in process ${claim.pid}: ${dataDir}`
  }
  return `Kun Runtime data directory is already owned by active process ${claim.pid}: ${dataDir}`
}

function writerClaimsConflict(
  requestedKind: RuntimeDataDirWriterClaimKind,
  existingKind: RuntimeDataDirWriterClaimKind
): boolean {
  if (requestedKind === 'migration' || existingKind === 'migration') return true
  if (requestedKind === 'ancillary' || existingKind === 'ancillary') return false
  return true
}

/**
 * Runtime, migration, config, and ancillary writers publish uniquely named
 * claims for their fenced lifetime. A contender publishes before listing, so
 * a later conflicting contender must observe it; dead claims can be unlinked
 * by exact unique name without an ABA-prone shared-path rename.
 */
export async function acquireRuntimeDataDirWriterClaim(
  dataDir: string,
  kind: RuntimeDataDirWriterClaimKind,
  options: {
    pid?: number
    now?: () => Date
    processIsAlive?: RuntimeProcessIsAlive
    afterClaimCreated?: (path: string) => void | Promise<void>
  } = {}
): Promise<RuntimeDataDirWriterClaim> {
  const pid = options.pid ?? process.pid
  const now = options.now ?? (() => new Date())
  const processIsAlive = options.processIsAlive ?? runtimeProcessIsAlive
  const canonicalDataDir = resolve(dataDir)
  const claimsPath = runtimeDataDirClaimsPath(canonicalDataDir)
  const token = randomUUID()
  const path = join(claimsPath, writerClaimFilename(pid, token))
  const processIdentity = runtimeProcessIdentity(pid)
  const record: RuntimeDataDirWriterClaimRecord = {
    schemaVersion: 1,
    kind,
    pid,
    token,
    startedAt: now().toISOString(),
    ...(processIdentity ? { processIdentity } : {}),
    dataDir: canonicalDataDir
  }
  await mkdir(claimsPath, { recursive: true, mode: 0o700 })
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(path).catch(() => undefined)
    throw error
  }
  try {
    await options.afterClaimCreated?.(path)
    for (const entry of await readdir(claimsPath, { withFileTypes: true })) {
      if (entry.name === basename(path) || !entry.name.startsWith('claim-')) continue
      const contenderPid = claimFilenamePid(entry.name)
      // Only canonical claim names participate in writer fencing. Recovery or
      // support tooling may leave tombstones such as `claim-*.json.stale` in
      // this directory; they are not live claims and must not block startup.
      if (contenderPid === undefined) continue
      if (!entry.isFile()) {
        throw new Error(`Kun Runtime writer claim is not a regular file: ${join(claimsPath, entry.name)}`)
      }
      const contenderPath = join(claimsPath, entry.name)
      let raw: string
      try {
        raw = await readFile(contenderPath, 'utf8')
      } catch (error) {
        if (isErrno(error, 'ENOENT')) continue
        throw error
      }
      const contender = parseWriterClaim(raw)
      if (
        !contender ||
        contender.pid !== contenderPid ||
        contender.dataDir !== canonicalDataDir ||
        writerClaimFilename(contender.pid, contender.token) !== entry.name
      ) {
        if (!processIsAlive(contenderPid)) {
          await unlink(contenderPath).catch((error) => {
            if (!isErrno(error, 'ENOENT')) throw error
          })
          continue
        }
        throw new Error(`Kun Runtime writer claim is invalid: ${contenderPath}`)
      }
      if (processIsAlive(contender.pid, contender)) {
        if (writerClaimsConflict(kind, contender.kind)) {
          throw new Error(claimConflictMessage(contender, dataDir))
        }
        continue
      }
      await unlink(contenderPath).catch((error) => {
        if (!isErrno(error, 'ENOENT')) throw error
      })
    }
  } catch (error) {
    await unlink(path).catch(() => undefined)
    throw error
  }
  let released = false
  return {
    path,
    release: async () => {
      if (released) return
      released = true
      await unlink(path).catch((error) => {
        if (!isErrno(error, 'ENOENT')) throw error
      })
    }
  }
}

async function restoreDisplacedLock(path: string, displacedPath: string): Promise<void> {
  try {
    // link() is exclusive when the destination exists. It restores the exact
    // inode that was displaced without overwriting a third contender.
    await link(displacedPath, path)
    await unlink(displacedPath)
  } catch (error) {
    throw new Error(
      `Kun Runtime lock changed during stale-owner recovery; ` +
      `the displaced live record was preserved at ${displacedPath}`,
      { cause: error }
    )
  }
}

/**
 * Remove only the exact dead-owner bytes that were inspected. A replacement
 * appearing between read and rename is restored and never deleted.
 */
export async function reclaimLockFileIfUnchanged(
  path: string,
  expectedRaw: string,
  input: {
    pid: number
    beforeReclaim?: (path: string, expectedRaw: string) => void | Promise<void>
  }
): Promise<void> {
  await input.beforeReclaim?.(path, expectedRaw)
  const displacedPath = `${path}.stale-${input.pid}-${randomUUID()}`
  try {
    await rename(path, displacedPath)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return
    throw error
  }
  let displacedRaw: string
  try {
    displacedRaw = await readFile(displacedPath, 'utf8')
  } catch (error) {
    throw new Error(`could not verify displaced Kun Runtime lock at ${displacedPath}`, {
      cause: error
    })
  }
  if (displacedRaw !== expectedRaw) {
    await restoreDisplacedLock(path, displacedPath)
    throw new Error('Kun Runtime lock owner changed during stale-owner recovery')
  }
  await rm(displacedPath, { force: true })
}

/**
 * Keep the migration fence beside the data directory rather than inside it.
 * A missing Runtime directory can therefore be fenced without creating the
 * destination before the migration transaction has verified its source.
 */
export function runtimeDataDirMigrationLockPath(dataDir: string): string {
  const canonical = resolve(dataDir)
  return join(
    dirname(canonical),
    `.${basename(canonical)}${RUNTIME_DATA_DIR_MIGRATION_LOCK_SUFFIX}`
  )
}

/**
 * Fail while a live migration owns the directory. A dead owner's file is
 * recovered with rename-before-remove so a contender never deletes a newly
 * replaced lock by path alone.
 */
export async function assertRuntimeDataDirMigrationInactive(
  dataDir: string,
  options: {
    pid?: number
    processIsAlive?: RuntimeProcessIsAlive
    beforeStaleReclaim?: (path: string, expectedRaw: string) => void | Promise<void>
  } = {}
): Promise<void> {
  const pid = options.pid ?? process.pid
  const processIsAlive = options.processIsAlive ?? runtimeProcessIsAlive
  const path = runtimeDataDirMigrationLockPath(dataDir)
  for (;;) {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return
      throw new Error(`could not inspect Kun Runtime migration lock at ${path}`, {
        cause: error
      })
    }
    const owner = parseOwner(raw)
    if (!owner) {
      throw new Error(`Kun Runtime migration lock is invalid: ${path}`)
    }
    if (processIsAlive(owner.pid, owner)) {
      throw new Error(
        `Kun Runtime data migration is active in process ${owner.pid}: ${dataDir}`
      )
    }
    await reclaimLockFileIfUnchanged(path, raw, {
      pid,
      beforeReclaim: options.beforeStaleReclaim
    })
  }
}

export async function assertRuntimeDataDirLeaseInactive(
  dataDir: string,
  options: {
    pid?: number
    processIsAlive?: RuntimeProcessIsAlive
    beforeStaleReclaim?: (path: string, expectedRaw: string) => void | Promise<void>
  } = {}
): Promise<void> {
  const pid = options.pid ?? process.pid
  const processIsAlive = options.processIsAlive ?? runtimeProcessIsAlive
  const path = runtimeDataDirOwnerPath(dataDir)
  for (;;) {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return
      throw new Error(`could not inspect Kun Runtime data directory owner at ${path}`, {
        cause: error
      })
    }
    const owner = parseRuntimeOwner(raw)
    if (!owner) throw new Error(`Kun Runtime data directory owner record is invalid: ${path}`)
    if (processIsAlive(owner.pid, owner)) {
      throw new Error(
        `Kun Runtime data directory is already owned by active process ${owner.pid}: ${dataDir}`
      )
    }
    await reclaimLockFileIfUnchanged(path, raw, {
      pid,
      beforeReclaim: options.beforeStaleReclaim
    })
  }
}

export type RuntimeDataDirMigrationLock = {
  path: string
  claimPath: string
  release(): Promise<void>
}

/** Test/support helper for asynchronous migration coordinators. */
export async function acquireRuntimeDataDirMigrationLock(
  dataDir: string,
  options: {
    pid?: number
    now?: () => Date
    processIsAlive?: RuntimeProcessIsAlive
    beforeStaleReclaim?: (path: string, expectedRaw: string) => void | Promise<void>
  } = {}
): Promise<RuntimeDataDirMigrationLock> {
  const pid = options.pid ?? process.pid
  const now = options.now ?? (() => new Date())
  const processIsAlive = options.processIsAlive ?? runtimeProcessIsAlive
  const path = runtimeDataDirMigrationLockPath(dataDir)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const writerClaim = await acquireRuntimeDataDirWriterClaim(dataDir, 'migration', {
    pid,
    now,
    processIsAlive
  })
  try {
    await assertRuntimeDataDirLeaseInactive(dataDir, {
      pid,
      processIsAlive,
      beforeStaleReclaim: options.beforeStaleReclaim
    })
  } catch (error) {
    await writerClaim.release().catch(() => undefined)
    throw error
  }
  const processIdentity = runtimeProcessIdentity(pid)
  const owner: RuntimeDataDirMigrationLockOwner = {
    schemaVersion: 1,
    pid,
    token: randomUUID(),
    startedAt: now().toISOString(),
    ...(processIdentity ? { processIdentity } : {}),
    dataDir: resolve(dataDir)
  }
  try {
    for (;;) {
      let created = false
      try {
        const handle = await open(path, 'wx', 0o600)
        created = true
        try {
          await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        break
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) {
          if (created) await unlink(path).catch(() => undefined)
          throw error
        }
      }
      await assertRuntimeDataDirMigrationInactive(dataDir, {
        pid,
        processIsAlive,
        beforeStaleReclaim: options.beforeStaleReclaim
      })
    }
    await assertRuntimeDataDirLeaseInactive(dataDir, {
      pid,
      processIsAlive,
      beforeStaleReclaim: options.beforeStaleReclaim
    })
  } catch (error) {
    const current = parseOwner(await readFile(path, 'utf8').catch(() => ''))
    if (current?.token === owner.token) await unlink(path).catch(() => undefined)
    await writerClaim.release().catch(() => undefined)
    throw error
  }
  let released = false
  return {
    path,
    claimPath: writerClaim.path,
    release: async () => {
      if (released) return
      released = true
      let firstError: unknown
      let current: RuntimeDataDirMigrationLockOwner | null = null
      try {
        current = parseOwner(await readFile(path, 'utf8'))
      } catch (error) {
        if (!isErrno(error, 'ENOENT')) firstError = error
      }
      if (current?.token === owner.token) {
        try {
          await unlink(path)
        } catch (error) {
          if (!isErrno(error, 'ENOENT') && firstError === undefined) firstError = error
        }
      }
      try {
        await writerClaim.release()
      } catch (error) {
        if (firstError === undefined) firstError = error
      }
      if (firstError !== undefined) throw firstError
    }
  }
}
