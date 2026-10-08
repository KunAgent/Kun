import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildMcpToolProviders, type McpClientLike, type McpToolDescriptor } from './mcp-tool-provider.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

const lookup: McpToolDescriptor = { name: 'lookup', description: 'Look something up', inputSchema: { type: 'object', properties: {} } }
const context: ToolHostContext = {
  threadId: 'thread_test', turnId: 'turn_test', workspace: '/workspace', approvalPolicy: 'auto',
  abortSignal: new AbortController().signal, awaitApproval: vi.fn()
}
const stdioConfig = (command = 'node') => McpCapabilityConfig.parse({
  enabled: true,
  servers: { docs: { enabled: true, transport: 'stdio', command, args: ['server.js'], timeoutMs: 1_000, trustScope: 'user' } },
  search: { enabled: false }
})

function mockClient(callTool = vi.fn(async () => ({ ok: true }))): McpClientLike & { callTool: typeof callTool } {
  return { listTools: vi.fn(async () => ({ tools: [lookup] })), callTool, close: vi.fn(async () => undefined) }
}

async function cachePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-mcp-catalog-')); dirs.push(dir)
  return join(dir, 'mcp-catalog-cache.json')
}

const findTool = (build: Awaited<ReturnType<typeof buildMcpToolProviders>>) =>
  build.providers.flatMap((provider) => provider.tools).find((tool) => tool.name === 'mcp_docs_lookup')

describe('deferred stdio MCP connects', () => {
  it('advertises cached tools without spawning the server and connects on the first call', async () => {
    const path = await cachePath()
    const first = vi.fn(async () => mockClient())
    const eager = await buildMcpToolProviders(stdioConfig(), { clientFactory: first, catalogCachePath: path })
    expect(first).toHaveBeenCalledTimes(1)
    await eager.close()
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(path, 'utf8')).servers.docs.tools).toEqual([lookup])
    }, { timeout: 3_000 })

    const callTool = vi.fn(async () => ({ rows: [1] }))
    const second = vi.fn(async () => mockClient(callTool))
    const deferred = await buildMcpToolProviders(stdioConfig(), { clientFactory: second, catalogCachePath: path })
    expect(second).not.toHaveBeenCalled()
    expect(deferred.connectedServers).toBe(1)
    const tool = findTool(deferred)
    expect(tool).toBeDefined()
    await expect(tool!.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context))
      .resolves.toMatchObject({ output: { result: { rows: [1] } } })
    expect(second).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(1)
    await deferred.close()
  })

  it('connects eagerly again when the server launch changes', async () => {
    const path = await cachePath()
    await (await buildMcpToolProviders(stdioConfig('node'), { clientFactory: async () => mockClient(), catalogCachePath: path })).close()
    await vi.waitFor(async () => { await readFile(path, 'utf8') }, { timeout: 3_000 })
    const changed = vi.fn(async () => mockClient())
    await (await buildMcpToolProviders(stdioConfig('bun'), { clientFactory: changed, catalogCachePath: path })).close()
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('reports a failed deferred spawn as a plain error the next call can retry', async () => {
    const path = await cachePath()
    await (await buildMcpToolProviders(stdioConfig(), { clientFactory: async () => mockClient(), catalogCachePath: path })).close()
    await vi.waitFor(async () => { await readFile(path, 'utf8') }, { timeout: 3_000 })
    let attempts = 0
    const factory = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
      return mockClient(vi.fn(async () => ({ ok: true })))
    })
    const deferred = await buildMcpToolProviders(stdioConfig(), { clientFactory: factory, catalogCachePath: path })
    const tool = findTool(deferred)!
    const failed = await tool.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context).catch((error: unknown) => error)
    expect(String((failed as Error)?.message ?? failed)).not.toMatch(/status unknown/i)
    await expect(tool.execute({ toolId: 'mcp_docs_lookup', arguments: {} }, context))
      .resolves.toMatchObject({ output: { result: { ok: true } } })
    await deferred.close()
  })
})
