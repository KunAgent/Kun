import { join } from 'node:path'
import {
  acquireExclusiveFileLock,
  assertExclusiveFileLockHeld,
  ExclusiveFileLockOwnershipError,
  ExclusiveFileLockTimeoutError,
  releaseExclusiveFileLock as releaseMcpLock,
  type ExclusiveFileLockOptions as McpLockOptions,
  type ExclusiveFileLockOwner as McpLockOwner
} from '../adapters/file/exclusive-file-lock.js'

export {
  breakStaleExclusiveFileLock as breakStaleMcpLock,
  exclusiveFileLockBreakClaimPath as mcpLockBreakClaimPath,
  isProcessAlive
} from '../adapters/file/exclusive-file-lock.js'
export { releaseMcpLock, type McpLockOptions, type McpLockOwner }

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

function defaultTimeoutMs(): number {
  // Test and diagnostic hook; production uses the 30s default.
  const fromEnv = Number(process.env.KUN_MCP_LOCK_TIMEOUT_MS)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_TIMEOUT_MS
}

export async function assertMcpLockHeld(lockPath: string, owner: McpLockOwner): Promise<void> {
  try {
    await assertExclusiveFileLockHeld(lockPath, owner)
  } catch (error) {
    if (error instanceof ExclusiveFileLockOwnershipError) {
      throw new McpLockOwnershipError(`MCP lock ${lockPath} is no longer owned by this process`)
    }
    throw error
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

export async function acquireMcpLock(lockPath: string, options: McpLockOptions = {}): Promise<McpLockOwner> {
  try {
    return await acquireExclusiveFileLock(lockPath, { ...options, timeoutMs: options.timeoutMs ?? defaultTimeoutMs() })
  } catch (error) {
    if (error instanceof ExclusiveFileLockTimeoutError) throw new McpLockTimeoutError(lockPath, error.diagnostics)
    throw error
  }
}
