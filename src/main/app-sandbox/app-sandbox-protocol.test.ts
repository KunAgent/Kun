import { describe, expect, it, vi } from 'vitest'
import type { Session } from 'electron'
import { AppSandboxRegistry } from './app-sandbox-registry'
import { AppSandboxProtocols, isAllowedSandboxRequestScheme } from './app-sandbox-protocol'

type Handler = (request: Request) => Promise<Response> | Response

function fakeSession() {
  const handlers = new Map<string, Handler>()
  const session = {
    protocol: { handle: (scheme: string, handler: Handler) => handlers.set(scheme, handler) },
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    on: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() }
  }
  return { session: session as unknown as Session, handlers }
}

describe('AppSandboxProtocols', () => {
  it('serves the shell and guest document only to the owning partition', async () => {
    const registry = new AppSandboxRegistry()
    const protocols = new AppSandboxProtocols({
      registry,
      vendor: { isPackaged: false, appPath: process.cwd(), resourcesPath: '' },
      readMcpAppAsset: async () => null,
      passthroughFetch: async () => new Response('net')
    })
    const record = registry.create({ kind: 'gen-ui', ownerWebContentsId: 1, threadId: 't', html: '<p>page</p>', csp: "default-src 'none'" })
    const { session, handlers } = fakeSession()
    protocols.prepare(session, record.partition, 'gen-ui')
    const handle = handlers.get('kun-app')!
    const shell = await handle(new Request(record.shellUrl))
    expect(shell.status).toBe(200)
    expect(await shell.text()).toContain(record.guestUrl)
    const guest = await handle(new Request(record.guestUrl))
    expect(guest.headers.get('content-security-policy')).toBe("default-src 'none'")
    expect(guest.headers.get('cache-control')).toBe('no-store')
    expect(await guest.text()).toBe('<p>page</p>')

    const other = fakeSession()
    protocols.prepare(other.session, 'some-other-partition', 'gen-ui')
    expect((await other.handlers.get('kun-app')!(new Request(record.guestUrl))).status).toBe(403)
    expect((await handle(new Request(`kun-app://genui-${'f'.repeat(32)}/index.html`))).status).toBe(403)
  })

  it('serves pinned libraries offline and denies other network origins for Gen UI', async () => {
    const passthroughFetch = vi.fn(async () => new Response('remote'))
    const protocols = new AppSandboxProtocols({
      registry: new AppSandboxRegistry(),
      vendor: { isPackaged: false, appPath: process.cwd(), resourcesPath: '' },
      readMcpAppAsset: async () => null,
      passthroughFetch
    })
    const { session, handlers } = fakeSession()
    protocols.prepare(session, 'kun-app-genui', 'gen-ui')
    const https = handlers.get('https')!
    const d3 = await https(new Request('https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js'))
    expect(d3.status).toBe(200)
    expect((await d3.text()).length).toBeGreaterThan(10_000)
    expect(passthroughFetch).not.toHaveBeenCalled()
    expect((await https(new Request('https://evil.example.com/x.js'))).status).toBe(403)
    expect((await https(new Request('https://unpkg.com/other@1/x.js'))).status).toBe(200)
    expect(passthroughFetch).toHaveBeenCalledTimes(1)
  })

  it('resolves MCP App relative assets through the runtime and caches them per page', async () => {
    const registry = new AppSandboxRegistry()
    const readMcpAppAsset = vi.fn(async () => ({ body: new TextEncoder().encode('js'), mimeType: 'text/javascript' }))
    const protocols = new AppSandboxProtocols({
      registry,
      vendor: { isPackaged: false, appPath: process.cwd(), resourcesPath: '' },
      readMcpAppAsset,
      passthroughFetch: async () => new Response('')
    })
    const record = registry.create({
      kind: 'mcp-app', ownerWebContentsId: 1, threadId: 't', html: '<p/>', csp: 'x',
      serverId: 'kun_canvas', serverHost: 'a'.repeat(16), resourceUri: 'ui://kun-canvas/index.html'
    })
    const { session, handlers } = fakeSession()
    protocols.prepare(session, record.partition, 'mcp-app')
    const asset = record.guestUrl.replace('index.html', 'assets/app.js')
    expect(await (await handlers.get('kun-app')!(new Request(asset))).text()).toBe('js')
    await handlers.get('kun-app')!(new Request(asset))
    expect(readMcpAppAsset).toHaveBeenCalledTimes(1)
    expect(readMcpAppAsset).toHaveBeenCalledWith(record, 'assets/app.js')
    expect(handlers.has('https')).toBe(false)
  })

  it('allows only sandbox, https, wss, data and blob requests', () => {
    expect(isAllowedSandboxRequestScheme('kun-app://shell-x/')).toBe(true)
    expect(isAllowedSandboxRequestScheme('https://x.example/')).toBe(true)
    expect(isAllowedSandboxRequestScheme('file:///etc/passwd')).toBe(false)
    expect(isAllowedSandboxRequestScheme('http://127.0.0.1:18899/v1/threads')).toBe(false)
  })
})
