import { describe, expect, it } from 'vitest'
import {
  createBlankMcpServer,
  parseMcpConfigText,
  serializeMcpConfig,
  serializeMcpServer,
  validateMcpServers,
  type McpFormServer
} from './mcp-config-form'

const MESSAGES = {
  nameRequired: 'name-required',
  nameDuplicate: 'name-duplicate',
  commandRequired: 'command-required',
  urlRequired: 'url-required',
  urlInvalid: 'url-invalid',
  workspaceRootsRequired: 'workspace-roots-required'
}

function expectOk(result: ReturnType<typeof parseMcpConfigText>) {
  if (!result.ok) throw new Error(`expected parse ok, got error: ${result.error}`)
  return result.model
}

describe('parseMcpConfigText', () => {
  it('treats empty text as an empty model', () => {
    const model = expectOk(parseMcpConfigText('   \n  '))
    expect(model.servers).toEqual([])
    expect(model.preserved).toEqual({})
  })

  it('parses a kun-format stdio server', () => {
    const model = expectOk(
      parseMcpConfigText(
        JSON.stringify({
          servers: {
            github: {
              transport: 'stdio',
              command: 'npx',
              cwd: '/workspace/project',
              args: ['-y', 'gh-mcp'],
              env: { TOKEN: 'abc' }
            }
          }
        })
      )
    )
    expect(model.servers).toHaveLength(1)
    const server = model.servers[0]
    expect(server.name).toBe('github')
    expect(server.transport).toBe('stdio')
    expect(server.command).toBe('npx')
    expect(server.cwd).toBe('/workspace/project')
    expect(server.args).toEqual(['-y', 'gh-mcp'])
    expect(server.env).toEqual([{ key: 'TOKEN', value: 'abc' }])
    // No explicit trustScope / roots -> defaults to user.
    expect(server.trustScope).toBe('user')
  })

  it('parses an http server with headers', () => {
    const model = expectOk(
      parseMcpConfigText(
        JSON.stringify({
          servers: {
            remote: {
              transport: 'streamable-http',
              url: 'https://example.com/mcp',
              headers: { Authorization: 'Bearer x' }
            }
          }
        })
      )
    )
    const server = model.servers[0]
    expect(server.transport).toBe('streamable-http')
    expect(server.url).toBe('https://example.com/mcp')
    expect(server.headers).toEqual([{ key: 'Authorization', value: 'Bearer x' }])
  })

  it('parses workspace visibility roots separately from trust roots', () => {
    const model = expectOk(
      parseMcpConfigText(
        JSON.stringify({
          servers: {
            codegraph: {
              transport: 'streamable-http',
              url: 'https://example.com/mcp',
              workspaceRoots: ['/workspace/project-a'],
              trustScope: 'workspace',
              trustedWorkspaceRoots: ['/workspace']
            }
          }
        })
      )
    )
    const server = model.servers[0]
    expect(server.workspaceRoots).toEqual(['/workspace/project-a'])
    expect(server.trustedWorkspaceRoots).toEqual(['/workspace'])
  })

  it('accepts the Claude Desktop format: mcpServers + type:http', () => {
    const model = expectOk(
      parseMcpConfigText(
        JSON.stringify({
          mcpServers: {
            remote: { type: 'http', url: 'https://example.com/mcp' }
          }
        })
      )
    )
    expect(model.servers).toHaveLength(1)
    expect(model.servers[0].transport).toBe('streamable-http')
    expect(model.servers[0].url).toBe('https://example.com/mcp')
    // Round-trips into the canonical `servers` key, dropping `mcpServers`.
    const text = serializeMcpConfig(model)
    const reparsed = JSON.parse(text)
    expect(reparsed.servers.remote.transport).toBe('streamable-http')
    expect(reparsed.mcpServers).toBeUndefined()
  })

  it('accepts type:sse and type:stdio aliases', () => {
    const sse = expectOk(
      parseMcpConfigText(JSON.stringify({ servers: { a: { type: 'sse', url: 'https://h/sse' } } }))
    )
    expect(sse.servers[0].transport).toBe('sse')
    const stdio = expectOk(
      parseMcpConfigText(JSON.stringify({ servers: { b: { type: 'stdio', command: 'run' } } }))
    )
    expect(stdio.servers[0].transport).toBe('stdio')
  })

  it('infers transport from command/url when none is given', () => {
    const cmd = expectOk(parseMcpConfigText(JSON.stringify({ servers: { a: { command: 'run' } } })))
    expect(cmd.servers[0].transport).toBe('stdio')
    const url = expectOk(parseMcpConfigText(JSON.stringify({ servers: { b: { url: 'https://h' } } })))
    expect(url.servers[0].transport).toBe('streamable-http')
  })

  it('reads disabled servers as not enabled', () => {
    const model = expectOk(
      parseMcpConfigText(JSON.stringify({ servers: { a: { command: 'run', enabled: false } } }))
    )
    expect(model.servers[0].enabled).toBe(false)
  })

  it('preserves unrelated top-level keys', () => {
    const model = expectOk(
      parseMcpConfigText(
        JSON.stringify({ enabled: true, search: { enabled: true }, servers: {} })
      )
    )
    expect(model.preserved).toEqual({ enabled: true, search: { enabled: true } })
  })

  it('reports invalid JSON', () => {
    const result = parseMcpConfigText('{ not json')
    expect(result.ok).toBe(false)
  })

  it('rejects a non-object root', () => {
    const result = parseMcpConfigText('[1, 2, 3]')
    expect(result.ok).toBe(false)
  })
})

describe('serializeMcpConfig', () => {
  it('round-trips preserved keys and a server', () => {
    const source = JSON.stringify({ search: { enabled: false }, servers: {} })
    const model = expectOk(parseMcpConfigText(source))
    model.servers.push({
      ...createBlankMcpServer('streamable-http'),
      name: 'remote',
      url: 'https://example.com/mcp'
    })
    const text = serializeMcpConfig(model)
    const parsed = JSON.parse(text)
    expect(parsed.search).toEqual({ enabled: false })
    expect(parsed.servers.remote).toEqual({
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      trustScope: 'user'
    })
    expect(text.endsWith('\n')).toBe(true)
  })

  it('drops servers with a blank name', () => {
    const model = {
      preserved: {},
      servers: [createBlankMcpServer('stdio')]
    }
    const parsed = JSON.parse(serializeMcpConfig(model))
    expect(parsed.servers).toEqual({})
  })

  it('only writes transport-relevant fields', () => {
    const stdio: McpFormServer = {
      ...createBlankMcpServer('stdio'),
      name: 's',
      command: 'run',
      cwd: '/workspace/project',
      args: ['--flag'],
      env: [{ key: 'K', value: 'V' }],
      // url/headers should be ignored for stdio
      url: 'https://ignored',
      headers: [{ key: 'H', value: 'V' }]
    }
    expect(serializeMcpServer(stdio)).toEqual({
      transport: 'stdio',
      command: 'run',
      cwd: '/workspace/project',
      args: ['--flag'],
      env: { K: 'V' },
      trustScope: 'user'
    })

    const http: McpFormServer = {
      ...createBlankMcpServer('streamable-http'),
      name: 'h',
      url: 'https://h/mcp',
      headers: [{ key: 'Authorization', value: 'Bearer x' }],
      // command/args/env should be ignored for http
      command: 'ignored',
      cwd: '/ignored',
      args: ['ignored'],
      env: [{ key: 'IGN', value: 'V' }]
    }
    expect(serializeMcpServer(http)).toEqual({
      transport: 'streamable-http',
      url: 'https://h/mcp',
      headers: { Authorization: 'Bearer x' },
      trustScope: 'user'
    })
  })

  it('writes workspace roots only for workspace scope', () => {
    const server: McpFormServer = {
      ...createBlankMcpServer('stdio'),
      name: 's',
      command: 'run',
      trustScope: 'workspace',
      trustedWorkspaceRoots: ['/a', ' /b ', '']
    }
    expect(serializeMcpServer(server).trustedWorkspaceRoots).toEqual(['/a', '/b'])
  })

  it('writes visibility roots when present', () => {
    const server: McpFormServer = {
      ...createBlankMcpServer('stdio'),
      name: 's',
      command: 'run',
      workspaceRoots: ['/a', ' /b ', '']
    }
    expect(serializeMcpServer(server).workspaceRoots).toEqual(['/a', '/b'])
  })

  it('drops blank env/header rows on serialize', () => {
    const server: McpFormServer = {
      ...createBlankMcpServer('stdio'),
      name: 's',
      command: 'run',
      env: [{ key: '', value: 'orphan' }, { key: 'K', value: 'V' }]
    }
    expect(serializeMcpServer(server).env).toEqual({ K: 'V' })
  })
})

describe('validateMcpServers', () => {
  it('passes a valid stdio + http pair', () => {
    const servers: McpFormServer[] = [
      { ...createBlankMcpServer('stdio'), name: 'a', command: 'run' },
      { ...createBlankMcpServer('streamable-http'), name: 'b', url: 'https://h/mcp' }
    ]
    expect(validateMcpServers(servers, MESSAGES)).toEqual([])
  })

  it('requires a name', () => {
    const errors = validateMcpServers([{ ...createBlankMcpServer('stdio'), command: 'run' }], MESSAGES)
    expect(errors).toContainEqual(
      expect.objectContaining({ field: 'name', message: 'name-required' })
    )
  })

  it('flags duplicate names on every offending row', () => {
    const servers: McpFormServer[] = [
      { ...createBlankMcpServer('stdio'), name: 'dup', command: 'run' },
      { ...createBlankMcpServer('stdio'), name: 'dup', command: 'run' }
    ]
    const dupErrors = validateMcpServers(servers, MESSAGES).filter((e) => e.message === 'name-duplicate')
    expect(dupErrors).toHaveLength(2)
  })

  it('requires command for stdio and url for http/sse', () => {
    const errors = validateMcpServers(
      [
        { ...createBlankMcpServer('stdio'), name: 'a' },
        { ...createBlankMcpServer('sse'), name: 'b' }
      ],
      MESSAGES
    )
    expect(errors).toContainEqual(expect.objectContaining({ field: 'command', message: 'command-required' }))
    expect(errors).toContainEqual(expect.objectContaining({ field: 'url', message: 'url-required' }))
  })

  it('rejects a non-http url', () => {
    const errors = validateMcpServers(
      [{ ...createBlankMcpServer('streamable-http'), name: 'a', url: 'ftp://nope' }],
      MESSAGES
    )
    expect(errors).toContainEqual(expect.objectContaining({ field: 'url', message: 'url-invalid' }))
  })

  it('requires workspace roots for workspace scope', () => {
    const errors = validateMcpServers(
      [{ ...createBlankMcpServer('stdio'), name: 'a', command: 'run', trustScope: 'workspace' }],
      MESSAGES
    )
    expect(errors).toContainEqual(
      expect.objectContaining({ field: 'trustedWorkspaceRoots', message: 'workspace-roots-required' })
    )
  })
})
