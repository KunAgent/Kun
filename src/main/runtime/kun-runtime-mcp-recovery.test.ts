import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultKunRuntimeSettings } from '../../shared/app-settings'
import { configureLogger } from '../logger'
import { configureManagerAtomicJsonClient } from '../../../kun/src/extensions/atomic-json.js'
import { acquireMcpLock, releaseMcpLock } from '../../../kun/src/server/runtime-mcp-lock.js'
import { mcpTransactionPath } from '../../../kun/src/server/runtime-mcp-transaction.js'
import { canonicalMcpServers } from './kun-runtime-mcp-config'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/deepseek-gui-test-app',
    getPath: () => '/tmp/deepseek-gui-test-user-data'
  }
}))

let tempRoot: string | null = null

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'kun-mcp-recovery-'))
  configureLogger({ dir: tempRoot, enabled: true, retentionDays: 1 })
})

afterEach(() => {
  configureLogger({ dir: '', enabled: true, retentionDays: 7 })
  configureManagerAtomicJsonClient(null)
  vi.unstubAllEnvs()
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

const enabledServer = { enabled: true, transport: 'stdio', command: 'old-server', trustScope: 'user' }

describe('GUI MCP transaction recovery', () => {
  it('keeps a user-authored enable of a previously disabled server', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const mcpConfigPath = join(tempRoot, 'mcp.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: { mcp: { servers: { app: { ...enabledServer, enabled: false } } } }
    }))
    writeFileSync(mcpConfigPath, JSON.stringify({ servers: { app: enabledServer } }))
    const module = await import('../kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), { mcpConfigPath })

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(config.capabilities.mcp.servers.app.enabled).toBe(true)
    expect(existsSync(mcpTransactionPath(tempRoot))).toBe(false)
  })

  it('blocks synchronization on an unusable record and preserves it', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const mcpConfigPath = join(tempRoot, 'mcp.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: { mcp: { servers: { app: { ...enabledServer, enabled: false } } } }
    }))
    writeFileSync(mcpConfigPath, JSON.stringify({ servers: { app: enabledServer } }))
    writeFileSync(mcpTransactionPath(tempRoot), '{ not a record')
    const module = await import('../kun-process')

    await expect(module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), { mcpConfigPath }))
      .rejects.toThrow(/recovery record/)

    // Neither file may be rewritten and the record must survive for the user.
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(config.capabilities.mcp.servers.app.enabled).toBe(false)
    expect(readFileSync(mcpTransactionPath(tempRoot), 'utf8')).toBe('{ not a record')
  })

  it('does not commit a stale shared snapshot over a completed Runtime disable', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const mcpConfigPath = join(tempRoot, 'mcp.json')
    writeFileSync(configPath, JSON.stringify({ capabilities: { mcp: { servers: { app: enabledServer } } } }))
    writeFileSync(mcpConfigPath, JSON.stringify({ servers: { app: enabledServer } }))
    const module = await import('../kun-process')
    const lockPath = join(tempRoot, 'mcp-config.lock')
    const owner = await acquireMcpLock(lockPath)

    const previous = process.env.KUN_MCP_LOCK_TIMEOUT_MS
    process.env.KUN_MCP_LOCK_TIMEOUT_MS = '5000'
    try {
      // The GUI cannot read its snapshot before the lock is released, so the
      // Runtime disable below is always observed by the merge.
      const pending = module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), { mcpConfigPath })
      const disabled = { ...enabledServer, enabled: false }
      writeFileSync(configPath, JSON.stringify({ capabilities: { mcp: { servers: { app: disabled } } } }))
      writeFileSync(mcpConfigPath, JSON.stringify({ servers: { app: disabled } }))
      await releaseMcpLock(lockPath, owner)
      await pending
    } finally {
      if (previous === undefined) delete process.env.KUN_MCP_LOCK_TIMEOUT_MS
      else process.env.KUN_MCP_LOCK_TIMEOUT_MS = previous
    }

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(config.capabilities.mcp.servers.app.enabled).toBe(false)
    const shared = JSON.parse(readFileSync(mcpConfigPath, 'utf8')) as any
    expect(shared.servers.app.enabled).toBe(false)
  })

  it('reports preserve when a synchronization leaves the MCP servers unchanged', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const mcpConfigPath = join(tempRoot, 'mcp.json')
    writeFileSync(mcpConfigPath, JSON.stringify({ servers: {} }), 'utf8')
    const module = await import('../kun-process')
    // First sync materializes config.json with the host-owned entries.
    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), { mcpConfigPath })

    const decisions: Array<{ mode: string }> = []
    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      mcpConfigPath,
      onMcpServersUpdate: (update) => { decisions.push(update) }
    })

    expect(decisions).toEqual([{ mode: 'preserve' }])
  })

  it('reports replace with the pre-sync server set when a server changes', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const mcpConfigPath = join(tempRoot, 'mcp.json')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(mcpConfigPath, JSON.stringify({ servers: {} }), 'utf8')
    const module = await import('../kun-process')
    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), { mcpConfigPath })
    const before = JSON.parse(readFileSync(configPath, 'utf8')) as any

    // The user enabled a server in the shared file after that sync.
    writeFileSync(mcpConfigPath, JSON.stringify({
      servers: { app: { enabled: true, transport: 'stdio', command: 'app-mcp', trustScope: 'user' } }
    }), 'utf8')
    const decisions: any[] = []
    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      mcpConfigPath,
      onMcpServersUpdate: (update) => { decisions.push(update) }
    })

    expect(decisions).toHaveLength(1)
    expect(decisions[0].mode).toBe('replace')
    // The base is what the Runtime compares against: the schema-canonical form
    // of the pre-sync servers (validation fills defaults the file entries omit).
    expect(decisions[0].base).toEqual(canonicalMcpServers(before.capabilities.mcp.servers))
    expect(JSON.parse(readFileSync(configPath, 'utf8')).capabilities.mcp.servers.app.enabled)
      .toBe(true)
  })
})
