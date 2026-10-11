import { describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig } from '../../contracts/capabilities.js'
import type { ServerRuntime } from './server-runtime.js'
import {
  addRemoteMcpApp,
  deleteMcpConfig,
  listMcpConfig,
  patchMcpConfig,
  putMcpConfig
} from './mcp-config.js'

function body(response: { body: string }): Record<string, any> {
  return JSON.parse(response.body) as Record<string, any>
}

describe('MCP configuration routes', () => {
  it('redacts endpoint credentials and hot-applies create, toggle, and delete', async () => {
    let config = McpCapabilityConfig.parse({
      enabled: true,
      servers: {
        remote: {
          enabled: true,
          transport: 'streamable-http',
          url: 'https://user:pass@example.com/mcp?token=secret#fragment',
          headers: { authorization: 'Bearer secret' },
          trustScope: 'user'
        }
      }
    })
    const setMcpServer = vi.fn(async (id: string, server: unknown) => {
      const servers = { ...config.servers }
      if (server) servers[id] = server as typeof servers[string]
      else delete servers[id]
      config = McpCapabilityConfig.parse({ ...config, enabled: Object.keys(servers).length > 0, servers })
      return { ok: true as const }
    })
    const runtime = {
      mcpConfig: () => config,
      setMcpServer
    } as unknown as ServerRuntime

    const listed = await listMcpConfig(runtime)
    expect(body(listed).servers[0]).toMatchObject({
      id: 'remote',
      target: 'https://example.com/mcp'
    })
    expect(listed.body).not.toContain('secret')
    expect(listed.body).not.toContain('pass')

    const created = await putMcpConfig(runtime, 'local', new Request('http://localhost', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        trustScope: 'user'
      })
    }))
    expect(created.status).toBe(200)
    expect(config.servers.local?.command).toBe('node')

    await patchMcpConfig(runtime, 'local', new Request('http://localhost', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    }))
    expect(config.servers.local?.enabled).toBe(false)

    await deleteMcpConfig(runtime, 'local')
    expect(config.servers.local).toBeUndefined()
    expect(setMcpServer).toHaveBeenCalledTimes(3)
  })

  it('only installs new HTTPS OAuth apps through the renderer route', async () => {
    let config = McpCapabilityConfig.parse({ enabled: false, servers: {} })
    const setMcpServer = vi.fn(async (id: string, server: unknown) => {
      config = McpCapabilityConfig.parse({ enabled: true, servers: { ...config.servers, [id]: server } })
      return { ok: true as const }
    })
    const runtime = { mcpConfig: () => config, setMcpServer } as unknown as ServerRuntime
    const submit = (value: unknown) => addRemoteMcpApp(runtime, 'gmail', new Request('http://localhost', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value)
    }))
    expect((await submit({ url: 'http://example.com/mcp' })).status).toBe(400)
    expect((await submit({ url: 'https://example.com/mcp?token=secret' })).status).toBe(400)
    expect((await submit({ url: 'https://example.com/mcp', command: 'sh' })).status).toBe(400)
    expect(setMcpServer).not.toHaveBeenCalled()
    expect((await submit({ url: 'https://example.com/mcp' })).status).toBe(200)
    expect(config.servers.gmail).toMatchObject({ transport: 'streamable-http', trustScope: 'user', oauth: { enabled: true } })
    expect((await submit({ url: 'https://another.example/mcp' })).status).toBe(409)
    expect(setMcpServer).toHaveBeenCalledTimes(1)
  })
})
