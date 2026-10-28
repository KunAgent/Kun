import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KunCapabilitiesConfig, McpCapabilityConfig, McpServerConfig } from '../contracts/capabilities.js'
import {
  KUN_MANAGED_GITHUB_MCP_MARKER,
  KUN_MANAGED_GITHUB_MCP_URL
} from '../contracts/builtin-mcp.js'
import { applyMcpServersUpdate, persistSharedMcpConfig } from './runtime-factory-config.js'
import { McpServerConflictError, persistMcpServerChange } from './runtime-mcp-persist.js'

let temporaryRoot: string | undefined

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('shared MCP config persistence', () => {
  it('keeps system-managed servers out of the user-owned mcp.json', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-shared-mcp-'))
    const path = join(temporaryRoot, 'mcp.json')
    await writeFile(path, JSON.stringify({ formatVersion: 1, servers: {} }), 'utf8')
    const mcp = McpCapabilityConfig.parse({
      enabled: true,
      servers: {
        github: {
          enabled: true,
          managedBy: KUN_MANAGED_GITHUB_MCP_MARKER,
          transport: 'streamable-http',
          url: KUN_MANAGED_GITHUB_MCP_URL,
          headers: { 'X-MCP-Readonly': 'true' },
          trustScope: 'user'
        },
        docs: {
          enabled: false,
          transport: 'stdio',
          command: 'docs-mcp',
          args: ['--stdio'],
          trustScope: 'user'
        }
      }
    })

    await persistSharedMcpConfig(path, mcp)

    const persisted = JSON.parse(await readFile(path, 'utf8')) as {
      formatVersion?: number
      servers?: Record<string, unknown>
    }
    expect(persisted.formatVersion).toBe(1)
    expect(persisted.servers).toEqual({
      docs: expect.objectContaining({
        enabled: false,
        transport: 'stdio',
        command: 'docs-mcp'
      })
    })
    expect(persisted.servers).not.toHaveProperty('github')
  })
})

describe('single-server MCP persistence', () => {
  const server = (enabled: boolean, command = 'app-mcp') => McpServerConfig.parse({
    enabled, transport: 'stdio', command, trustScope: 'user'
  })

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-persist-'))
    temporaryRoot = root
    const dataDir = join(root, 'data')
    const shared = join(root, 'mcp.json')
    await mkdir(dataDir, { recursive: true })
    return { dataDir, shared }
  }

  it('changes only the target id in config.json and keeps other servers', async () => {
    const { dataDir } = await fixture()
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({
      keep: 'section',
      capabilities: { mcp: { enabled: true, servers: {
        app: server(true),
        other: server(true, 'other-mcp')
      } } }
    }), 'utf8')
    const expected = { config: server(true), shared: null }

    await persistMcpServerChange({
      dataDir, target: 'config', serverId: 'app',
      server: { ...server(false) }, expected
    })

    const written = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'))
    expect(written.keep).toBe('section')
    expect(written.capabilities.mcp.servers.app.enabled).toBe(false)
    expect(written.capabilities.mcp.servers.other.enabled).toBe(true)
    expect(written.capabilities.mcp.servers.other.command).toBe('other-mcp')
  })

  it('rejects a commit when the same id drifted in config.json', async () => {
    const { dataDir } = await fixture()
    const drifted = server(true, 'someone-else')
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({
      capabilities: { mcp: { servers: { app: drifted } } }
    }), 'utf8')

    await expect(persistMcpServerChange({
      dataDir, target: 'config', serverId: 'app',
      server: { ...server(false) }, expected: { config: server(true), shared: null }
    })).rejects.toBeInstanceOf(McpServerConflictError)

    const written = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'))
    expect(written.capabilities.mcp.servers.app.command).toBe('someone-else')
  })

  it('patches only its own id in the shared file and drops managed servers', async () => {
    const { dataDir, shared } = await fixture()
    await writeFile(shared, JSON.stringify({
      timeouts: { read: 1 },
      servers: { app: server(true), user: server(false, 'user-mcp') }
    }), 'utf8')

    await persistMcpServerChange({
      dataDir, sharedMcpConfigPath: shared, target: 'shared', serverId: 'app',
      server: { ...server(false) }, expected: { config: null, shared: server(true) }
    })
    let written = JSON.parse(await readFile(shared, 'utf8'))
    expect(written.timeouts).toEqual({ read: 1 })
    expect(written.servers.app.enabled).toBe(false)
    expect(written.servers.user.command).toBe('user-mcp')

    await persistMcpServerChange({
      dataDir, sharedMcpConfigPath: shared, target: 'shared', serverId: 'user',
      server: { ...server(true, 'user-mcp'), managedBy: 'kun:github' },
      expected: { config: null, shared: server(false, 'user-mcp') }
    })
    written = JSON.parse(await readFile(shared, 'utf8'))
    expect(written.servers.user).toBeUndefined()
  })

  it('lets a repair write win over a drifted entry', async () => {
    const { dataDir } = await fixture()
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({
      capabilities: { mcp: { servers: { app: server(true, 'drifted') } } }
    }), 'utf8')

    await persistMcpServerChange({
      dataDir, target: 'config', serverId: 'app',
      server: { ...server(false) }, expected: { config: server(true), shared: null },
      skipConflictCheck: true
    })

    const written = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'))
    expect(written.capabilities.mcp.servers.app.enabled).toBe(false)
  })
})

describe('hot-apply MCP server reconciliation', () => {
  type RuntimeOptions = Parameters<typeof applyMcpServersUpdate>[0]
  const enabled = McpServerConfig.parse({
    enabled: true, transport: 'stdio', command: 'app-mcp', trustScope: 'user'
  })
  const disabled = McpServerConfig.parse({
    enabled: false, transport: 'stdio', command: 'app-mcp', trustScope: 'user'
  })
  const options = (
    servers: Record<string, unknown>,
    capabilityEnabled = true
  ): RuntimeOptions => ({
    capabilities: KunCapabilitiesConfig.parse({
      mcp: { enabled: capabilityEnabled, servers }
    })
  }) as unknown as RuntimeOptions

  it('keeps the live servers when the caller reports no server change', () => {
    const result = applyMcpServersUpdate(
      options({ app: disabled }),
      options({ app: enabled, other: enabled }, false),
      { mode: 'preserve' }
    )
    expect(result.conflict).toBeUndefined()
    expect(result.options.capabilities?.mcp.enabled).toBe(false)
    expect(Object.keys(result.options.capabilities?.mcp.servers ?? {})).toEqual(['app'])
    expect(result.options.capabilities?.mcp.servers.app.enabled).toBe(false)
  })

  it('applies a replacement whose base is still current', () => {
    const result = applyMcpServersUpdate(
      options({ app: disabled }),
      options({ app: enabled }),
      { mode: 'replace', base: { app: disabled } }
    )
    expect(result.conflict).toBeUndefined()
    expect(result.options.capabilities?.mcp.servers.app.enabled).toBe(true)
  })

  it('rejects a replacement derived from an older server set', () => {
    const result = applyMcpServersUpdate(
      options({ app: disabled }),
      options({ app: enabled }),
      { mode: 'replace', base: { app: enabled } }
    )
    expect(result.conflict).toMatch(/changed in the Runtime/)
    // The caller must not commit the merged options when a conflict is returned.
    expect(result.options.capabilities?.mcp.servers.app.enabled).toBe(true)
  })

  it('keeps legacy callers without an MCP decision on the replacement path', () => {
    const result = applyMcpServersUpdate(
      options({ app: disabled }),
      options({ app: enabled }),
      undefined
    )
    expect(result.conflict).toBeUndefined()
    expect(result.options.capabilities?.mcp.servers.app.enabled).toBe(true)
  })
})
