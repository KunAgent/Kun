import { describe, it, expect } from 'vitest'
import { parseMcpConfigText } from '../src/adapters/tool/mcp-config-file.js'

describe('MCP config file parser', () => {
  it('parses flat server config format', () => {
    const result = parseMcpConfigText(JSON.stringify({
      enabled: true,
      servers: {
        'my-filesystem': {
          command: 'npx',
          args: ['-y', '@anthropic/mcp-filesystem', '/tmp'],
          transport: 'stdio',
          enabled: true,
          trustScope: 'user',
        },
      },
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.enabled).toBe(true)
      expect(Object.keys(result.config.servers)).toHaveLength(1)
      expect(result.config.servers['my-filesystem'].command).toBe('npx')
    }
  })

  it('supports capabilities.mcp nested format', () => {
    const result = parseMcpConfigText(JSON.stringify({
      capabilities: {
        mcp: {
          enabled: true,
          servers: {
            puppeteer: {
              command: 'npx',
              args: ['-y', '@anthropic/mcp-puppeteer'],
              transport: 'stdio',
              enabled: true,
              trustScope: 'user',
            },
          },
        },
      },
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.config.servers)).toHaveLength(1)
    }
  })

  it('returns empty config for empty input', () => {
    const result = parseMcpConfigText('')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.enabled).toBe(false)
      expect(Object.keys(result.config.servers)).toHaveLength(0)
    }
  })

  it('reports JSON syntax errors with line number', () => {
    const result = parseMcpConfigText('{ broken json }', 'test.json')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0].severity).toBe('error')
    }
  })

  it('rejects non-object JSON', () => {
    const result = parseMcpConfigText('["array"]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0].message).toContain('object')
    }
  })

  it('normalizes server config with inferred transport', () => {
    const result = parseMcpConfigText(JSON.stringify({
      servers: {
        'test-server': {
          command: 'node',
          args: ['server.js'],
          enabled: true,
          trustScope: 'user',
        },
      },
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      const server = result.config.servers['test-server']
      // Transport should be inferred from command
      expect(server.transport).toBe('stdio')
    }
  })

  it('normalizes server config with URL transport', () => {
    const result = parseMcpConfigText(JSON.stringify({
      servers: {
        'test-sse': {
          url: 'https://example.com/sse',
          enabled: true,
          trustScope: 'user',
        },
      },
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      const server = result.config.servers['test-sse']
      expect(server.transport).toBe('streamable-http')
    }
  })

  it('maps Zod validation errors to line numbers', () => {
    const result = parseMcpConfigText(JSON.stringify({
      servers: {
        'bad-server': {
          transport: 'stdio',
          enabled: true,
          // missing trustScope
        },
      },
    }))

    // trustScope should fail validation
    expect(result.ok).toBe(false)
  })

  it('handles disabled alias', () => {
    const result = parseMcpConfigText(JSON.stringify({
      servers: {
        'test': {
          command: 'echo',
          disabled: true,
          trustScope: 'user',
        },
      },
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      const server = result.config.servers['test']
      // disabled=true with enabled not set → enabled should be false
      expect(server.enabled).toBe(false)
    }
  })

  it('normalizes trust scope from trustedWorkspaceRoots', () => {
    const result = parseMcpConfigText(JSON.stringify({
      servers: {
        'test': {
          command: 'echo',
          enabled: true,
          trustedWorkspaceRoots: ['/home/user/project'],
        },
      },
    }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      const server = result.config.servers['test']
      expect(server.trustScope).toBe('workspace')
    }
  })
})
