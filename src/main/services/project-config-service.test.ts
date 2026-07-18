import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeKunProjectConfig } from '../../../kun/src/config/project-config.js'
import {
  defaultKunRuntimeSettings,
  normalizeAppSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import { syncGuiManagedKunConfig } from '../runtime/kun-runtime-config-service'
import {
  GENERATED_PROJECT_MCP_SERVER_PREFIX,
  approvedProjectMcpServers,
  readProjectConfigState,
  stripGeneratedProjectMcpServers
} from './project-config-service'

describe('project config MCP grants', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-project-mcp-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('does not materialize unapproved or stale project MCP declarations', async () => {
    const workspace = await createWorkspace('one')
    const written = await writeProject(workspace, {
      codegraph: { transport: 'stdio', command: 'node', args: ['server.js'] }
    })

    await expect(approvedProjectMcpServers(settings())).resolves.toEqual({})
    await expect(approvedProjectMcpServers(settings([
      { workspaceRoot: written.workspaceRoot, configDigest: 'f'.repeat(64) }
    ]))).resolves.toEqual({})

    await expect(readProjectConfigState(settings(), workspace)).resolves.toMatchObject({
      status: 'valid',
      trust: 'untrusted',
      digest: written.digest
    })
    await expect(readProjectConfigState(settings([
      { workspaceRoot: written.workspaceRoot, configDigest: 'f'.repeat(64) }
    ]), workspace)).resolves.toMatchObject({ trust: 'stale' })
  })

  it('forces workspace trust, visibility, and default cwd for approved servers', async () => {
    const workspace = await createWorkspace('approved')
    const written = await writeProject(workspace, {
      codegraph: { transport: 'stdio', command: 'node', args: ['server.js'] }
    })
    const servers = await approvedProjectMcpServers(settings([
      { workspaceRoot: written.workspaceRoot, configDigest: written.digest }
    ]))
    const entries = Object.entries(servers)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.[0]).toMatch(new RegExp(`^${GENERATED_PROJECT_MCP_SERVER_PREFIX}`))
    expect(entries[0]?.[1]).toMatchObject({
      command: 'node',
      cwd: written.workspaceRoot,
      workspaceRoots: [written.workspaceRoot],
      trustScope: 'workspace',
      trustedWorkspaceRoots: [written.workspaceRoot]
    })
    await expect(readProjectConfigState(settings([
      { workspaceRoot: written.workspaceRoot, configDigest: written.digest }
    ]), workspace)).resolves.toMatchObject({ trust: 'trusted' })
  })

  it('isolates same-id servers from multiple approved workspaces', async () => {
    const workspaceA = await createWorkspace('a')
    const workspaceB = await createWorkspace('b')
    const writtenA = await writeProject(workspaceA, {
      api: { transport: 'stdio', command: 'node', args: ['a.js'] }
    })
    const writtenB = await writeProject(workspaceB, {
      api: { transport: 'stdio', command: 'node', args: ['b.js'] }
    })

    const servers = await approvedProjectMcpServers(settings([
      { workspaceRoot: writtenA.workspaceRoot, configDigest: writtenA.digest },
      { workspaceRoot: writtenB.workspaceRoot, configDigest: writtenB.digest }
    ]))

    expect(Object.keys(servers)).toHaveLength(2)
    expect(new Set(Object.keys(servers)).size).toBe(2)
    expect(Object.values(servers).map((server) => server.workspaceRoots)).toEqual(
      expect.arrayContaining([[writtenA.workspaceRoot], [writtenB.workspaceRoot]])
    )
  })

  it('rebuilds generated entries while preserving user-global MCP servers', async () => {
    const workspace = await createWorkspace('sync')
    const written = await writeProject(workspace, {
      api: { transport: 'stdio', command: 'node', args: ['api.js'] }
    })
    const dataDir = join(root, 'data')
    const userMcpPath = join(root, 'mcp.json')
    await writeFile(userMcpPath, JSON.stringify({
      servers: {
        global: { transport: 'stdio', command: 'global-mcp' },
        [`${GENERATED_PROJECT_MCP_SERVER_PREFIX}forged`]: {
          transport: 'stdio',
          command: 'must-not-collide'
        }
      }
    }))
    const trusted = settings([
      { workspaceRoot: written.workspaceRoot, configDigest: written.digest }
    ])

    const first = await syncGuiManagedKunConfig(dataDir, trusted.agents.kun, {
      appSettings: trusted,
      mcpConfigPath: userMcpPath
    })

    expect(first.capabilities.mcp.servers.global).toMatchObject({ command: 'global-mcp' })
    expect(Object.keys(first.capabilities.mcp.servers).some((id) =>
      id.startsWith(GENERATED_PROJECT_MCP_SERVER_PREFIX)
    )).toBe(true)

    const revoked = settings()
    const second = await syncGuiManagedKunConfig(dataDir, revoked.agents.kun, {
      appSettings: revoked,
      mcpConfigPath: userMcpPath
    })

    expect(second.capabilities.mcp.servers.global).toMatchObject({ command: 'global-mcp' })
    expect(Object.keys(second.capabilities.mcp.servers).some((id) =>
      id.startsWith(GENERATED_PROJECT_MCP_SERVER_PREFIX)
    )).toBe(false)
  })

  it('removes previously generated entries when the approved digest becomes stale', async () => {
    const workspace = await createWorkspace('stale-sync')
    const written = await writeProject(workspace, {
      api: { transport: 'stdio', command: 'node', args: ['first.js'] }
    })
    const dataDir = join(root, 'stale-data')
    const approved = settings([
      { workspaceRoot: written.workspaceRoot, configDigest: written.digest }
    ])

    const first = await syncGuiManagedKunConfig(dataDir, approved.agents.kun, {
      appSettings: approved,
      mcpConfigPath: join(root, 'missing-mcp.json')
    })
    expect(Object.keys(first.capabilities.mcp.servers).some((id) =>
      id.startsWith(GENERATED_PROJECT_MCP_SERVER_PREFIX)
    )).toBe(true)

    await writeProject(workspace, {
      api: { transport: 'stdio', command: 'node', args: ['changed.js'] }
    })
    const second = await syncGuiManagedKunConfig(dataDir, approved.agents.kun, {
      appSettings: approved,
      mcpConfigPath: join(root, 'missing-mcp.json')
    })

    expect(Object.keys(second.capabilities.mcp.servers).some((id) =>
      id.startsWith(GENERATED_PROJECT_MCP_SERVER_PREFIX)
    )).toBe(false)
  })

  it('strips only the reserved generated namespace', () => {
    expect(stripGeneratedProjectMcpServers({
      user: { command: 'user' },
      [`${GENERATED_PROJECT_MCP_SERVER_PREFIX}old`]: { command: 'old' }
    })).toEqual({ user: { command: 'user' } })
  })

  it('redacts remote URL credentials and request details from summaries', async () => {
    const workspace = await createWorkspace('redaction')
    const written = await writeProject(workspace, {
      remote: {
        transport: 'streamable-http',
        url: 'https://user:password@example.com/mcp?token=secret#private',
        headers: { Authorization: 'Bearer secret' }
      }
    })

    const state = await readProjectConfigState(settings([
      { workspaceRoot: written.workspaceRoot, configDigest: written.digest }
    ]), workspace)

    expect(state.serverSummaries).toEqual([{
      id: 'remote',
      transport: 'streamable-http',
      target: 'https://example.com/mcp',
      enabled: true
    }])
    expect(JSON.stringify(state.serverSummaries)).not.toMatch(/password|secret|authorization|token/i)
  })

  async function createWorkspace(name: string): Promise<string> {
    const workspace = join(root, name)
    await mkdir(workspace)
    return workspace
  }

  async function writeProject(
    workspace: string,
    servers: Record<string, Record<string, unknown>>
  ) {
    return writeKunProjectConfig(workspace, JSON.stringify({
      version: 1,
      mcp: { servers }
    }, null, 2))
  }
})

function settings(
  grants: Array<{ workspaceRoot: string; configDigest: string }> = []
): AppSettingsV1 {
  const base = normalizeAppSettings({} as AppSettingsV1)
  return normalizeAppSettings({
    ...base,
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        projectConfig: { grants }
      }
    }
  })
}
