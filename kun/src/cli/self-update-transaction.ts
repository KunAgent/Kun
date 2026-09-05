import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import semver from 'semver'
import {
  isValidRuntimeProcessIdentity,
  runtimeProcessIdentity,
  runtimeProcessIsAlive,
  type RuntimeProcessIsAlive
} from '../server/runtime-process-identity.js'
import { fsyncDirectory } from './self-update-layout.js'

export const KUN_TUI_UPDATE_KILL_POINT_ENV = 'KUN_TUI_UPDATE_KILL_POINT'

/** SIGKILL self when KUN_TUI_UPDATE_KILL_POINT names this point (fault injection). */
export function checkTuiUpdateKillPoint(point: string): void {
  if (process.env[KUN_TUI_UPDATE_KILL_POINT_ENV] === point) {
    process.kill(process.pid, 'SIGKILL')
  }
}

export const TUI_UPDATE_LOCK_SUFFIX = '.kun-tui-update.lock'
export const TUI_UPDATE_TRANSACTION_DIR_SUFFIX = '.kun-tui-update'
export const TUI_UPDATE_TRANSACTION_FILE = 'transaction.json'
export const TUI_UPDATE_RESULT_FILE = 'update-result.json'
export const TUI_UPDATE_LOG_FILE = 'update.log'
export const TUI_UPDATE_UPDATER_FILE = 'updater.json'

export type TuiUpdateLock = {
  path: string
  token: string
  release(): Promise<void>
}

export type TuiUpdateTransaction = {
  schemaVersion: 1
  previousVersion: string
  targetVersion: string
  buildId: string
  installRoot: string
  stagingRoot: string
  backupRoot: string
  pid: number
  token: string
  startedAt: string
  // Optional pointer-layout fields (schemaVersion stays 1).
  fromReleaseDir?: string
  toReleaseDir?: string
  pointerPath?: string
}

export type TuiUpdateResult = {
  schemaVersion: 1
  status: 'succeeded' | 'failed'
  stage?: string
  error?: string
  previousVersion: string
  targetVersion: string
  finishedAt: string
}

export type TuiUpdateUpdater = {
  schemaVersion: 1
  pid: number
  token: string
  startedAt: string
  processIdentity?: string
}

export type TuiUpdateReconcileReport =
  | { kind: 'activated'; previousVersion: string; targetVersion: string }
  | { kind: 'failed'; message: string; stage?: string }
  | { kind: 'busy'; pid: number }

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
}

export function tuiUpdateLockPath(installRoot: string): string {
  const canonical = resolve(installRoot)
  return join(dirname(canonical), `.${basename(canonical)}${TUI_UPDATE_LOCK_SUFFIX}`)
}

export function tuiUpdateTransactionDir(installRoot: string): string {
  const canonical = resolve(installRoot)
  return join(dirname(canonical), `.${basename(canonical)}${TUI_UPDATE_TRANSACTION_DIR_SUFFIX}`)
}

export function tuiUpdateTransactionPath(installRoot: string): string {
  return join(tuiUpdateTransactionDir(installRoot), TUI_UPDATE_TRANSACTION_FILE)
}

export function tuiUpdateResultPath(installRoot: string): string {
  return join(tuiUpdateTransactionDir(installRoot), TUI_UPDATE_RESULT_FILE)
}

export function tuiUpdateLogPath(installRoot: string): string {
  return join(tuiUpdateTransactionDir(installRoot), TUI_UPDATE_LOG_FILE)
}

export function tuiUpdateUpdaterPath(installRoot: string): string {
  return join(tuiUpdateTransactionDir(installRoot), TUI_UPDATE_UPDATER_FILE)
}

export function parseTuiUpdateTransaction(raw: string): TuiUpdateTransaction | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TuiUpdateTransaction>
    return parsed.schemaVersion === 1 &&
      typeof parsed.previousVersion === 'string' &&
      typeof parsed.targetVersion === 'string' &&
      typeof parsed.buildId === 'string' &&
      /^[a-f0-9]{64}$/.test(parsed.buildId) &&
      typeof parsed.installRoot === 'string' &&
      typeof parsed.stagingRoot === 'string' &&
      typeof parsed.backupRoot === 'string' &&
      Number.isSafeInteger(parsed.pid) &&
      (parsed.pid ?? 0) > 0 &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      typeof parsed.startedAt === 'string' &&
      (parsed.fromReleaseDir === undefined || typeof parsed.fromReleaseDir === 'string') &&
      (parsed.toReleaseDir === undefined || typeof parsed.toReleaseDir === 'string') &&
      (parsed.pointerPath === undefined || typeof parsed.pointerPath === 'string')
      ? parsed as TuiUpdateTransaction
      : null
  } catch {
    return null
  }
}

export function parseTuiUpdateResult(raw: string): TuiUpdateResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TuiUpdateResult>
    return parsed.schemaVersion === 1 &&
      (parsed.status === 'succeeded' || parsed.status === 'failed') &&
      typeof parsed.previousVersion === 'string' &&
      typeof parsed.targetVersion === 'string' &&
      typeof parsed.finishedAt === 'string' &&
      (parsed.stage === undefined || typeof parsed.stage === 'string') &&
      (parsed.error === undefined || typeof parsed.error === 'string')
      ? parsed as TuiUpdateResult
      : null
  } catch {
    return null
  }
}

export function parseTuiUpdateUpdater(raw: string): TuiUpdateUpdater | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TuiUpdateUpdater>
    return parsed.schemaVersion === 1 &&
      Number.isSafeInteger(parsed.pid) &&
      (parsed.pid ?? 0) > 0 &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      typeof parsed.startedAt === 'string' &&
      isValidRuntimeProcessIdentity(parsed.processIdentity)
      ? parsed as TuiUpdateUpdater
      : null
  } catch {
    return null
  }
}

export function parseLockOwner(raw: string): {
  schemaVersion: 1
  pid: number
  token: string
  startedAt: string
  processIdentity?: string
  root: string
} | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return parsed.schemaVersion === 1 &&
      Number.isSafeInteger(parsed.pid) &&
      (parsed.pid as number) > 0 &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      typeof parsed.startedAt === 'string' &&
      isValidRuntimeProcessIdentity(parsed.processIdentity) &&
      typeof parsed.root === 'string' &&
      parsed.root.length > 0
      ? parsed as never
      : null
  } catch {
    return null
  }
}

/**
 * Serialize self-updates for one install root across every Kun TUI process.
 * Follows the same exclusive-create + liveness reclaim pattern as the runtime
 * data-dir migration lock: a dead owner's file is renamed away, verified to be
 * byte-identical to what was read, then removed, so a live replacement lock is
 * never deleted by path alone.
 */
export async function acquireTuiUpdateLock(
  installRoot: string,
  options: {
    pid?: number
    processIsAlive?: RuntimeProcessIsAlive
  } = {}
): Promise<TuiUpdateLock> {
  const pid = options.pid ?? process.pid
  const processIsAlive = options.processIsAlive ?? runtimeProcessIsAlive
  const canonical = resolve(installRoot)
  const path = tuiUpdateLockPath(canonical)
  const token = randomUUID()
  const record = {
    schemaVersion: 1 as const,
    pid,
    token,
    startedAt: new Date().toISOString(),
    ...(runtimeProcessIdentity(pid) ? { processIdentity: runtimeProcessIdentity(pid) } : {}),
    root: canonical
  }
  await mkdir(dirname(path), { recursive: true })
  for (;;) {
    let created = false
    try {
      const handle = await open(path, 'wx', 0o600)
      created = true
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8')
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
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) continue
      throw new Error(`could not inspect Kun TUI update lock at ${path}`, { cause: error })
    }
    const owner = parseLockOwner(raw)
    if (!owner) throw new Error(`Kun TUI update lock is invalid: ${path}`)
    if (processIsAlive(owner.pid, owner)) {
      throw new Error(
        `another Kun TUI update is already running in process ${owner.pid}; ` +
        'retry after it finishes'
      )
    }
    // Reclaim the exact dead-owner bytes without deleting a live replacement.
    const displacedPath = `${path}.stale-${pid}-${randomUUID()}`
    try {
      await rename(path, displacedPath)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) continue
      throw error
    }
    const displacedRaw = await readFile(displacedPath, 'utf8').catch((error) => {
      throw new Error(`could not verify displaced Kun TUI update lock at ${displacedPath}`, {
        cause: error
      })
    })
    if (displacedRaw !== raw) {
      // A live contender replaced the lock while we reclaimed; restore it and fail.
      try {
        const { link } = await import('node:fs/promises')
        await link(displacedPath, path)
        await unlink(displacedPath)
      } catch (restoreError) {
        throw new Error(
          `Kun TUI update lock changed during stale-owner recovery; ` +
          `the displaced live record was preserved at ${displacedPath}`,
          { cause: restoreError }
        )
      }
      throw new Error('Kun TUI update lock owner changed during stale-owner recovery')
    }
    await rm(displacedPath, { force: true })
  }
  let released = false
  return {
    path,
    token,
    release: async () => {
      if (released) return
      released = true
      const current = parseLockOwner(await readFile(path, 'utf8').catch(() => ''))
      if (current?.token === token) {
        await unlink(path).catch((error) => {
          if (!isErrno(error, 'ENOENT')) throw error
        })
      }
    }
  }
}

/** Persist the pending replacement so a later launch can finish or report it. */
export async function writeTuiUpdateTransaction(
  installRoot: string,
  input: {
    previousVersion: string
    targetVersion: string
    buildId: string
    stagingRoot: string
    backupRoot: string
    fromReleaseDir?: string
    toReleaseDir?: string
    pointerPath?: string
  }
): Promise<TuiUpdateTransaction> {
  const canonical = resolve(installRoot)
  const dir = tuiUpdateTransactionDir(canonical)
  const transaction: TuiUpdateTransaction = {
    schemaVersion: 1,
    previousVersion: input.previousVersion,
    targetVersion: input.targetVersion,
    buildId: input.buildId,
    installRoot: canonical,
    stagingRoot: resolve(input.stagingRoot),
    backupRoot: resolve(input.backupRoot),
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
    ...(input.fromReleaseDir ? { fromReleaseDir: resolve(input.fromReleaseDir) } : {}),
    ...(input.toReleaseDir ? { toReleaseDir: resolve(input.toReleaseDir) } : {}),
    ...(input.pointerPath ? { pointerPath: resolve(input.pointerPath) } : {})
  }
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, TUI_UPDATE_TRANSACTION_FILE)
  await writeFileAtomically(path, `${JSON.stringify(transaction, null, 2)}\n`)
  return transaction
}

export async function writeTuiUpdateResult(
  installRoot: string,
  result: Omit<TuiUpdateResult, 'schemaVersion' | 'finishedAt'>
): Promise<void> {
  const path = tuiUpdateResultPath(installRoot)
  await mkdir(dirname(path), { recursive: true })
  const record: TuiUpdateResult = {
    schemaVersion: 1,
    ...result,
    finishedAt: new Date().toISOString()
  }
  await writeFileAtomically(path, `${JSON.stringify(record, null, 2)}\n`)
}

/** Persist the detached updater's identity after it confirmed the lock handoff. */
export async function recordTuiUpdateUpdater(
  installRoot: string,
  updater: TuiUpdateUpdater
): Promise<void> {
  const path = tuiUpdateUpdaterPath(installRoot)
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomically(path, `${JSON.stringify(updater, null, 2)}\n`)
}

async function writeFileAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
  await fsyncDirectory(dirname(path))
}

/** Remove transaction metadata but keep the diagnostic log for inspection. */
export async function clearTuiUpdateTransaction(installRoot: string): Promise<void> {
  const dir = tuiUpdateTransactionDir(installRoot)
  for (const name of [
    TUI_UPDATE_TRANSACTION_FILE,
    TUI_UPDATE_RESULT_FILE,
    TUI_UPDATE_UPDATER_FILE
  ]) {
    await rm(join(dir, name), { force: true }).catch(() => undefined)
  }
  try {
    const entries = await readdir(dir)
    if (!entries.length) await rm(dir, { recursive: true, force: true })
  } catch {
    // Directory already gone.
  }
}

/** True when the installed release already satisfies the update target. */
export function installedReleaseSatisfies(
  installed: { version: string } | null,
  targetVersion: string
): boolean {
  if (!installed || !semver.valid(installed.version)) return false
  return semver.gte(installed.version, targetVersion)
}
