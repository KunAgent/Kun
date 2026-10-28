import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { isProcessAlive, withSharedMcpLock } from './runtime-mcp-lock.js'

/**
 * Durable recovery record for cross-file MCP mutations.
 *
 * `config.json` and the shared `mcp.json` cannot be committed atomically, so a
 * mutation records its transaction (id, owner, affected servers) before the
 * first write and clears it only after both files are durable. Readers treat
 * any record they do not own as evidence of an unfinished mutation.
 *
 * Only a missing file means "no transaction". An unreadable record, an
 * unsupported version or a malformed body is a hard error: it is preserved and
 * callers must refuse to start or synchronize. The same applies to recovery
 * targets that cannot be read or parsed.
 */
export const MCP_TRANSACTION_FILE = 'mcp-transaction.json'
export const MCP_TRANSACTION_VERSION = 2

export type McpTransactionOwner = {
  pid: number
  host: string
  startedAt: string
}

export type McpTransactionPhase = 'active' | 'abandoned'

export type McpTransactionRecord = {
  version: typeof MCP_TRANSACTION_VERSION
  txnId: string
  owner: McpTransactionOwner
  phase: McpTransactionPhase
  startedAt: string
  serverIds: string[]
}

export type McpTransactionRead =
  | { state: 'none' }
  | { state: 'pending'; record: McpTransactionRecord }
  | { state: 'invalid'; reason: string }

export type McpTransactionRecovery = {
  /** Server ids that were in flight; callers must compose them as disabled. */
  serverIds: string[]
  txnId?: string
}

/** The record exists but cannot be trusted; the caller must stop. */
export class McpTransactionStateError extends Error {
  constructor(readonly recordPath: string, readonly reason: string) {
    super(`MCP recovery record ${recordPath} is unusable: ${reason}`)
    this.name = 'McpTransactionStateError'
  }
}

/** Another live owner holds a transaction; the caller must not clear it. */
export class McpTransactionConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpTransactionConflictError'
  }
}

export function mcpTransactionPath(dataDir: string): string {
  return join(dataDir, MCP_TRANSACTION_FILE)
}

export async function readMcpTransaction(dataDir: string): Promise<McpTransactionRead> {
  const path = mcpTransactionPath(dataDir)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return { state: 'none' }
    return { state: 'invalid', reason: `cannot read the record (${errorCode(error)})` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { state: 'invalid', reason: 'the record is not valid JSON' }
  }
  const validated = validateRecord(parsed)
  return validated ? { state: 'pending', record: validated } : {
    state: 'invalid',
    reason: 'the record does not match the supported transaction schema'
  }
}

/** Record a mutation before writing either file. Callers hold the data lock. */
export async function beginMcpTransaction(
  dataDir: string,
  serverIds: string[]
): Promise<McpTransactionRecord> {
  const path = mcpTransactionPath(dataDir)
  const existing = await readMcpTransaction(dataDir)
  if (existing.state === 'invalid') throw new McpTransactionStateError(path, existing.reason)
  if (existing.state === 'pending') {
    throw new McpTransactionConflictError(
      `MCP transaction ${existing.record.txnId} is still pending at ${path}`
    )
  }
  const now = new Date().toISOString()
  const record: McpTransactionRecord = {
    version: MCP_TRANSACTION_VERSION,
    txnId: randomUUID(),
    owner: { pid: process.pid, host: hostname(), startedAt: now },
    phase: 'active',
    startedAt: now,
    serverIds: uniqueServerIds(serverIds)
  }
  await writeRecord(path, record)
  return record
}

/** Only the owning transaction may mark itself abandoned. */
export async function abandonMcpTransaction(dataDir: string, txnId: string): Promise<void> {
  const path = mcpTransactionPath(dataDir)
  const read = await readMcpTransaction(dataDir)
  if (read.state === 'none') return
  if (read.state === 'invalid') throw new McpTransactionStateError(path, read.reason)
  if (read.record.txnId !== txnId) {
    throw new McpTransactionConflictError(
      `MCP transaction ${txnId} no longer owns ${path}`
    )
  }
  if (read.record.phase === 'abandoned') return
  await writeRecord(path, { ...read.record, phase: 'abandoned' })
}

/** Clear the record only for the transaction that owns it. */
export async function endMcpTransaction(dataDir: string, txnId: string): Promise<void> {
  const path = mcpTransactionPath(dataDir)
  const read = await readMcpTransaction(dataDir)
  if (read.state === 'none') return
  if (read.state === 'invalid') throw new McpTransactionStateError(path, read.reason)
  if (read.record.txnId !== txnId) {
    throw new McpTransactionConflictError(
      `MCP transaction ${txnId} no longer owns ${path}`
    )
  }
  await rm(path, { force: true })
}

/**
 * Roll an unfinished mutation back to disabled and clear its record.
 *
 * The caller holds the data-directory lock; this function takes the shared-file
 * lock itself around the shared write. Holding the data lock is what makes "the
 * owner is not running" verifiable: a live owner would still hold that lock. A
 * record that claims to be active and whose owner process is still alive is
 * never cleared.
 */
export async function recoverPendingMcpTransaction(options: {
  dataDir: string
  configPath?: string
  sharedMcpConfigPath?: string
}): Promise<McpTransactionRecovery> {
  const path = mcpTransactionPath(options.dataDir)
  const read = await readMcpTransaction(options.dataDir)
  if (read.state === 'none') return { serverIds: [] }
  if (read.state === 'invalid') throw new McpTransactionStateError(path, read.reason)
  const record = read.record
  if (isLiveOwner(record)) {
    throw new McpTransactionConflictError(
      `MCP transaction ${record.txnId} is still owned by live pid ${record.owner.pid}`
    )
  }
  if (options.configPath) {
    await disableFileServers(options.configPath, 'config.json', record.serverIds)
  }
  if (options.sharedMcpConfigPath) {
    const sharedPath = options.sharedMcpConfigPath
    await withSharedMcpLock(sharedPath, () =>
      disableFileServers(sharedPath, 'the shared MCP file', record.serverIds)
    )
  }
  await endRecoveredTransaction(options.dataDir, record.txnId)
  return { serverIds: record.serverIds, txnId: record.txnId }
}

async function endRecoveredTransaction(dataDir: string, txnId: string): Promise<void> {
  const path = mcpTransactionPath(dataDir)
  const read = await readMcpTransaction(dataDir)
  if (read.state === 'none') return
  if (read.state === 'invalid') throw new McpTransactionStateError(path, read.reason)
  if (read.record.txnId !== txnId) {
    throw new McpTransactionConflictError(
      `MCP recovery for ${txnId} raced with transaction ${read.record.txnId}`
    )
  }
  await rm(path, { force: true })
}

async function disableFileServers(path: string, label: string, serverIds: string[]): Promise<void> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    // A file that does not exist cannot carry an enabled server.
    if (isErrnoCode(error, 'ENOENT')) return
    throw new McpTransactionStateError(
      path,
      `cannot read ${label} (${errorCode(error)}); the recovery record was preserved`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new McpTransactionStateError(
      path,
      `${label} is not valid JSON; the recovery record was preserved`
    )
  }
  if (!isRecord(parsed)) {
    throw new McpTransactionStateError(
      path,
      `${label} is not a JSON object; the recovery record was preserved`
    )
  }
  const patched = disableMcpServersInDocument(parsed, serverIds)
  if (!patched.changed) return
  await atomicWriteFile(path, `${JSON.stringify(patched.document, null, 2)}\n`, { durable: true })
}

/**
 * Flip `enabled` to false for the given ids in either supported file shape.
 * Pure: recovery uses it for the Runtime file and the shared file alike.
 */
export function disableMcpServersInDocument(
  document: Record<string, unknown>,
  serverIds: string[]
): { document: Record<string, unknown>; changed: boolean } {
  let next = document
  let changed = false
  const direct = objectValue(document.servers)
  if (Object.keys(direct).length > 0) {
    const patched = disableWithin(direct, serverIds)
    if (patched.changed) {
      next = { ...next, servers: patched.servers }
      changed = true
    }
  }
  // A file that carries both shapes is ambiguous. Repair the nested copy as
  // well so no reader can still observe an enabled server through the other
  // shape; a single-shape file is handled by the branch it matched.
  const capabilities = objectValue(next.capabilities)
  const mcp = objectValue(capabilities.mcp)
  const nested = objectValue(mcp.servers)
  if (Object.keys(nested).length > 0) {
    const patched = disableWithin(nested, serverIds)
    if (patched.changed) {
      next = {
        ...next,
        capabilities: { ...capabilities, mcp: { ...mcp, servers: patched.servers } }
      }
      changed = true
    }
  }
  return { document: next, changed }
}

function disableWithin(
  servers: Record<string, unknown>,
  serverIds: string[]
): { servers: Record<string, unknown>; changed: boolean } {
  let changed = false
  const next: Record<string, unknown> = { ...servers }
  for (const id of serverIds) {
    if (!Object.hasOwn(next, id)) continue
    const server = objectValue(next[id])
    if (server.enabled === false) continue
    next[id] = { ...server, enabled: false }
    changed = true
  }
  return { servers: next, changed }
}

function isLiveOwner(record: McpTransactionRecord): boolean {
  if (record.phase === 'abandoned') return false
  // The current process is not a concurrent owner: its own mutations are
  // serialized, so a leftover record from this pid is safe to recover.
  if (record.owner.pid === process.pid) return false
  if (record.owner.host !== hostname()) {
    // A different host cannot be checked here. Treat it as live so recovery
    // fails closed instead of clearing a transaction it cannot observe.
    return true
  }
  return isProcessAlive(record.owner.pid)
}

function validateRecord(value: unknown): McpTransactionRecord | null {
  if (!isRecord(value)) return null
  if (value.version !== MCP_TRANSACTION_VERSION) return null
  if (typeof value.txnId !== 'string' || value.txnId.length === 0) return null
  if (value.phase !== 'active' && value.phase !== 'abandoned') return null
  if (typeof value.startedAt !== 'string') return null
  const owner = value.owner
  if (!isRecord(owner)) return null
  if (typeof owner.pid !== 'number' || !Number.isInteger(owner.pid) || owner.pid <= 0) return null
  if (typeof owner.host !== 'string' || owner.host.length === 0) return null
  if (typeof owner.startedAt !== 'string') return null
  if (!Array.isArray(value.serverIds) || value.serverIds.length === 0) return null
  const ids: string[] = []
  for (const id of value.serverIds) {
    // An empty, blank or non-string id makes the record unusable: recovery
    // could not prove which server to disable.
    if (typeof id !== 'string' || id.trim().length === 0) return null
    ids.push(id)
  }
  const serverIds = uniqueServerIds(ids)
  return {
    version: MCP_TRANSACTION_VERSION,
    txnId: value.txnId,
    owner: { pid: owner.pid, host: owner.host, startedAt: owner.startedAt },
    phase: value.phase,
    startedAt: value.startedAt,
    serverIds
  }
}

async function writeRecord(path: string, record: McpTransactionRecord): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify(record, null, 2)}\n`, { durable: true })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function uniqueServerIds(serverIds: string[]): string[] {
  return [...new Set(serverIds.filter((id) => id.trim().length > 0))]
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code
}

function errorCode(error: unknown): string {
  return String((error as NodeJS.ErrnoException | null)?.code ?? 'unknown error')
}
