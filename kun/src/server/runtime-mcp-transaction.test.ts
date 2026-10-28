import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { KunCapabilitiesConfig, McpServerConfig } from '../contracts/capabilities.js'
import { createKunServeRuntime } from './runtime-factory.js'
import { mcpDataLockPath } from './runtime-mcp-lock.js'
import {
  McpTransactionConflictError,
  McpTransactionStateError,
  abandonMcpTransaction,
  beginMcpTransaction,
  endMcpTransaction,
  mcpTransactionPath,
  readMcpTransaction,
  recoverPendingMcpTransaction
} from './runtime-mcp-transaction.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-mcp-transaction-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  return root
}

const now = () => new Date().toISOString()

function journal(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    txnId: 'txn-1',
    owner: { pid: process.pid, host: hostname(), startedAt: now() },
    phase: 'abandoned',
    startedAt: now(),
    serverIds: ['app'],
    ...overrides
  }
}

async function writeJournal(dataDir: string, value: unknown): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  await writeFile(mcpTransactionPath(dataDir), JSON.stringify(value), 'utf8')
}

const remote = (enabled: boolean) => McpServerConfig.parse({
  enabled, transport: 'streamable-http', url: 'https://127.0.0.1:1/mcp', trustScope: 'user'
})

it('reports a missing record only for ENOENT', async () => {
  const root = await temporaryRoot()
  expect(await readMcpTransaction(join(root, 'data'))).toEqual({ state: 'none' })

  const dataDir = join(root, 'data')
  await writeJournal(dataDir, '{ not json')
  expect((await readMcpTransaction(dataDir)).state).toBe('invalid')

  await writeJournal(dataDir, journal({ version: 1 }))
  expect((await readMcpTransaction(dataDir)).state).toBe('invalid')

  await writeJournal(dataDir, journal({ phase: 'running' }))
  expect((await readMcpTransaction(dataDir)).state).toBe('invalid')

  // A directory at the record path is a read error, not an absent record.
  await rm(mcpTransactionPath(dataDir))
  await mkdir(mcpTransactionPath(dataDir))
  expect((await readMcpTransaction(dataDir)).state).toBe('invalid')
})

it('rejects a second transaction while one is pending', async () => {
  const dataDir = await temporaryRoot()
  const first = await beginMcpTransaction(dataDir, ['app'])
  expect(first.phase).toBe('active')
  await expect(beginMcpTransaction(dataDir, ['other'])).rejects.toBeInstanceOf(McpTransactionConflictError)

  await expect(endMcpTransaction(dataDir, 'someone-else')).rejects.toBeInstanceOf(McpTransactionConflictError)
  expect((await readMcpTransaction(dataDir)).state).toBe('pending')

  await endMcpTransaction(dataDir, first.txnId)
  expect(await readMcpTransaction(dataDir)).toEqual({ state: 'none' })
})

it('marks its own transaction abandoned without touching another id', async () => {
  const dataDir = await temporaryRoot()
  const record = await beginMcpTransaction(dataDir, ['app'])
  await abandonMcpTransaction(dataDir, record.txnId)
  const read = await readMcpTransaction(dataDir)
  expect(read).toMatchObject({ state: 'pending', record: { phase: 'abandoned', txnId: record.txnId } })
  await expect(abandonMcpTransaction(dataDir, 'other-txn')).rejects.toBeInstanceOf(McpTransactionConflictError)
})

it('rolls an abandoned transaction back to disabled and clears it', async () => {
  const dataDir = join(await temporaryRoot(), 'data')
  const configPath = join(dataDir, 'config.json')
  const sharedPath = join(dataDir, 'mcp.json')
  await mkdir(dataDir, { recursive: true })
  await writeFile(configPath, JSON.stringify({
    capabilities: { mcp: { servers: { app: remote(true), other: remote(true) } } },
    keep: 'config'
  }), 'utf8')
  await writeFile(sharedPath, JSON.stringify({
    other: 'shared',
    servers: { app: remote(true), user: remote(true) }
  }), 'utf8')
  await writeJournal(dataDir, journal({ serverIds: ['app'] }))

  const recovered = await recoverPendingMcpTransaction({ dataDir, configPath, sharedMcpConfigPath: sharedPath })

  expect(recovered.serverIds).toEqual(['app'])
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  const shared = JSON.parse(await readFile(sharedPath, 'utf8'))
  expect(config.capabilities.mcp.servers.app.enabled).toBe(false)
  expect(config.capabilities.mcp.servers.other.enabled).toBe(true)
  expect(config.keep).toBe('config')
  expect(shared.servers.app.enabled).toBe(false)
  expect(shared.servers.user.enabled).toBe(true)
  expect(shared.other).toBe('shared')
  await expect(stat(mcpTransactionPath(dataDir))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('refuses to clear a record whose owner is still alive', async () => {
  const dataDir = join(await temporaryRoot(), 'data')
  const configPath = join(dataDir, 'config.json')
  await mkdir(dataDir, { recursive: true })
  await writeFile(configPath, JSON.stringify({ capabilities: { mcp: { servers: { app: remote(true) } } } }), 'utf8')
  // The test runner's parent process is alive and is not this process.
  await writeJournal(dataDir, journal({
    phase: 'active',
    owner: { pid: process.ppid, host: hostname(), startedAt: now() }
  }))

  await expect(recoverPendingMcpTransaction({ dataDir, configPath }))
    .rejects.toBeInstanceOf(McpTransactionConflictError)
  expect((await readMcpTransaction(dataDir)).state).toBe('pending')
  expect(JSON.parse(await readFile(configPath, 'utf8')).capabilities.mcp.servers.app.enabled).toBe(true)
})

it('preserves the record when a recovery target cannot be parsed', async () => {
  const dataDir = join(await temporaryRoot(), 'data')
  const configPath = join(dataDir, 'config.json')
  await mkdir(dataDir, { recursive: true })
  await writeFile(configPath, '{ broken config', 'utf8')
  await writeJournal(dataDir, journal())

  await expect(recoverPendingMcpTransaction({ dataDir, configPath }))
    .rejects.toBeInstanceOf(McpTransactionStateError)
  expect((await readMcpTransaction(dataDir)).state).toBe('pending')
})

it('preserves the record when a recovery target cannot be read', async () => {
  const dataDir = join(await temporaryRoot(), 'data')
  const configPath = join(dataDir, 'config.json')
  await mkdir(configPath, { recursive: true })
  await writeJournal(dataDir, journal())

  await expect(recoverPendingMcpTransaction({ dataDir, configPath }))
    .rejects.toBeInstanceOf(McpTransactionStateError)
  expect((await readMcpTransaction(dataDir)).state).toBe('pending')
})

it('completes recovery when the config file does not exist yet', async () => {
  const dataDir = join(await temporaryRoot(), 'data')
  const sharedPath = join(dataDir, 'mcp.json')
  await mkdir(dataDir, { recursive: true })
  await writeFile(sharedPath, JSON.stringify({ servers: { app: remote(true) } }), 'utf8')
  await writeJournal(dataDir, journal())

  const recovered = await recoverPendingMcpTransaction({
    dataDir, configPath: join(dataDir, 'config.json'), sharedMcpConfigPath: sharedPath
  })
  expect(recovered.serverIds).toEqual(['app'])
  expect(JSON.parse(await readFile(sharedPath, 'utf8')).servers.app.enabled).toBe(false)
  expect(await readMcpTransaction(dataDir)).toEqual({ state: 'none' })
})

async function files(failShared = false) {
  const root = await temporaryRoot()
  const shared = join(root, 'shared.json')
  if (failShared) await mkdir(shared)
  else await writeFile(shared, JSON.stringify({ other: 'preserved', servers: {} }))
  return { root, shared, dataDir: join(root, 'data') }
}

async function runtimeFor(root: string, shared: string, capabilities?: KunCapabilitiesConfig) {
  const runtime = await createKunServeRuntime({
    host: '127.0.0.1', port: 0, dataDir: join(root, 'data'), sharedMcpConfigPath: shared,
    runtimeToken: 'test-token', apiKey: '', baseUrl: 'http://127.0.0.1:9', model: 'test',
    approvalPolicy: 'on-request', sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false,
    ...(capabilities ? { capabilities } : {})
  })
  cleanup.push(async () => { await runtime.shutdown?.() })
  return runtime
}

it('serializes independent updates and leaves no recovery record behind', async () => {
  const { root, shared } = await files()
  const runtime = await runtimeFor(root, shared)
  const results = await Promise.all([
    runtime.setMcpServer!('one', remote(false)),
    runtime.setMcpServer!('two', remote(false)),
    runtime.setSkillsEnabled!(false)
  ])
  expect(results.every((result) => result.ok)).toBe(true)
  expect(Object.keys(runtime.mcpConfig!().servers).sort()).toEqual(['one', 'two'])
  const local = JSON.parse(await readFile(join(root, 'data', 'config.json'), 'utf8'))
  const sharedData = JSON.parse(await readFile(shared, 'utf8'))
  expect(Object.keys(local.capabilities.mcp.servers).sort()).toEqual(['one', 'two'])
  expect(local.capabilities.skills.enabled).toBe(false)
  expect(sharedData.other).toBe('preserved')
  await expect(stat(mcpTransactionPath(join(root, 'data')))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('refuses an enable before touching any file when the shared file is unreadable', async () => {
  const { root, shared } = await files(true)
  const runtime = await runtimeFor(root, shared)
  const marker = join(root, 'executed')
  const attempted = McpServerConfig.parse({ enabled: true, transport: 'stdio', command: process.execPath,
    args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'started')`], trustScope: 'user' })

  // The preflight snapshot read fails, so the mutation is rejected before it is
  // staged, persisted or recorded. The security invariant is that nothing ends
  // up enabled and nothing is spawned.
  await expect(runtime.setMcpServer!('unsafe', attempted)).rejects.toThrow()
  expect(runtime.mcpConfig!().servers.unsafe?.enabled ?? false).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 200))
  await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })

  expect(await readMcpTransaction(join(root, 'data'))).toEqual({ state: 'none' })
  await expect(stat(join(root, 'data', 'config.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('never spawns a newly enabled stdio provider whose shared write is blocked', async () => {
  const { root, shared } = await files()
  const runtime = await runtimeFor(root, shared)
  const marker = join(root, 'executed')
  const attempted = McpServerConfig.parse({ enabled: true, transport: 'stdio', command: process.execPath,
    args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'started')`], trustScope: 'user' })
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs')
    const os = require('node:os')
    fs.writeFileSync(process.env.LOCK_PATH, JSON.stringify({
      version: 1, token: 'child', pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString()
    }))
    process.stdout.write('ready\\n')
    process.stdin.resume()
  `], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, LOCK_PATH: `${shared}.lock` } })
  cleanup.push(async () => { child.kill('SIGKILL') })
  await new Promise<void>((resolve) => child.stdout?.on('data', (chunk) => {
    if (String(chunk).includes('ready')) resolve()
  }))

  const previous = process.env.KUN_MCP_LOCK_TIMEOUT_MS
  process.env.KUN_MCP_LOCK_TIMEOUT_MS = '300'
  try {
    await expect(runtime.setMcpServer!('unsafe', attempted)).rejects.toThrow()
  } finally {
    if (previous === undefined) delete process.env.KUN_MCP_LOCK_TIMEOUT_MS
    else process.env.KUN_MCP_LOCK_TIMEOUT_MS = previous
  }

  await new Promise((resolve) => setTimeout(resolve, 200))
  await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(runtime.mcpConfig!().servers.unsafe?.enabled ?? false).toBe(false)
  // The shared write never landed and config.json was never touched, so there
  // is nothing to recover and no descriptor to leave behind.
  expect(await readMcpTransaction(join(root, 'data'))).toEqual({ state: 'none' })
  await expect(stat(join(root, 'data', 'config.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps an abandoned record when the shared lock is never released', async () => {
  const { root, shared } = await files()
  const runtime = await runtimeFor(root, shared)
  expect((await runtime.setMcpServer!('old', remote(true))).ok).toBe(true)
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs')
    const os = require('node:os')
    fs.writeFileSync(process.env.LOCK_PATH, JSON.stringify({
      version: 1, token: 'child', pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString()
    }))
    process.stdout.write('ready\\n')
    process.stdin.resume()
  `], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, LOCK_PATH: `${shared}.lock` } })
  cleanup.push(async () => { child.kill('SIGKILL') })
  await new Promise<void>((resolve) => child.stdout?.on('data', (chunk) => {
    if (String(chunk).includes('ready')) resolve()
  }))

  const previous = process.env.KUN_MCP_LOCK_TIMEOUT_MS
  process.env.KUN_MCP_LOCK_TIMEOUT_MS = '300'
  try {
    await expect(runtime.setMcpServer!('old', { ...remote(true), enabled: false })).rejects.toThrow()
  } finally {
    if (previous === undefined) delete process.env.KUN_MCP_LOCK_TIMEOUT_MS
    else process.env.KUN_MCP_LOCK_TIMEOUT_MS = previous
  }

  expect(runtime.mcpConfig!().servers.old.enabled).toBe(false)
  expect(await readMcpTransaction(join(root, 'data'))).toMatchObject({
    state: 'pending', record: { phase: 'abandoned', serverIds: ['old'] }
  })
  const local = JSON.parse(await readFile(join(root, 'data', 'config.json'), 'utf8'))
  expect(local.capabilities.mcp.servers.old.enabled).toBe(false)
})

it('rejects without a record when the shared file cannot be read', async () => {
  const { root, shared } = await files()
  const runtime = await runtimeFor(root, shared)
  expect((await runtime.setMcpServer!('old', remote(true))).ok).toBe(true)
  await rm(shared)
  await mkdir(shared)

  await expect(runtime.setMcpServer!('old', { ...remote(true), enabled: false })).rejects.toThrow()

  expect(await readMcpTransaction(join(root, 'data'))).toEqual({ state: 'none' })
  expect(runtime.mcpConfig!().servers.old.enabled).toBe(true)
})

it('rolls an interrupted mutation back to disabled on runtime startup', async () => {
  const { root, shared, dataDir } = await files()
  await mkdir(dataDir, { recursive: true })
  await writeFile(join(dataDir, 'config.json'), JSON.stringify({
    capabilities: { mcp: { servers: { app: remote(false) } } }
  }), 'utf8')
  await writeFile(shared, JSON.stringify({ other: 'preserved', servers: { app: remote(true) } }), 'utf8')
  await writeJournal(dataDir, journal())

  const runtime = await runtimeFor(root, shared, KunCapabilitiesConfig.parse({
    mcp: { servers: { app: remote(true) } }
  }))

  expect(runtime.mcpConfig!().servers.app.enabled).toBe(false)
  const local = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'))
  const sharedData = JSON.parse(await readFile(shared, 'utf8'))
  expect(local.capabilities.mcp.servers.app.enabled).toBe(false)
  expect(sharedData.servers.app.enabled).toBe(false)
  expect(sharedData.other).toBe('preserved')
  expect(await readMcpTransaction(dataDir)).toEqual({ state: 'none' })
})

it('refuses to start on an unusable recovery record and preserves it', async () => {
  const { root, shared, dataDir } = await files()
  await mkdir(dataDir, { recursive: true })
  await writeFile(mcpTransactionPath(dataDir), '{ broken record', 'utf8')

  await expect(runtimeFor(root, shared)).rejects.toBeInstanceOf(McpTransactionStateError)
  expect(await readFile(mcpTransactionPath(dataDir), 'utf8')).toBe('{ broken record')
})

it('refuses to start while a live owner still runs the transaction', async () => {
  const { root, shared, dataDir } = await files()
  await writeJournal(dataDir, journal({
    phase: 'active',
    owner: { pid: process.ppid, host: hostname(), startedAt: now() }
  }))

  await expect(runtimeFor(root, shared)).rejects.toBeInstanceOf(McpTransactionConflictError)
  expect((await readMcpTransaction(dataDir)).state).toBe('pending')
})

it('keeps a user-authored enable when no mutation was interrupted', async () => {
  const { root, shared, dataDir } = await files()
  const runtime = await runtimeFor(root, shared, KunCapabilitiesConfig.parse({
    mcp: { servers: { app: remote(true) } }
  }))
  expect(runtime.mcpConfig!().servers.app.enabled).toBe(true)
  expect(JSON.parse(await readFile(shared, 'utf8')).servers).toEqual({})
  expect(await readMcpTransaction(dataDir)).toEqual({ state: 'none' })
})

it('blocks startup while another process holds the data lock', async () => {
  const { root, shared, dataDir } = await files()
  await mkdir(dataDir, { recursive: true })
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs')
    const os = require('node:os')
    fs.writeFileSync(process.env.LOCK_PATH, JSON.stringify({
      version: 1, token: 'child', pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString()
    }))
    process.stdout.write('ready\\n')
    process.stdin.resume()
  `], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, LOCK_PATH: mcpDataLockPath(dataDir) } })
  cleanup.push(async () => { child.kill('SIGKILL') })
  await new Promise<void>((resolve) => child.stdout?.on('data', (chunk) => {
    if (String(chunk).includes('ready')) resolve()
  }))

  const previous = process.env.KUN_MCP_LOCK_TIMEOUT_MS
  process.env.KUN_MCP_LOCK_TIMEOUT_MS = '300'
  try {
    await expect(runtimeFor(root, shared)).rejects.toThrow(/Timed out waiting for the MCP configuration lock/)
  } finally {
    if (previous === undefined) delete process.env.KUN_MCP_LOCK_TIMEOUT_MS
    else process.env.KUN_MCP_LOCK_TIMEOUT_MS = previous
  }

  child.kill('SIGKILL')
  await new Promise<void>((resolve) => child.once('exit', () => resolve()))
  const runtime = await runtimeFor(root, shared)
  expect(runtime.mcpConfig!().servers).toBeDefined()
})

it('rejects a record whose server ids are empty, blank or not strings', async () => {
  for (const serverIds of [[], ['app', 1], ['   '], ['']]) {
    const dataDir = join(await temporaryRoot(), 'data')
    const record = journal({ serverIds })
    await writeJournal(dataDir, record)
    expect((await readMcpTransaction(dataDir)).state).toBe('invalid')
    await expect(recoverPendingMcpTransaction({ dataDir }))
      .rejects.toBeInstanceOf(McpTransactionStateError)
    // The unusable record is preserved for the operator, not rewritten.
    expect(await readFile(mcpTransactionPath(dataDir), 'utf8')).toBe(JSON.stringify(record))
  }
})

it('repairs both server shapes when one file carries both', async () => {
  const dataDir = join(await temporaryRoot(), 'data')
  const sharedPath = join(dataDir, 'mcp.json')
  await mkdir(dataDir, { recursive: true })
  await writeFile(sharedPath, JSON.stringify({
    servers: { app: remote(true) },
    capabilities: { mcp: { enabled: true, servers: { app: remote(true), other: remote(true) } } }
  }), 'utf8')
  await writeJournal(dataDir, journal({ serverIds: ['app'] }))

  await recoverPendingMcpTransaction({ dataDir, sharedMcpConfigPath: sharedPath })

  const shared = JSON.parse(await readFile(sharedPath, 'utf8'))
  expect(shared.servers.app.enabled).toBe(false)
  expect(shared.capabilities.mcp.servers.app.enabled).toBe(false)
  expect(shared.capabilities.mcp.servers.other.enabled).toBe(true)
  expect(shared.capabilities.mcp.enabled).toBe(true)
  expect(await readMcpTransaction(dataDir)).toEqual({ state: 'none' })
})

it('does not let a stale GUI apply re-enable a server the Runtime disabled', async () => {
  const { root, shared } = await files()
  const runtime = await runtimeFor(root, shared)
  const enabled = remote(true)
  expect((await runtime.setMcpServer!('app', enabled)).ok).toBe(true)

  // The GUI read this snapshot (and its base) before the disable below, then
  // posts it after the Runtime mutation finished.
  const staleCapabilities = KunCapabilitiesConfig.parse({ mcp: { servers: { app: enabled } } })
  const base = { app: enabled }
  expect((await runtime.setMcpServer!('app', { ...enabled, enabled: false })).ok).toBe(true)

  const preserved = await runtime.applyConfig!({ capabilities: staleCapabilities, mcpServers: { mode: 'preserve' } })
  expect(preserved.ok).toBe(true)
  expect(runtime.mcpConfig!().servers.app.enabled).toBe(false)

  const staleReplace = await runtime.applyConfig!({
    capabilities: staleCapabilities,
    mcpServers: { mode: 'replace', base }
  })
  expect(staleReplace.ok).toBe(false)
  expect(runtime.mcpConfig!().servers.app.enabled).toBe(false)

  // A change derived from the current set is applied normally.
  const applied = await runtime.applyConfig!({
    capabilities: KunCapabilitiesConfig.parse({ mcp: { servers: { app: enabled } } }),
    mcpServers: { mode: 'replace', base: { app: runtime.mcpConfig!().servers.app } }
  })
  expect(applied.ok).toBe(true)
  expect(runtime.mcpConfig!().servers.app.enabled).toBe(true)
})

