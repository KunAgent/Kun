import { describe, expect, it } from 'vitest'
import { McpServerConfig } from '../contracts/capabilities.js'
import {
  assertFigmaDesktopMcpServerConfig,
  assertFigmaDesktopMcpUrl,
  createFigmaDesktopMcpServerConfig,
  FIGMA_DESKTOP_MCP_CALL_TIMEOUT_MS,
  FIGMA_DESKTOP_MCP_MAX_TIMEOUT_MS,
  FIGMA_DESKTOP_MCP_URL,
  FigmaDesktopMcpError,
  isFigmaDesktopMcpServerConfig
} from './figma-desktop-mcp-preset.js'

const unsupported = expect.objectContaining({ code: 'unsupported_endpoint' })

describe('Figma Desktop MCP endpoint preset', () => {
  it('pins the documented loopback endpoint', () => {
    expect(FIGMA_DESKTOP_MCP_URL).toBe('http://127.0.0.1:3845/mcp')
    expect(assertFigmaDesktopMcpUrl(FIGMA_DESKTOP_MCP_URL).href).toBe(FIGMA_DESKTOP_MCP_URL)
  })

  for (const [label, url] of [
    ['another MCP-looking port', 'http://127.0.0.1:3846/mcp'],
    ['a local dev server port', 'http://127.0.0.1:3000/mcp'],
    ['a devtools port', 'http://127.0.0.1:9222/mcp'],
    ['the default http port', 'http://127.0.0.1/mcp'],
    ['a path outside the MCP endpoint', 'http://127.0.0.1:3845/'],
    ['no path at all', 'http://127.0.0.1:3845'],
    ['a trailing slash', 'http://127.0.0.1:3845/mcp/'],
    ['the legacy SSE path', 'http://127.0.0.1:3845/sse'],
    ['a TLS variant', 'https://127.0.0.1:3845/mcp'],
    ['the localhost alias', 'http://localhost:3845/mcp'],
    ['the IPv6 loopback alias', 'http://[::1]:3845/mcp'],
    ['a wildcard bind address', 'http://0.0.0.0:3845/mcp'],
    ['a LAN address', 'http://192.168.1.10:3845/mcp'],
    ['a query string', 'http://127.0.0.1:3845/mcp?node=1'],
    ['a fragment', 'http://127.0.0.1:3845/mcp#x'],
    ['embedded credentials', 'http://user:secret@127.0.0.1:3845/mcp'],
    ['a non-URL value', 'not a url'],
    ['an empty value', '']
  ] as const) {
    it(`refuses ${label}`, () => {
      expect(() => assertFigmaDesktopMcpUrl(url)).toThrowError(unsupported)
    })
  }

  it('returns an independent entry per call so host edits cannot leak', () => {
    const first = createFigmaDesktopMcpServerConfig({ enabled: true })
    const second = createFigmaDesktopMcpServerConfig({ enabled: true })
    first.headers.Authorization = 'Bearer secret'
    first.args.push('--mcp')
    expect(second.headers).toEqual({})
    expect(second.args).toEqual([])
    expect(isFigmaDesktopMcpServerConfig(second)).toBe(true)
    // The same mutation on a live entry is detected instead of trusted.
    expect(isFigmaDesktopMcpServerConfig(first)).toBe(false)
  })
})

describe('Figma Desktop MCP server entry', () => {
  it('is a disabled, header-free, spawn-free loopback entry by default', () => {
    const server = createFigmaDesktopMcpServerConfig()
    expect(server).toMatchObject({
      enabled: false,
      transport: 'streamable-http',
      url: FIGMA_DESKTOP_MCP_URL,
      trustScope: 'user',
      args: [],
      headers: {},
      env: {},
      workspaceRoots: [],
      trustedWorkspaceRoots: []
    })
    expect(server.command).toBeUndefined()
    expect(server.cwd).toBeUndefined()
    expect(server.oauth).toBeUndefined()
    expect(server.timeoutMs).toBeLessThanOrEqual(FIGMA_DESKTOP_MCP_MAX_TIMEOUT_MS)
    expect(server.callTimeoutMs).toBe(FIGMA_DESKTOP_MCP_CALL_TIMEOUT_MS)
    expect(isFigmaDesktopMcpServerConfig(server)).toBe(true)
  })

  it('can be built enabled for an explicit user opt-in', () => {
    expect(createFigmaDesktopMcpServerConfig({ enabled: true }).enabled).toBe(true)
  })

  const base = McpServerConfig.parse({
    enabled: true,
    transport: 'streamable-http',
    url: FIGMA_DESKTOP_MCP_URL,
    trustScope: 'user'
  })

  for (const [label, patch] of [
    ['a spawned command', { command: '/Applications/Figma.app/Contents/MacOS/Figma' }],
    ['spawned arguments', { args: ['--mcp'] }],
    ['a working directory', { cwd: '/tmp' }],
    ['injected headers', { headers: { Authorization: 'Bearer secret' } }],
    ['injected environment secrets', { env: { FIGMA_TOKEN: 'secret' } }],
    ['an OAuth configuration', { oauth: { issuer: 'https://example.com' } }],
    ['a GitHub policy', { githubPolicy: { host: 'github.com', allowedHosts: ['github.com'] } }],
    ['workspace trust scoping', { trustScope: 'workspace' }],
    ['workspace roots', { workspaceRoots: ['/repo'] }],
    ['an unbounded connect timeout', { timeoutMs: 600_000 }],
    ['a sub-second connect timeout', { timeoutMs: 10 }],
    ['an unbounded call timeout', { callTimeoutMs: 600_000 }],
    ['a non-boolean enabled flag', { enabled: 'yes' }]
  ] as const) {
    it(`rejects ${label}`, () => {
      expect(() => assertFigmaDesktopMcpServerConfig({ ...base, ...patch }))
        .toThrowError(expect.objectContaining({ code: 'invalid_config' }))
      expect(isFigmaDesktopMcpServerConfig({ ...base, ...patch })).toBe(false)
    })
  }

  for (const [label, patch] of [
    ['another port', { url: 'http://127.0.0.1:3846/mcp' }],
    ['another host', { url: 'http://localhost:3845/mcp' }],
    ['another transport', { transport: 'sse' }],
    ['a stdio transport', { transport: 'stdio' }],
    ['a missing url', { url: undefined }]
  ] as const) {
    it(`rejects ${label} before connecting`, () => {
      expect(() => assertFigmaDesktopMcpServerConfig({ ...base, ...patch })).toThrowError(unsupported)
    })
  }

  it('rejects values that are not a server entry at all', () => {
    for (const value of [null, undefined, 'figma', 42, []]) {
      expect(() => assertFigmaDesktopMcpServerConfig(value))
        .toThrowError(expect.objectContaining({ name: 'FigmaDesktopMcpError' }))
      expect(isFigmaDesktopMcpServerConfig(value)).toBe(false)
    }
    expect(new FigmaDesktopMcpError('invalid_config', 'x').code).toBe('invalid_config')
  })
})
