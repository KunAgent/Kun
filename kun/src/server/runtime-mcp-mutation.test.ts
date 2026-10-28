import { expect, it, vi } from 'vitest'
import { McpCapabilityConfig, McpServerConfig } from '../contracts/capabilities.js'
import {
  McpServerConflictError,
  type McpPersistTarget,
  type McpServerSnapshot
} from './runtime-mcp-persist.js'
import { mutateMcpServer, type McpPersistStage } from './runtime-mcp-mutation.js'
import type { McpTransactionRecord } from './runtime-mcp-transaction.js'

const old = McpServerConfig.parse({ enabled: true, transport: 'stdio', command: 'old', trustScope: 'user' })
const replacement = McpServerConfig.parse({ enabled: true, transport: 'stdio', command: 'new', trustScope: 'user' })
const config = (enabled = true) => McpCapabilityConfig.parse({ enabled, servers: { app: old } })
const snapshot = (configServer: unknown): McpServerSnapshot => ({ config: configServer, shared: null })

function transactionDouble() {
  return {
    begin: vi.fn(async (serverIds: string[]): Promise<McpTransactionRecord> => ({
      version: 2 as const, txnId: 'txn-1',
      owner: { pid: process.pid, host: 'test', startedAt: 'now' },
      phase: 'active' as const, startedAt: 'now', serverIds
    })),
    end: vi.fn(async (_txnId: string) => undefined),
    abandon: vi.fn(async (_txnId: string) => undefined)
  }
}

it('preserves global disabled state while replacing a server', async () => {
  const apply = vi.fn(async (_value: ReturnType<typeof config>) => ({ ok: true as const }))
  const persist = vi.fn(async () => undefined)
  await mutateMcpServer({
    mcp: config(false), serverId: 'app', mutation: replacement,
    apply, readExpected: async () => snapshot(old), persist, transaction: transactionDouble()
  })
  expect(apply.mock.calls.every(([value]) => value.enabled === false)).toBe(true)
})

it('writes the shared file before config.json when a server becomes enabled', async () => {
  const targets: McpPersistTarget[] = []
  const disabled = McpCapabilityConfig.parse({ enabled: true, servers: { app: { ...old, enabled: false } } })
  await mutateMcpServer({
    mcp: disabled, serverId: 'app', mutation: { ...replacement, enabled: true },
    apply: async () => ({ ok: true }),
    readExpected: async () => snapshot({ ...old, enabled: false }),
    persist: async (target) => { targets.push(target) },
    transaction: transactionDouble()
  })
  expect(targets).toEqual(['shared', 'config'])
})

it('commits a disable to config.json first', async () => {
  const targets: McpPersistTarget[] = []
  await mutateMcpServer({
    mcp: config(), serverId: 'app', mutation: { ...replacement, enabled: false },
    apply: async () => ({ ok: true }),
    readExpected: async () => snapshot(old),
    persist: async (target) => { targets.push(target) },
    transaction: transactionDouble()
  })
  expect(targets).toEqual(['config', 'shared'])
})

it('records the transaction before the first write and clears it with its own id', async () => {
  const events: string[] = []
  const transaction = {
    begin: vi.fn(async (): Promise<McpTransactionRecord> => {
      events.push('begin')
      return {
        version: 2 as const, txnId: 'txn-9',
        owner: { pid: process.pid, host: 'test', startedAt: 'now' },
        phase: 'active' as const, startedAt: 'now', serverIds: ['app']
      }
    }),
    end: vi.fn(async (txnId: string) => { events.push(`end:${txnId}`) }),
    abandon: vi.fn(async () => { events.push('abandon') })
  }
  await mutateMcpServer({
    mcp: config(), serverId: 'app', mutation: replacement,
    apply: async () => ({ ok: true }),
    readExpected: async () => snapshot(old),
    persist: async (target) => { events.push(`persist:${target}`) },
    transaction
  })
  expect(events).toEqual(['begin', 'persist:config', 'persist:shared', 'end:txn-9'])
})

it('rejects an update whose config.json entry drifted from the applied state', async () => {
  const apply = vi.fn(async () => ({ ok: true as const }))
  const persist = vi.fn(async () => undefined)
  const transaction = transactionDouble()
  const result = await mutateMcpServer({
    mcp: config(), serverId: 'app', mutation: replacement,
    apply, readExpected: async () => snapshot({ ...old, command: 'someone-else' }),
    persist, transaction
  })
  expect(result).toMatchObject({ ok: false, message: expect.stringContaining('changed in config.json') })
  expect(apply).not.toHaveBeenCalled()
  expect(persist).not.toHaveBeenCalled()
  expect(transaction.begin).not.toHaveBeenCalled()
})

it('repairs both written files when the final apply fails', async () => {
  const applied: ReturnType<typeof config>[] = []
  const writes: Array<{ target: McpPersistTarget; stage: McpPersistStage }> = []
  const transaction = transactionDouble()
  const result = await mutateMcpServer({
    mcp: config(), serverId: 'app', mutation: replacement,
    apply: async (value) => {
      applied.push(value)
      return applied.length === 2 ? { ok: false, code: 'invalid_config', message: 'apply failed' } : { ok: true }
    },
    readExpected: async () => snapshot(old),
    persist: async (target, stage) => { writes.push({ target, stage }) },
    transaction
  })
  expect(result).toMatchObject({ ok: false, message: 'apply failed' })
  expect(applied.at(-1)?.servers.app).toMatchObject({ command: 'old', enabled: false })
  expect(writes.slice(-2).map((entry) => entry.target)).toEqual(['config', 'shared'])
  expect(writes.slice(-2).every((entry) => entry.stage.skipConflictCheck === true)).toBe(true)
  expect(writes.at(-1)?.stage.server).toMatchObject({ command: 'old', enabled: false })
  expect(transaction.end).toHaveBeenCalledWith('txn-1')
})

it('keeps the record when a config-only commit cannot be rolled back in both files', async () => {
  const transaction = transactionDouble()
  await expect(mutateMcpServer({
    mcp: config(), serverId: 'app', mutation: { ...replacement, enabled: false },
    apply: async () => ({ ok: true }),
    readExpected: async () => snapshot(old),
    persist: async (target, stage) => {
      if (stage.skipConflictCheck) {
        if (target === 'shared') throw new Error('shared rollback failed')
        return
      }
      if (target === 'shared') throw new Error('shared commit failed')
    },
    transaction
  })).rejects.toThrow('disabled-state repair was incomplete')
  // config.json was written but the shared file still disagrees: the record must
  // survive so recovery disables both before anything can start.
  expect(transaction.abandon).toHaveBeenCalledWith('txn-1')
  expect(transaction.end).not.toHaveBeenCalled()
})

it('clears the record without rewriting files when the first write fails', async () => {
  const transaction = transactionDouble()
  const writes: Array<{ target: McpPersistTarget; stage: McpPersistStage }> = []
  await expect(mutateMcpServer({
    mcp: config(), serverId: 'app', mutation: { ...replacement, enabled: false },
    apply: async () => ({ ok: true }),
    readExpected: async () => snapshot(old),
    persist: async (target, stage) => {
      writes.push({ target, stage })
      if (target === 'config' && !stage.skipConflictCheck) throw new Error('config write failed')
    },
    transaction
  })).rejects.toThrow('config write failed')
  // Nothing durable changed, so no repair write and no lingering record.
  expect(writes.map((entry) => `${entry.target}:${entry.stage.skipConflictCheck ? 'repair' : 'commit'}`))
    .toEqual(['config:commit'])
  expect(transaction.end).toHaveBeenCalledWith('txn-1')
  expect(transaction.abandon).not.toHaveBeenCalled()
})

it('returns a conflict without touching a file it could not write first', async () => {
  const targets: McpPersistTarget[] = []
  const transaction = transactionDouble()
  const result = await mutateMcpServer({
    mcp: config(), serverId: 'app', mutation: replacement,
    apply: async () => ({ ok: true }),
    readExpected: async () => snapshot(old),
    persist: async (target) => {
      targets.push(target)
      throw new McpServerConflictError('app', 'the shared MCP file')
    },
    transaction
  })
  expect(result).toMatchObject({ ok: false, message: expect.stringContaining('retry the update') })
  expect(targets).toEqual(['config'])
  expect(transaction.end).toHaveBeenCalledWith('txn-1')
})

it('keeps the recovery record when the second write conflicts', async () => {
  const writes: Array<{ target: McpPersistTarget; stage: McpPersistStage }> = []
  const transaction = transactionDouble()
  const result = await mutateMcpServer({
    mcp: config(), serverId: 'app', mutation: replacement,
    apply: async () => ({ ok: true }),
    readExpected: async () => snapshot(old),
    persist: async (target, stage) => {
      writes.push({ target, stage })
      if (target === 'shared' && !stage.skipConflictCheck) {
        throw new McpServerConflictError('app', 'the shared MCP file')
      }
    },
    transaction
  })
  expect(result).toMatchObject({ ok: false, message: expect.stringContaining('retry the update') })
  expect(writes.map((entry) => `${entry.target}:${entry.stage.skipConflictCheck ? 'repair' : 'commit'}`))
    .toEqual(['config:commit', 'shared:commit', 'config:repair'])
  expect(writes.at(-1)?.stage.server).toMatchObject({ command: 'old', enabled: false })
  // The shared file changed outside the lock, so the files are not provably
  // consistent; recovery keeps the id disabled until it converges them.
  expect(transaction.abandon).toHaveBeenCalledWith('txn-1')
  expect(transaction.end).not.toHaveBeenCalled()
})

it('removes a server without re-applying it to the live runtime', async () => {
  const apply = vi.fn(async (_value: ReturnType<typeof config>) => ({ ok: true as const }))
  const result = await mutateMcpServer({
    mcp: config(), serverId: 'app', mutation: null,
    apply,
    readExpected: async () => snapshot(old),
    persist: async () => undefined,
    transaction: transactionDouble()
  })
  expect(result).toEqual({ ok: true })
  expect(apply).toHaveBeenCalledTimes(1)
  expect(apply.mock.calls[0][0].servers.app).toBeUndefined()
})

it('stops writing and keeps the record untouched once the lock is lost', async () => {
  const transaction = transactionDouble()
  const persist = vi.fn(async () => undefined)
  await expect(mutateMcpServer({
    mcp: config(), serverId: 'app', mutation: replacement,
    apply: async () => ({ ok: true }),
    readExpected: async () => snapshot(old),
    persist,
    fence: async () => { throw new Error('lock lost') },
    transaction
  })).rejects.toThrow('lock lost')
  // Another owner may already run: no file write and no record edit.
  expect(persist).not.toHaveBeenCalled()
  expect(transaction.end).not.toHaveBeenCalled()
  expect(transaction.abandon).not.toHaveBeenCalled()
})
