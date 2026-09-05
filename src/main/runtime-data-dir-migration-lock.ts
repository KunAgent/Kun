import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  runtimeDataDirClaimsPath,
  runtimeDataDirMigrationLockPath,
  runtimeDataDirOwnerPath
} from '../../kun/src/server/runtime-data-dir-migration-lock.js'
import {
  isValidRuntimeProcessIdentity,
  runtimeProcessIdentity,
  runtimeProcessIsAlive,
  type RuntimeProcessIsAlive
} from '../../kun/src/server/runtime-process-identity.js'

type MigrationLockOwner = {
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

type RuntimeDataDirWriterClaim = {
  schemaVersion: 1
  kind: 'runtime' | 'migration' | 'config' | 'ancillary'
  pid: number
  token: string
  startedAt: string
  processIdentity?: string
  dataDir: string
}

export type CanonicalRuntimeMigrationLock = {
  paths: string[]
  claimPaths: string[]
  release(): void
}

export function runtimeMigrationAllowsPostMigrationSettingsWrite(
  status: 'not-needed' | 'completed' | 'blocked'
): boolean {
  return status !== 'blocked'
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

function parseOwner(raw: string): MigrationLockOwner | null {
  try {
    const value = JSON.parse(raw) as Partial<MigrationLockOwner>
    return value.schemaVersion === 1 &&
      Number.isSafeInteger(value.pid) &&
      (value.pid ?? 0) > 0 &&
      typeof value.token === 'string' &&
      value.token.length > 0 &&
      typeof value.startedAt === 'string' &&
      isValidRuntimeProcessIdentity(value.processIdentity) &&
      typeof value.dataDir === 'string' &&
      value.dataDir.length > 0
      ? value as MigrationLockOwner
      : null
  } catch {
    return null
  }
}

function parseRuntimeOwner(raw: string): RuntimeDataDirOwner | null {
  try {
    const value = JSON.parse(raw) as Partial<RuntimeDataDirOwner>
    return value.schemaVersion === 1 &&
      Number.isSafeInteger(value.pid) &&
      (value.pid ?? 0) > 0 &&
      typeof value.token === 'string' &&
      value.token.length > 0 &&
      typeof value.startedAt === 'string' &&
      isValidRuntimeProcessIdentity(value.processIdentity)
      ? value as RuntimeDataDirOwner
      : null
  } catch {
    return null
  }
}

function parseWriterClaim(raw: string): RuntimeDataDirWriterClaim | null {
  try {
    const value = JSON.parse(raw) as Partial<RuntimeDataDirWriterClaim>
    return value.schemaVersion === 1 &&
      (
        value.kind === 'runtime' ||
        value.kind === 'migration' ||
        value.kind === 'config' ||
        value.kind === 'ancillary'
      ) &&
      Number.isSafeInteger(value.pid) &&
      (value.pid ?? 0) > 0 &&
      typeof value.token === 'string' &&
      value.token.length > 0 &&
      typeof value.startedAt === 'string' &&
      isValidRuntimeProcessIdentity(value.processIdentity) &&
      typeof value.dataDir === 'string' &&
      value.dataDir.length > 0
      ? value as RuntimeDataDirWriterClaim
      : null
  } catch {
    return null
  }
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

function acquireWriterClaimSync(
  dataDir: string,
  input: {
    pid: number
    now: () => Date
    processIsAlive: RuntimeProcessIsAlive
  }
): { path: string; owner: RuntimeDataDirWriterClaim } {
  const canonicalDataDir = resolve(dataDir)
  const claimsPath = runtimeDataDirClaimsPath(canonicalDataDir)
  mkdirSync(claimsPath, { recursive: true, mode: 0o700 })
  const token = randomUUID()
  const path = join(claimsPath, writerClaimFilename(input.pid, token))
  const processIdentity = runtimeProcessIdentity(input.pid)
  const owner: RuntimeDataDirWriterClaim = {
    schemaVersion: 1,
    kind: 'migration',
    pid: input.pid,
    token,
    startedAt: input.now().toISOString(),
    ...(processIdentity ? { processIdentity } : {}),
    dataDir: canonicalDataDir
  }
  let handle: number | undefined
  try {
    handle = openSync(path, 'wx', 0o600)
    writeFileSync(handle, `${JSON.stringify(owner, null, 2)}\n`, 'utf8')
    fsyncSync(handle)
    closeSync(handle)
    handle = undefined
    for (const entry of readdirSync(claimsPath, { withFileTypes: true })) {
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
        raw = readFileSync(contenderPath, 'utf8')
      } catch (error) {
        if (errnoCode(error) === 'ENOENT') continue
        throw error
      }
      const contender = parseWriterClaim(raw)
      if (
        !contender ||
        contender.pid !== contenderPid ||
        contender.dataDir !== canonicalDataDir ||
        writerClaimFilename(contender.pid, contender.token) !== entry.name
      ) {
        if (!input.processIsAlive(contenderPid)) {
          try { unlinkSync(contenderPath) } catch (error) {
            if (errnoCode(error) !== 'ENOENT') throw error
          }
          continue
        }
        throw new Error(`Kun Runtime writer claim is invalid: ${contenderPath}`)
      }
      if (input.processIsAlive(contender.pid, contender)) {
        throw new Error(
          contender.kind === 'migration'
            ? `Kun Runtime data migration is already active in process ${contender.pid}`
            : contender.kind === 'config'
              ? `Kun Runtime config synchronization is active in process ${contender.pid}`
              : contender.kind === 'ancillary'
                ? `Kun Runtime ancillary data write is active in process ${contender.pid}`
                : `Kun Runtime data directory is already owned by active process ${contender.pid}: ${dataDir}`
        )
      }
      try { unlinkSync(contenderPath) } catch (error) {
        if (errnoCode(error) !== 'ENOENT') throw error
      }
    }
    return { path, owner }
  } catch (error) {
    if (handle !== undefined) closeSync(handle)
    try { unlinkSync(path) } catch { /* preserve the acquisition failure */ }
    throw error
  }
}

function fsyncParentBestEffort(path: string): void {
  try {
    const handle = openSync(dirname(path), 'r')
    try {
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
  } catch {
    // Windows does not consistently allow directory fsync.
  }
}

function restoreDisplacedLockSync(path: string, displacedPath: string): void {
  try {
    linkSync(displacedPath, path)
    unlinkSync(displacedPath)
  } catch (error) {
    throw new Error(
      `Kun Runtime lock changed during stale-owner recovery; ` +
      `the displaced live record was preserved at ${displacedPath}`,
      { cause: error }
    )
  }
}

function reclaimLockFileIfUnchangedSync(
  path: string,
  expectedRaw: string,
  input: {
    pid: number
    beforeReclaim?: (path: string, expectedRaw: string) => void
  }
): void {
  input.beforeReclaim?.(path, expectedRaw)
  const displacedPath = `${path}.stale-${input.pid}-${randomUUID()}`
  try {
    renameSync(path, displacedPath)
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return
    throw error
  }
  let displacedRaw: string
  try {
    displacedRaw = readFileSync(displacedPath, 'utf8')
  } catch (error) {
    throw new Error(`could not verify displaced Kun Runtime lock at ${displacedPath}`, {
      cause: error
    })
  }
  if (displacedRaw !== expectedRaw) {
    restoreDisplacedLockSync(path, displacedPath)
    throw new Error('Kun Runtime lock owner changed during stale-owner recovery')
  }
  rmSync(displacedPath, { force: true })
}

function assertRuntimeDataDirLeaseInactiveSync(
  dataDir: string,
  input: {
    pid: number
    processIsAlive: RuntimeProcessIsAlive
    beforeReclaim?: (path: string, expectedRaw: string) => void
  }
): void {
  const path = runtimeDataDirOwnerPath(dataDir)
  for (;;) {
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return
      throw error
    }
    const owner = parseRuntimeOwner(raw)
    if (!owner) throw new Error(`Kun Runtime data directory owner record is invalid: ${path}`)
    if (input.processIsAlive(owner.pid, owner)) {
      throw new Error(
        `Kun Runtime data directory is already owned by active process ${owner.pid}: ${dataDir}`
      )
    }
    reclaimLockFileIfUnchangedSync(path, raw, input)
  }
}

/**
 * Synchronous startup fence used before any Manager or Runtime is elected.
 * Multiple canonical roots are acquired in sorted order to avoid deadlock.
 */
export function acquireCanonicalRuntimeMigrationLock(
  dataDirs: readonly string[],
  options: {
    pid?: number
    now?: () => Date
    processIsAlive?: RuntimeProcessIsAlive
    beforeStaleReclaim?: (path: string, expectedRaw: string) => void
    unlinkLock?: (path: string) => void
  } = {}
): CanonicalRuntimeMigrationLock {
  const pid = options.pid ?? process.pid
  const now = options.now ?? (() => new Date())
  const isAlive = options.processIsAlive ?? runtimeProcessIsAlive
  const unlinkLock = options.unlinkLock ?? unlinkSync
  const canonicalDirs = [...new Set(dataDirs.map((path) => resolve(path)))].sort()
  const owned: Array<{ path: string; owner: MigrationLockOwner }> = []
  const claims: Array<{ path: string; owner: RuntimeDataDirWriterClaim }> = []
  try {
    for (const dataDir of canonicalDirs) {
      claims.push(acquireWriterClaimSync(dataDir, {
        pid,
        now,
        processIsAlive: isAlive
      }))
      const path = runtimeDataDirMigrationLockPath(dataDir)
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      assertRuntimeDataDirLeaseInactiveSync(dataDir, {
        pid,
        processIsAlive: isAlive,
        beforeReclaim: options.beforeStaleReclaim
      })
      const processIdentity = runtimeProcessIdentity(pid)
      const owner: MigrationLockOwner = {
        schemaVersion: 1,
        pid,
        token: randomUUID(),
        startedAt: now().toISOString(),
        ...(processIdentity ? { processIdentity } : {}),
        dataDir
      }
      for (;;) {
        let handle: number | undefined
        let created = false
        try {
          handle = openSync(path, 'wx', 0o600)
          created = true
          writeFileSync(handle, `${JSON.stringify(owner, null, 2)}\n`, 'utf8')
          fsyncSync(handle)
          closeSync(handle)
          handle = undefined
          fsyncParentBestEffort(path)
          owned.push({ path, owner })
          break
        } catch (error) {
          if (handle !== undefined) closeSync(handle)
          if (errnoCode(error) !== 'EEXIST') {
            // A failed first write may have created an incomplete file. Remove
            // only the path this process just won exclusively.
            if (created) {
              try { unlinkSync(path) } catch { /* preserve the original error */ }
            }
            throw error
          }
        }
        let currentRaw: string
        try {
          currentRaw = readFileSync(path, 'utf8')
        } catch (error) {
          if (errnoCode(error) === 'ENOENT') continue
          throw error
        }
        const current = parseOwner(currentRaw)
        if (!current) throw new Error(`Kun Runtime migration lock is invalid: ${path}`)
        if (isAlive(current.pid, current)) {
          throw new Error(
            `Kun Runtime data migration is already active in process ${current.pid}`
          )
        }
        reclaimLockFileIfUnchangedSync(path, currentRaw, {
          pid,
          beforeReclaim: options.beforeStaleReclaim
        })
      }
      assertRuntimeDataDirLeaseInactiveSync(dataDir, {
        pid,
        processIsAlive: isAlive,
        beforeReclaim: options.beforeStaleReclaim
      })
    }
  } catch (error) {
    try {
      releaseOwnedLocks(owned, claims, unlinkLock)
    } catch {
      // Preserve the acquisition failure; release attempted every owned root.
    }
    throw error
  }
  let released = false
  return {
    paths: owned.map(({ path }) => path),
    claimPaths: claims.map(({ path }) => path),
    release: () => {
      if (released) return
      released = true
      releaseOwnedLocks(owned, claims, unlinkLock)
    }
  }
}

function parseOwnerSafe(path: string): MigrationLockOwner | null {
  try {
    return parseOwner(readFileSync(path, 'utf8'))
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null
    throw error
  }
}

function releaseOwnedLocks(
  owned: readonly { path: string; owner: MigrationLockOwner }[],
  claims: readonly { path: string; owner: RuntimeDataDirWriterClaim }[],
  unlinkLock: (path: string) => void
): void {
  let firstError: unknown
  for (const { path, owner } of [...owned].reverse()) {
    try {
      const current = parseOwnerSafe(path)
      if (current?.token !== owner.token) continue
      unlinkLock(path)
      fsyncParentBestEffort(path)
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT' && firstError === undefined) firstError = error
    }
  }
  for (const { path } of [...claims].reverse()) {
    try {
      unlinkLock(path)
      fsyncParentBestEffort(path)
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT' && firstError === undefined) firstError = error
    }
  }
  if (firstError !== undefined) throw firstError
}
