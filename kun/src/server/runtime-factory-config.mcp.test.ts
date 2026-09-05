import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { McpCapabilityConfig } from '../contracts/capabilities.js'
import {
  KUN_MANAGED_GITHUB_MCP_MARKER,
  KUN_MANAGED_GITHUB_MCP_URL
} from '../contracts/builtin-mcp.js'
import { persistSharedMcpConfig } from './runtime-factory-config.js'

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
