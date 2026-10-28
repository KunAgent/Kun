import type { McpCapabilityConfig } from '../contracts/capabilities.js'
import type { RuntimeConfigApplyResponse } from '../contracts/runtime-config.js'
import {
  McpServerConflictError,
  canonicalMcpServer,
  type McpPersistTarget,
  type McpServerSnapshot
} from './runtime-mcp-persist.js'
import type { McpTransactionRecord } from './runtime-mcp-transaction.js'
import type { McpServerMutation } from './routes/server-runtime.js'

/**
 * `config.json` is the only file a directly launched Runtime reads, so an
 * enable must become durable there last: a crash before that write leaves the
 * server disabled for every start path. A disable commits there first, which
 * makes the disabled state durable before the shared file can disagree.
 */
export type McpPersistStage = {
  serverId: string
  server: Record<string, unknown> | null
  expected: McpServerSnapshot
  skipConflictCheck?: boolean
}

export type McpMutationTransaction = {
  begin(serverIds: string[]): Promise<McpTransactionRecord>
  end(txnId: string): Promise<void>
  abandon(txnId: string): Promise<void>
}

type MutationDeps = {
  mcp: McpCapabilityConfig
  serverId: string
  mutation: McpServerMutation
  apply(value: McpCapabilityConfig): Promise<RuntimeConfigApplyResponse>
  /** Raw entries currently on disk, read while the caller holds the locks. */
  readExpected(serverId: string): Promise<McpServerSnapshot>
  persist(target: McpPersistTarget, stage: McpPersistStage): Promise<void>
  /**
   * Fence checked before every file write: the caller must still own the
   * cross-process lock. A stolen or broken lock aborts instead of writing.
   */
  fence?(): Promise<void>
  transaction: McpMutationTransaction
}

/** Called while the runtime configuration and MCP file locks are held. */
export async function mutateMcpServer({
  mcp,
  serverId,
  mutation,
  apply,
  readExpected,
  persist,
  fence,
  transaction
}: MutationDeps): Promise<RuntimeConfigApplyResponse> {
  const current = mcp.servers[serverId]
  const server = typeof mutation === 'function' ? mutation(current) : mutation
  if (server === 'unchanged') return { ok: true }
  if (server === 'exists' || server === 'missing') return {
    ok: false, code: 'invalid_config',
    message: server === 'exists' ? `MCP server already exists: ${serverId}` : `MCP server not found: ${serverId}`
  }
  const servers = { ...mcp.servers }
  if (server) servers[serverId] = { ...server, planModeReadOnlyTools: server.planModeReadOnlyTools ?? [] }
  else delete servers[serverId]
  const desired = { ...mcp, servers }
  const stagedServers = { ...servers }
  if (server) stagedServers[serverId] = { ...(current ?? servers[serverId]), enabled: false }
  const staged = { ...mcp, servers: stagedServers }
  // A file may only be rewritten for an id whose durable value is still the
  // value this runtime last applied; otherwise the caller must retry.
  const expected = await readExpected(serverId)
  if (canonicalMcpServer(expected.config) !== canonicalMcpServer(current)) {
    return {
      ok: false, code: 'invalid_config',
      message: `MCP server ${serverId} changed in config.json; retry the update`
    }
  }

  const stageResult = await apply(staged)
  if (!stageResult.ok) return stageResult

  const order: McpPersistTarget[] = server?.enabled === true && current?.enabled !== true
    ? ['shared', 'config']
    : ['config', 'shared']
  const stagedServer = current
    ? { ...current, enabled: false } as Record<string, unknown>
    : server ? { ...server, enabled: false } : null
  const record = await transaction.begin([serverId])

  // Every durable write re-checks that this process still owns the lock.
  let lockLost = false
  const persistFenced = async (target: McpPersistTarget, stage: McpPersistStage): Promise<void> => {
    if (fence) {
      try {
        await fence()
      } catch (error) {
        lockLost = true
        throw error
      }
    }
    await persist(target, stage)
  }

  const written: McpPersistTarget[] = []
  let failure: unknown
  let conflict: McpServerConflictError | undefined
  try {
    for (const target of order) {
      await persistFenced(target, { serverId, server, expected })
      written.push(target)
    }
  } catch (error) {
    failure = error
    if (error instanceof McpServerConflictError) conflict = error
  }

  let finalResult: RuntimeConfigApplyResponse | undefined
  if (!failure) {
    if (!server) {
      await transaction.end(record.txnId)
      return stageResult
    }
    try {
      finalResult = await apply(desired)
      if (finalResult.ok) {
        await transaction.end(record.txnId)
        return finalResult
      }
      failure = new Error(finalResult.message)
    } catch (error) {
      failure = error
    }
  }

  // Restore the live state first; the durable repair depends on the failure.
  const failures: unknown[] = []
  try {
    const result = await apply(staged)
    if (!result.ok) failures.push(new Error(result.message))
  } catch (error) { failures.push(error) }

  if (lockLost) {
    // The lock is no longer ours, so this process must not write the files or
    // the recovery record: another owner may already be running.
    throw failure
  }
  if (conflict) {
    // The conflicting file was not overwritten. A target that already committed
    // is rolled back, but the two files can no longer be proven consistent, so
    // the record stays for recovery to converge both to disabled.
    for (const target of written) {
      try {
        await persistFenced(target, {
          serverId, server: stagedServer, expected, skipConflictCheck: true
        })
      } catch (error) { failures.push(error) }
    }
    if (failures.length) {
      await transaction.abandon(record.txnId).catch(() => undefined)
      throw new AggregateError(
        [conflict, ...failures],
        'MCP mutation failed and disabled-state repair was incomplete'
      )
    }
    if (written.length > 0) await transaction.abandon(record.txnId).catch(() => undefined)
    else await transaction.end(record.txnId)
    return {
      ok: false, code: 'invalid_config',
      message: `${conflict.message}; retry the update`
    }
  }

  // Any other failure must leave BOTH files disabled before the record may be
  // cleared. A file that was never written (for example the shared file after a
  // config-only disable) would otherwise resurrect the server on restart.
  if (written.length > 0) {
    for (const target of ['config', 'shared'] as const) {
      try {
        await persistFenced(target, {
          serverId, server: stagedServer, expected, skipConflictCheck: true
        })
      } catch (error) { failures.push(error) }
    }
  }
  if (failures.length) {
    await transaction.abandon(record.txnId).catch(() => undefined)
    throw new AggregateError(
      [failure, ...failures],
      'MCP mutation failed and disabled-state repair was incomplete'
    )
  }
  await transaction.end(record.txnId)
  if (finalResult) return finalResult
  throw failure
}
