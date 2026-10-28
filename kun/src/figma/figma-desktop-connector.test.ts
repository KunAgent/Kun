import { describe, expect, it, vi } from 'vitest'
import type { McpCapabilityConfig, McpServerConfig } from '../contracts/capabilities.js'
import { buildMcpToolProviders } from '../adapters/tool/mcp-tool-provider.js'
import type {
  McpClientLike,
  McpToolProviderOptions
} from '../adapters/tool/mcp-tool-provider.js'
import { FigmaDesktopMcpConnector } from './figma-desktop-connector.js'
import {
  FIGMA_DESKTOP_MCP_CALL_TIMEOUT_MS,
  FIGMA_DESKTOP_MCP_CONNECT_TIMEOUT_MS,
  FIGMA_DESKTOP_MCP_URL
} from './figma-desktop-mcp-preset.js'

type ClientFactory = (serverId: string, server: McpServerConfig) => Promise<McpClientLike>

type Capture = {
  config?: McpCapabilityConfig
  options?: McpToolProviderOptions
  reconnectCalls: number
}

const capture = (): Capture => ({ reconnectCalls: 0 })

/**
 * Uses the real shared MCP provider builder so discovery runs through the same
 * connect/list/register path production uses; only the MCP client (the local
 * Figma Desktop process) is faked. The wrapper records how the builder was
 * invoked and guards against an unrequested reconnect loop.
 */
function recordingBuilder(record: Capture): typeof buildMcpToolProviders {
  return async (config, options) => {
    record.config = config
    record.options = options
    const result = await buildMcpToolProviders(config, options)
    const real = result.startBackgroundReconnect
    result.startBackgroundReconnect = async (hooks) => {
      record.reconnectCalls += 1
      return real(hooks)
    }
    return result
  }
}

function fakeClient(names: string[], closed: string[] = []): McpClientLike {
  return {
    serverInfo: { name: 'Figma Desktop MCP', version: '1.0.0' },
    listTools: async () => ({
      tools: names.map((name) => ({ name, description: `${name} tool`, inputSchema: { type: 'object' } }))
    }),
    callTool: async () => ({ content: [] }),
    close: async () => { closed.push('close') }
  }
}

describe('Figma Desktop MCP connector opt-in', () => {
  it('does not connect unless the host enables it', async () => {
    const factory = vi.fn<ClientFactory>()
    const record = capture()
    const connector = new FigmaDesktopMcpConnector({ clientFactory: factory, buildProviders: recordingBuilder(record) })
    const status = await connector.discover()
    expect(status.state).toBe('disabled')
    expect(status.tools).toEqual([])
    expect(status.toolCount).toBe(0)
    expect(factory).not.toHaveBeenCalled()
    expect(record.config).toBeUndefined()
    expect(connector.providers()).toEqual([])
  })

  it('rejects an out-of-range connect budget before touching the network', () => {
    for (const connectTimeoutMs of [0, 999, 60_001, 1.5, Number.NaN]) {
      expect(() => new FigmaDesktopMcpConnector({ connectTimeoutMs }))
        .toThrowError(expect.objectContaining({ code: 'invalid_config' }))
    }
  })

  it('sends only the fixed preset server with bounded timeouts and no persistence seams', async () => {
    const factory = vi.fn<ClientFactory>(async () => fakeClient(['get_design_context']))
    const record = capture()
    const connector = new FigmaDesktopMcpConnector({
      enabled: true,
      clientFactory: factory,
      buildProviders: recordingBuilder(record)
    })
    await connector.discover()

    expect(Object.keys(record.config!.servers)).toEqual(['figma-desktop'])
    expect(record.config!.search.enabled).toBe(false)
    expect(record.config!.enabled).toBe(true)
    const server = record.config!.servers['figma-desktop']!
    expect(server).toMatchObject({
      transport: 'streamable-http',
      url: FIGMA_DESKTOP_MCP_URL,
      trustScope: 'user',
      timeoutMs: FIGMA_DESKTOP_MCP_CONNECT_TIMEOUT_MS,
      callTimeoutMs: FIGMA_DESKTOP_MCP_CALL_TIMEOUT_MS
    })
    expect(server.command).toBeUndefined()
    expect(server.args).toEqual([])
    expect(server.headers).toEqual({})
    expect(server.env).toEqual({})
    expect(record.options?.startupConnectTimeoutMs).toBe(FIGMA_DESKTOP_MCP_CONNECT_TIMEOUT_MS)
    expect(record.options).not.toHaveProperty('oauthStorageDir')
    expect(record.options).not.toHaveProperty('oauthEncryptor')
    expect(record.options).not.toHaveProperty('catalogCachePath')
    expect(record.options).not.toHaveProperty('openExternal')
  })

  it('builds a capability config that pins the same endpoint', () => {
    const config = new FigmaDesktopMcpConnector({ enabled: true, connectTimeoutMs: 5_000 }).capabilityConfig()
    expect(Object.keys(config.servers)).toEqual(['figma-desktop'])
    expect(config.servers['figma-desktop']!.url).toBe(FIGMA_DESKTOP_MCP_URL)
    expect(config.servers['figma-desktop']!.timeoutMs).toBe(5_000)
    expect(config.servers['figma-desktop']!.callTimeoutMs).toBe(FIGMA_DESKTOP_MCP_CALL_TIMEOUT_MS)
    expect(config.search.enabled).toBe(false)
  })
})

describe('Figma Desktop MCP tool discovery', () => {
  it('reports the tools the local server actually advertised', async () => {
    const factory = vi.fn<ClientFactory>(async () =>
      fakeClient(['get_design_context', 'get_screenshot']))
    const record = capture()
    const connector = new FigmaDesktopMcpConnector({
      enabled: true,
      clientFactory: factory,
      buildProviders: recordingBuilder(record)
    })
    const status = await connector.discover()

    expect(status.state).toBe('connected')
    expect(status.toolCount).toBe(2)
    expect(status.tools).toEqual([
      'mcp_figma_desktop_get_design_context',
      'mcp_figma_desktop_get_screenshot'
    ])
    expect(factory).toHaveBeenCalledOnce()
    expect(factory.mock.calls[0]![0]).toBe('figma-desktop')
    expect(factory.mock.calls[0]![1].url).toBe(FIGMA_DESKTOP_MCP_URL)

    // The live registry entry matches what the status reports.
    const direct = connector.providers().find((provider) => provider.id === 'mcp:figma-desktop')
    expect(direct?.tools.map((tool) => tool.name).sort()).toEqual(status.tools)
    expect(record.reconnectCalls).toBe(0)
  })

  it('keeps hostile tool names inside the figma namespace', async () => {
    const factory = vi.fn<ClientFactory>(async () => fakeClient(['../Delete File']))
    const connector = new FigmaDesktopMcpConnector({ enabled: true, clientFactory: factory })
    const status = await connector.discover()
    expect(status.tools).toEqual(['mcp_figma_desktop_delete_file'])
    for (const name of status.tools) {
      expect(name.startsWith('mcp_figma_desktop_')).toBe(true)
      expect(name).not.toContain('..')
      expect(name).not.toContain('/')
    }
  })

  it('reports a connected server that advertises no tools without inventing any', async () => {
    const factory = vi.fn<ClientFactory>(async () => fakeClient([]))
    const connector = new FigmaDesktopMcpConnector({ enabled: true, clientFactory: factory })
    const status = await connector.discover()
    expect(status.state).toBe('connected')
    expect(status.toolCount).toBe(0)
    expect(status.tools).toEqual([])
    expect(status.guidance).toContain('no tools')
  })
})

describe('Figma Desktop MCP disconnect', () => {
  it('closes the live client once and can reconnect afterwards', async () => {
    const closed: string[] = []
    const factory = vi.fn<ClientFactory>(async () => fakeClient(['get_design_context'], closed))
    const connector = new FigmaDesktopMcpConnector({ enabled: true, clientFactory: factory })
    await connector.discover()

    await connector.disconnect()
    expect(closed).toEqual(['close'])
    const after = connector.status()
    expect(after.state).toBe('disconnected')
    expect(after.tools).toEqual([])
    expect(after.toolCount).toBe(0)
    expect(connector.providers()).toEqual([])

    await connector.disconnect()
    expect(closed).toEqual(['close'])

    await connector.discover()
    expect(factory).toHaveBeenCalledTimes(2)
    expect(connector.status().state).toBe('connected')
  })

  it('survives a client whose close throws', async () => {
    const factory = vi.fn<ClientFactory>(async () => ({
      listTools: async () => ({ tools: [{ name: 'get_design_context' }] }),
      callTool: async () => ({}),
      close: async () => { throw new Error('socket already closed') }
    }))
    const connector = new FigmaDesktopMcpConnector({ enabled: true, clientFactory: factory })
    await connector.discover()
    await expect(connector.disconnect()).resolves.toBeUndefined()
    expect(connector.status().state).toBe('disconnected')
  })
})

describe('Figma Desktop MCP unavailable path', () => {
  it('reports unavailable with zero tools when nothing listens on the endpoint', async () => {
    const factory = vi.fn<ClientFactory>(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3845')
    })
    const record = capture()
    const connector = new FigmaDesktopMcpConnector({
      enabled: true,
      clientFactory: factory,
      buildProviders: recordingBuilder(record)
    })
    const status = await connector.discover()

    expect(status.state).toBe('unavailable')
    expect(status.toolCount).toBe(0)
    expect(status.tools).toEqual([])
    expect(status.guidance).toContain(FIGMA_DESKTOP_MCP_URL)
    expect(status.lastError).toContain('ECONNREFUSED')

    const fabricated = connector.providers()
      .flatMap((provider) => provider.tools)
      .filter((tool) => tool.name.startsWith('mcp_figma_desktop_'))
    expect(fabricated).toEqual([])
    // No background retry loop: a closed local port must not be probed forever.
    expect(record.reconnectCalls).toBe(0)

    await connector.discover()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('caps a long upstream error instead of forwarding it verbatim', async () => {
    const factory = vi.fn<ClientFactory>(async () => {
      throw new Error('x'.repeat(1_000))
    })
    const connector = new FigmaDesktopMcpConnector({ enabled: true, clientFactory: factory })
    const status = await connector.discover()
    expect(status.state).toBe('unavailable')
    expect(status.lastError).toHaveLength(403)
    expect(status.lastError?.endsWith('...')).toBe(true)
  })
})
