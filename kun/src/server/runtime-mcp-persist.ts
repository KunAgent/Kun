import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { McpServerConfig } from '../contracts/capabilities.js'
import { withSharedMcpLock } from './runtime-mcp-lock.js'
import { updateRuntimeJson } from './runtime-factory-config.js'

/**
 * Per-server persistence for MCP mutations.
 *
 * A mutation only replaces the id it owns and leaves every other server entry
 * exactly as it currently exists on disk, so a concurrent user edit of a
 * different server is never overwritten. The entry it owns is compared against
 * the preflight snapshot before the write; a different on-disk value is an
 * explicit conflict, not something to clobber. The comparison happens under the
 * cross-process lock, so it rejects outside writers rather than acting as a
 * substitute for mutual exclusion.
 */
export class McpServerConflictError extends Error {
  constructor(readonly serverId: string, readonly target: string) {
    super(`MCP server ${serverId} changed in ${target}`)
    this.name = 'McpServerConflictError'
  }
}

export class McpConfigFileError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`MCP configuration file ${path} is unusable: ${reason}`)
    this.name = 'McpConfigFileError'
  }
}

export type McpPersistTarget = 'config' | 'shared'

export type McpServerSnapshot = {
  /** Raw `capabilities.mcp.servers[id]` from config.json, or null. */
  config: unknown
  /** Raw shared-file entry for the id, or null. */
  shared: unknown
}

export type McpServerChange = {
  dataDir: string
  sharedMcpConfigPath?: string
  target: McpPersistTarget
  serverId: string
  server: Record<string, unknown> | null
  expected: McpServerSnapshot
  /** Repair writes must win over a concurrent value; commits never do. */
  skipConflictCheck?: boolean
}

export async function readMcpServerSnapshots(
  dataDir: string,
  sharedMcpConfigPath: string | undefined,
  serverId: string
): Promise<McpServerSnapshot> {
  const config = await readJsonObject(join(dataDir, 'config.json'))
  const shared = sharedMcpConfigPath ? await readJsonObject(sharedMcpConfigPath) : null
  const configServers = objectValue(objectValue(objectValue(config?.capabilities).mcp).servers)
  return {
    config: configServers[serverId] ?? null,
    shared: shared ? sharedServersContainer(shared)[serverId] ?? null : null
  }
}

/** Write one target file for one server id. Never touches another id. */
export async function persistMcpServerChange(change: McpServerChange): Promise<void> {
  if (change.target === 'config') {
    await writeConfigServer(change)
    return
  }
  if (!change.sharedMcpConfigPath) throw new Error('shared MCP configuration path is unavailable')
  await withSharedMcpLock(change.sharedMcpConfigPath, () => writeSharedServer(change))
}

async function writeConfigServer(change: McpServerChange): Promise<void> {
  const target = join(change.dataDir, 'config.json')
  await updateRuntimeJson(target, (current) => {
    const capabilities = objectValue(current.capabilities)
    const mcp = objectValue(capabilities.mcp)
    const servers = objectValue(mcp.servers)
    assertNoConflict(change, servers[change.serverId] ?? null, change.expected.config, 'config.json')
    const nextServers = patchServers(servers, change.serverId, change.server)
    return { ...current, capabilities: { ...capabilities, mcp: { ...mcp, servers: nextServers } } }
  })
}

async function writeSharedServer(change: McpServerChange): Promise<void> {
  const sharedPath = change.sharedMcpConfigPath
  if (!sharedPath) return
  await updateRuntimeJson(sharedPath, (current) => {
    const nested = objectValue(objectValue(objectValue(current.capabilities).mcp).servers)
    const direct = objectValue(current.servers)
    const useNested = Object.keys(direct).length === 0 && Object.keys(nested).length > 0
    const servers = useNested ? nested : direct
    assertNoConflict(change, servers[change.serverId] ?? null, change.expected.shared, 'the shared MCP file')
    // System-managed descriptors belong only in runtime config; writing them
    // here would turn them into user overrides on the next synchronization.
    const nextServer = change.server && change.server.managedBy ? null : change.server
    const nextServers = patchServers(servers, change.serverId, nextServer)
    if (!useNested) return { ...current, servers: nextServers }
    const capabilities = objectValue(current.capabilities)
    const mcp = objectValue(capabilities.mcp)
    return {
      ...current,
      capabilities: { ...capabilities, mcp: { ...mcp, servers: nextServers } }
    }
  })
}

function patchServers(
  servers: Record<string, unknown>,
  serverId: string,
  server: Record<string, unknown> | null
): Record<string, unknown> {
  const next = { ...servers }
  if (server) next[serverId] = structuredClone(server)
  else delete next[serverId]
  return next
}

function assertNoConflict(
  change: McpServerChange,
  current: unknown,
  expected: unknown,
  target: string
): void {
  if (change.skipConflictCheck) return
  if (canonicalMcpServer(current) === canonicalMcpServer(expected)) return
  throw new McpServerConflictError(change.serverId, target)
}

export function canonicalMcpServer(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const parsed = McpServerConfig.safeParse(value)
  return parsed.success ? JSON.stringify(parsed.data) : 'invalid'
}

function sharedServersContainer(shared: Record<string, unknown>): Record<string, unknown> {
  const direct = objectValue(shared.servers)
  if (Object.keys(direct).length > 0) return direct
  return objectValue(objectValue(objectValue(shared.capabilities).mcp).servers)
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null
    throw new McpConfigFileError(path, String((error as NodeJS.ErrnoException | null)?.code ?? error))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new McpConfigFileError(path, 'not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new McpConfigFileError(path, 'root is not a JSON object')
  }
  return parsed as Record<string, unknown>
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
