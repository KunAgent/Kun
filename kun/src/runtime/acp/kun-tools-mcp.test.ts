import { describe, expect, it } from 'vitest'
import { KunToolsMcpProvider } from './kun-tools-mcp.js'
import { HarnessTokenService } from '../../harness/harness-token-service.js'
import type { HarnessId } from '../../contracts/harness.js'

const CTX = {
  threadId: 'thr_1',
  turnId: 'turn_1',
  harnessId: 'gemini-cli' as HarnessId,
  credentialIdentity: 'native-login:gemini-cli'
} as const

function makeProvider(endpoint: string | undefined = 'http://127.0.0.1:18899') {
  const tokens = new HarnessTokenService({ secret: Buffer.alloc(32, 7) })
  const provider = new KunToolsMcpProvider({
    tokens,
    endpoint: () => endpoint,
    command: () => ({ command: '/abs/kun', args: ['/abs/serve-entry.js'] })
  })
  return { tokens, provider }
}

describe('KunToolsMcpProvider', () => {
  it('emits an http descriptor when the agent advertises http MCP', () => {
    const { tokens, provider } = makeProvider()
    const servers = provider.servers({
      ...CTX,
      mcpCapabilities: { http: true }
    })
    expect(servers).toHaveLength(1)
    const server = servers[0] as {
      type: string
      url: string
      headers: Array<{ name: string; value: string }>
    }
    expect(server.type).toBe('http')
    expect(server.url).toBe('http://127.0.0.1:18899/mcp/kun')
    const bearer = server.headers.find((h) => h.name === 'Authorization')!
    const grant = tokens.verifyScope(bearer.value.slice('Bearer '.length), 'kun-tools')
    expect(grant?.threadId).toBe('thr_1')
    expect(grant?.scopes).toEqual(['kun-tools'])
  })

  it('accepts the v2 object-presence mcpCapabilities shape', () => {
    const { provider } = makeProvider()
    const servers = provider.servers({
      ...CTX,
      mcpCapabilities: { http: {} }
    })
    expect((servers[0] as { type: string }).type).toBe('http')
  })

  it('falls back to a stdio bridge descriptor with the token in env', () => {
    const { tokens, provider } = makeProvider()
    const servers = provider.servers({ ...CTX, mcpCapabilities: { http: false } })
    const server = servers[0] as unknown as {
      type: string
      command: string
      args: string[]
      env: Array<{ name: string; value: string }>
    }
    expect(server.type).toBe('stdio')
    expect(server.command).toBe('/abs/kun')
    expect(server.args).toEqual([
      '/abs/serve-entry.js',
      'mcp-bridge',
      '--token-env',
      'KUN_TOOLS_TOKEN'
    ])
    const tokenEnv = server.env.find((entry) => entry.name === 'KUN_TOOLS_TOKEN')!
    expect(tokenEnv.value.startsWith('kgw_')).toBe(true)
    // Token never lands on argv — a local process list must not leak it.
    expect(server.args.join(' ')).not.toContain(tokenEnv.value)
    expect(tokens.verifyScope(tokenEnv.value, 'kun-tools')?.threadId).toBe('thr_1')
    expect(server.env.find((entry) => entry.name === 'KUN_MCP_URL')?.value).toBe(
      'http://127.0.0.1:18899/mcp/kun'
    )
  })

  it('returns no servers when the runtime is not serve-hosted', () => {
    const { provider } = makeProvider('')
    expect(provider.servers({ ...CTX })).toEqual([])
  })

  it('rotates the token per turn and revokeTurn invalidates it', () => {
    const { tokens, provider } = makeProvider()
    const first = provider.servers({ ...CTX })[0] as {
      env: Array<{ name: string; value: string }>
    }
    const firstToken = first.env.find((e) => e.name === 'KUN_TOOLS_TOKEN')!.value
    const second = provider.servers({ ...CTX, turnId: 'turn_2' })[0] as {
      env: Array<{ name: string; value: string }>
    }
    const secondToken = second.env.find((e) => e.name === 'KUN_TOOLS_TOKEN')!.value
    expect(firstToken).not.toBe(secondToken)
    provider.revokeTurn('turn_1')
    expect(tokens.verify(firstToken)).toBeNull()
    expect(tokens.verifyScope(secondToken, 'kun-tools')).not.toBeNull()
    provider.revokeTurn('turn_1') // idempotent
    expect(tokens.verifyScope(secondToken, 'kun-tools')).not.toBeNull()
  })

  it('mints a fresh grant on session/load for the same turn and revokes both', () => {
    const { tokens, provider } = makeProvider()
    const tokenAt = (s: unknown) =>
      (s as { env: Array<{ name: string; value: string }> }).env.find(
        (e) => e.name === 'KUN_TOOLS_TOKEN'
      )!.value
    const first = tokenAt(provider.servers({ ...CTX })[0])
    const reloaded = tokenAt(provider.servers({ ...CTX })[0])
    expect(reloaded).not.toBe(first)
    provider.revokeTurn(CTX.turnId)
    expect(tokens.verify(first)).toBeNull()
    expect(tokens.verify(reloaded)).toBeNull()
  })

  it('scopes revoked kun-tools tokens out of unrelated scopes', () => {
    const { tokens, provider } = makeProvider()
    const server = provider.servers({ ...CTX })[0] as {
      env: Array<{ name: string; value: string }>
    }
    const token = server.env.find((e) => e.name === 'KUN_TOOLS_TOKEN')!.value
    expect(tokens.verifyScope(token, 'gateway')).toBeNull()
    expect(tokens.verifyScope(token, 'worker-callback')).toBeNull()
  })
})
