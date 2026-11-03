import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Cross-process mutual exclusion for the MCP configuration files.
 *
 * `config.json`, `mcp.json` and the recovery record are separate files, so no
 * rename can commit them together. Every cooperating writer (Runtime mutation,
 * GUI synchronization, plugin IPC write, recovery) therefore serializes on one
 * lock file and performs read-modify-write while holding it. The lock itself is
 * only ever created with `O_EXCL`; it is never replaced by a check-then-rename.
 *
 * A dead owner is broken by exactly one breaker: the breaker claims the dead
 * owner token with an `O_EXCL` file, re-reads the lock under that claim, and
 * only removes it if the token is unchanged. Because creators cannot publish a
 * new lock while the path exists, and unlinkers are serialized per token by the
 * claim, a second breaker can never remove the lock that the first breaker has
 * already published. An unreadable owner or an unclaimed foreign host is
 * treated as held: an unreadable owner is not evidence of absence.
 */
export type McpLockOwner = {
  version: 1
  token: string
  pid: number
  host: string
  createdAt: string
}

export type McpLockOptions = {
  timeoutMs?: number
  pollMs?: number
}

/** Lock that serializes the Runtime data-directory MCP state. */
export function mcpDataLockPath(dataDir: string): string {
  return join(dataDir, 'mcp-config.lock')
}

/** The shared `mcp.json` document gets its own lock, keyed by its own path. */
export function sharedMcpLockPath(sharedPath: string): string {
  return `${sharedPath}.lock`
}

export async function withSharedMcpLock<T>(
  sharedPath: string,
  operation: (owner: McpLockOwner) => Promise<T>,
  options: McpLockOptions = {}
): Promise<T> {
  return withMcpLock(sharedMcpLockPath(sharedPath), operation, options)
}

export class McpLockTimeoutError extends Error {
  constructor(readonly lockPath: string, readonly diagnostics?: string) {
    super(
      `Timed out waiting for the MCP configuration lock ${lockPath}` +
      (diagnostics ? `; ${diagnostics}` : '')
    )
    this.name = 'McpLockTimeoutError'
  }
}

export class McpLockOwnershipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpLockOwnershipError'
  }
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_POLL_MS = 10

function defaultTimeoutMs(): number {
  // Test and diagnostic hook; production uses the 30s default.
  const fromEnv = Number(process.env.KUN_MCP_LOCK_TIMEOUT_MS)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_TIMEOUT_MS
}

export function mcpLockBreakClaimPath(lockPath: string, token: string): string {
  return `${lockPath}.break-${token}`
}

/** Fence check for a commit that can await: the lock must still be ours. */
export async function assertMcpLockHeld(lockPath: string, owner: McpLockOwner): Promise<void> {
  const current = await readLockOwner(lockPath)
  if (current.state !== 'owned' || current.owner.token !== owner.token) {
    throw new McpLockOwnershipError(`MCP lock ${lockPath} is no longer owned by this process`)
  }
}

export async function withMcpLock<T>(
  lockPath: string,
  operation: (owner: McpLockOwner) => Promise<T>,
  options: McpLockOptions = {}
): Promise<T> {
  const owner = await acquireMcpLock(lockPath, options)
  try {
    return await operation(owner)
  } finally {
    await releaseMcpLock(lockPath, owner).catch(() => undefined)
  }
}

export async function acquireMcpLock(
  lockPath: string,
  options: McpLockOptions = {}
): Promise<McpLockOwner> {
  const owner: McpLockOwner = {
    version: 1,
    token: randomUUID(),
    pid: process.pid,
    host: hostname(),
    createdAt: new Date().toISOString()
  }
  const deadline = Date.now() + (options.timeoutMs ?? defaultTimeoutMs())
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  await mkdir(dirname(lockPath), { recursive: true })
  for (;;) {
    if (await tryCreateLock(lockPath, owner)) return owner
    const current = await readLockOwner(lockPath)
    if (current.state === 'owned' && breakableOwner(current.owner)) {
      // Exactly one breaker can publish the removal for this token.
      if (await breakStaleMcpLock(lockPath, current.owner)) continue
    }
    if (Date.now() >= deadline) {
      throw new McpLockTimeoutError(lockPath, await describeLockConflict(lockPath, current))
    }
    await delay(pollMs)
  }
}

export async function releaseMcpLock(lockPath: string, owner: McpLockOwner): Promise<void> {
  const current = await readLockOwner(lockPath)
  // Never remove a lock that another process now owns. An unreadable owner is
  // left in place so the next acquirer fails closed instead of racing.
  if (current.state !== 'owned' || current.owner.token !== owner.token) return
  await rm(lockPath, { force: true })
}

async function tryCreateLock(lockPath: string, owner: McpLockOwner): Promise<boolean> {
  let handle
  try {
    handle = await open(lockPath, 'wx', 0o600)
  } catch (error) {
    if (isErrnoCode(error, 'EEXIST')) return false
    throw error
  }
  try {
    await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, 'utf8')
    await handle.sync()
  } catch (error) {
    // Nobody can take over an owner-less lock, so removing our own new file is
    // safe and avoids leaving a permanent block behind.
    await handle.close().catch(() => undefined)
    await rm(lockPath, { force: true }).catch(() => undefined)
    throw error
  }
  await handle.close()
  return true
}

function breakableOwner(owner: McpLockOwner): boolean {
  return owner.host === hostname() && !isProcessAlive(owner.pid)
}

/**
 * Remove a lock whose owner is dead. Only the claim holder may unlink it, and
 * only while the token is still the one it observed; a breaker can therefore
 * never remove a lock that a competing breaker has already re-created.
 * Returns false when another breaker holds the claim (the caller keeps
 * polling) or when the lock changed while this breaker was claiming it.
 */
export async function breakStaleMcpLock(
  lockPath: string,
  expected: McpLockOwner
): Promise<boolean> {
  if (!breakableOwner(expected)) return false
  const claimPath = mcpLockBreakClaimPath(lockPath, expected.token)
  const claim: McpLockOwner = {
    version: 1,
    token: randomUUID(),
    pid: process.pid,
    host: hostname(),
    createdAt: new Date().toISOString()
  }
  if (!(await tryCreateLock(claimPath, claim))) return false
  try {
    const current = await readLockOwner(lockPath)
    if (current.state === 'missing') return true
    if (current.state !== 'owned') return false
    // Creators cannot publish while the path exists, and every unlinker for
    // this token is serialized by the claim, so this check cannot go stale.
    if (current.owner.token !== expected.token) return false
    if (current.owner.pid !== expected.pid) return false
    if (current.owner.host !== expected.host) return false
    if (isProcessAlive(current.owner.pid)) return false
    await rm(lockPath, { force: true })
    return true
  } finally {
    await rm(claimPath, { force: true }).catch(() => undefined)
  }
}

type LockOwnerRead =
  | { state: 'missing' }
  | { state: 'unreadable'; reason: string }
  | { state: 'owned'; owner: McpLockOwner }

async function readLockOwner(lockPath: string): Promise<LockOwnerRead> {
  let text: string
  try {
    text = await readFile(lockPath, 'utf8')
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return { state: 'missing' }
    return { state: 'unreadable', reason: errorMessage(error) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { state: 'unreadable', reason: 'lock owner is not valid JSON' }
  }
  if (!isLockOwner(parsed)) return { state: 'unreadable', reason: 'lock owner is incomplete' }
  return { state: 'owned', owner: parsed }
}

function isLockOwner(value: unknown): value is McpLockOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.version === 1 &&
    typeof record.token === 'string' && record.token.length > 0 &&
    typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0 &&
    typeof record.host === 'string' &&
    typeof record.createdAt === 'string'
}

/** Shared with the recovery record: liveness decides whether an owner is gone. */
export function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return !isErrnoCode(error, 'ESRCH')
  }
}

/**
 * Operator-facing state for a lock that could not be acquired. A crashed
 * stale-lock breaker leaves its claim behind on purpose: automatic recovery
 * would have to guess whether the lock changed, so the lock stays unavailable
 * and this text explains exactly which file to remove once it is safe.
 */
async function describeLockConflict(lockPath: string, current: LockOwnerRead): Promise<string> {
  if (current.state === 'missing') return 'the lock file disappeared while waiting'
  if (current.state === 'unreadable') {
    return `the lock owner cannot be read (${current.reason}); remove ${lockPath} only after confirming no process uses it`
  }
  const owner = current.owner
  const parts = [
    `owner pid ${owner.pid} on ${owner.host} since ${owner.createdAt} is ${isProcessAlive(owner.pid) ? 'alive' : 'gone'}`
  ]
  const claimPath = mcpLockBreakClaimPath(lockPath, owner.token)
  const claim = await readLockOwner(claimPath)
  if (claim.state === 'owned') {
    parts.push(
      `stale-lock break claim ${claimPath} is held by pid ${claim.owner.pid} since ${claim.owner.createdAt}` +
      (isProcessAlive(claim.owner.pid) ? ' (alive)' : ' (process is gone)') +
      `; if no process is running, remove ${claimPath} to restore the lock`
    )
  } else if (claim.state === 'unreadable') {
    parts.push(
      `stale-lock break claim ${claimPath} is unreadable (${claim.reason}); remove it only after confirming no process is running`
    )
  }
  return parts.join('; ')
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))
}
