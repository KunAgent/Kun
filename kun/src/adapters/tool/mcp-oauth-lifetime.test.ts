import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig } from '../../contracts/capabilities.js'
import { McpOAuthLifetime } from './mcp-oauth-lifetime.js'
import { FileMcpOAuthStore } from './mcp-oauth-store.js'
import { createMcpOAuthProvider } from './mcp-oauth-provider.js'
import { buildMcpToolProviders, McpAuthorizationRequiredError } from './mcp-tool-provider.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const config = McpCapabilityConfig.parse({
  enabled: true,
  servers: { docs: { enabled: true, transport: 'streamable-http', url: 'https://example.com/mcp', trustScope: 'user' } },
  search: { enabled: false }
})

describe('MCP shutdown during OAuth', () => {
  it('does not connect or register when authorization completes after close', async () => {
    const auth = deferred<{ serverId: string; status: 'authorized'; authorized: true }>()
    const factory = vi.fn(async () => { throw new McpAuthorizationRequiredError('docs') })
    const built = await buildMcpToolProviders(config, { clientFactory: factory, oauthStorageDir: '/unused', authorize: () => auth.promise })
    const register = vi.fn()
    await built.startBackgroundReconnect({ register, unregister: vi.fn() })
    const pending = built.authorizeOAuth('docs')
    await built.close()
    auth.resolve({ serverId: 'docs', status: 'authorized', authorized: true })
    await pending
    expect(factory).toHaveBeenCalledTimes(1)
    expect(register).not.toHaveBeenCalled()
    expect(built.toolCount).toBe(0)
  })

  it('closes a client whose catalog completes after close without registering it', async () => {
    const listing = deferred<{ tools: Array<{ name: string; inputSchema: { type: 'object' } }> }>()
    const started = deferred<void>()
    const client = { listTools: vi.fn(() => { started.resolve(); return listing.promise }), callTool: vi.fn(), close: vi.fn(async () => undefined) }
    const factory = vi.fn().mockRejectedValueOnce(new McpAuthorizationRequiredError('docs')).mockResolvedValueOnce(client)
    const built = await buildMcpToolProviders(config, {
      clientFactory: factory, oauthStorageDir: '/unused',
      authorize: async () => ({ serverId: 'docs', status: 'authorized', authorized: true })
    })
    const register = vi.fn()
    await built.startBackgroundReconnect({ register, unregister: vi.fn() })
    const pending = built.authorizeOAuth('docs')
    await started.promise
    await built.close()
    expect(client.close).toHaveBeenCalledTimes(1)
    listing.resolve({ tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] })
    await pending
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(register).not.toHaveBeenCalled()
    expect(built.toolCount).toBe(0)
  })

  it('rejects a credential clear after close without erasing stored credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-clear-lifetime-'))
    try {
      const oauthConfig = McpCapabilityConfig.parse({
        ...config,
        servers: { docs: { ...config.servers.docs, oauth: { enabled: true } } }
      })
      const provider = createMcpOAuthProvider('docs', oauthConfig.servers.docs, { storageDir: dir })!
      await provider.saveCodeVerifier('original')
      const built = await buildMcpToolProviders(oauthConfig, {
        oauthStorageDir: dir,
        clientFactory: async () => { throw new McpAuthorizationRequiredError('docs') },
        backgroundReconnect: { enabled: false }
      })
      await built.close()
      await expect(built.clearOAuthCredentials('docs')).rejects.toThrow()
      await expect(provider.codeVerifier()).resolves.toBe('original')
      await expect(built.clearOAuthCredentials('missing')).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects writes after shutdown without replacing existing credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-lifetime-'))
    try {
      const lifetime = new McpOAuthLifetime()
      const path = join(dir, 'oauth.json')
      const store = new FileMcpOAuthStore(path, undefined, lifetime)
      await store.update(() => ({ codeVerifier: 'original' }))
      await lifetime.close()
      await expect(store.update(() => ({ codeVerifier: 'late' }))).rejects.toThrow()
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ codeVerifier: 'original' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
