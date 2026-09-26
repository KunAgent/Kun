import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canFallbackToRemoteIndex,
  chooseRemoteStaticSource,
  isRemoteModulePathname,
  isWebKitRemoteClient,
  remoteBridgeScript,
  remoteResponseLooksLikeHtml,
  resolveRemoteStaticPath,
  serveRemoteStaticFile,
  shouldGzipRemoteAsset
} from './remote-static'

const ROOT = '/app/out/renderer'

describe('resolveRemoteStaticPath', () => {
  it('resolves ordinary asset paths under the root', () => {
    expect(resolveRemoteStaticPath(ROOT, '/index.html')).toBe(`${ROOT}/index.html`)
    expect(resolveRemoteStaticPath(ROOT, '/assets/app-123.js')).toBe(`${ROOT}/assets/app-123.js`)
    expect(resolveRemoteStaticPath(ROOT, '/')).toBe(ROOT)
  })

  it('absorbs traversal attempts back inside the root', () => {
    for (const path of [
      '/../main/index.js',
      '/../../etc/passwd',
      '/%2e%2e/%2e%2e/secret',
      '/assets/../../out/main/x.js'
    ]) {
      const resolved = resolveRemoteStaticPath(ROOT, path)
      // normalize() collapses '..' against the root; nothing may escape it.
      expect(resolved === null || resolved === ROOT || resolved.startsWith(`${ROOT}/`)).toBe(true)
    }
  })

  it('rejects malformed input', () => {
    expect(resolveRemoteStaticPath(ROOT, '/%E0%A4%A')).toBeNull()
    expect(resolveRemoteStaticPath(ROOT, '/a\0b')).toBeNull()
  })
})

describe('remote static policy', () => {
  it('only falls back to index.html for document paths', () => {
    expect(canFallbackToRemoteIndex('/')).toBe(true)
    expect(canFallbackToRemoteIndex('/settings')).toBe(true)
    expect(canFallbackToRemoteIndex('/index.html')).toBe(true)
    expect(canFallbackToRemoteIndex('/assets/app-123.js')).toBe(false)
    expect(canFallbackToRemoteIndex('/assets/app-123.css')).toBe(false)
    expect(canFallbackToRemoteIndex('/assets/app-123.js.map')).toBe(false)
    expect(canFallbackToRemoteIndex('/assets/app.wasm')).toBe(false)
  })

  it('treats Vite and hashed script paths as modules', () => {
    expect(isRemoteModulePathname('/src/App.tsx')).toBe(true)
    expect(isRemoteModulePathname('/@vite/client')).toBe(true)
    expect(isRemoteModulePathname('/node_modules/.vite/deps/react.js')).toBe(true)
    expect(isRemoteModulePathname('/assets/Workbench-abc.js')).toBe(true)
    expect(isRemoteModulePathname('/')).toBe(false)
    expect(remoteResponseLooksLikeHtml('text/html; charset=utf-8')).toBe(true)
    expect(remoteResponseLooksLikeHtml('text/javascript; charset=utf-8')).toBe(false)
  })

  it('routes Safari and iPhone to the bundled renderer', () => {
    expect(isWebKitRemoteClient(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    )).toBe(true)
    expect(isWebKitRemoteClient(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    )).toBe(true)
    expect(isWebKitRemoteClient(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
    )).toBe(false)
    expect(chooseRemoteStaticSource({
      hasBundledRenderer: true,
      devUrl: 'http://127.0.0.1:5173',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
    })).toBe('bundle')
    expect(chooseRemoteStaticSource({
      hasBundledRenderer: false,
      devUrl: 'http://127.0.0.1:5173',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
    })).toBe('missing-bundle')
    expect(chooseRemoteStaticSource({
      hasBundledRenderer: true,
      devUrl: 'http://127.0.0.1:5173',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36'
    })).toBe('vite')
    expect(chooseRemoteStaticSource({
      hasBundledRenderer: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
    })).toBe('bundle')
    expect(shouldGzipRemoteAsset('.js', 'gzip, deflate, br')).toBe(true)
    expect(shouldGzipRemoteAsset('.png', 'gzip')).toBe(false)
  })
})

describe('serveRemoteStaticFile', () => {
  it('gzips javascript when the client accepts it and never serves HTML for missing scripts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-remote-static-'))
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'assets', 'app.js'), 'export const ok = 1\n', 'utf8')
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const pathname = new URL(req.url ?? '/', 'http://remote.local').pathname
      const served = serveRemoteStaticFile(root, pathname, res, {
        acceptEncoding: String(req.headers['accept-encoding'] ?? '')
      })
      if (served) return
      if (!canFallbackToRemoteIndex(pathname)) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'Not found' }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html>spa</html>')
    })
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as { port: number }).port
      const baseUrl = `http://127.0.0.1:${port}`
      const js = await new Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }>((resolve, reject) => {
        httpRequest(`${baseUrl}/assets/app.js`, { headers: { 'accept-encoding': 'gzip' } }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => chunks.push(chunk))
          response.on('end', () => resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks)
          }))
        }).on('error', reject).end()
      })
      expect(js.status).toBe(200)
      expect(String(js.headers['content-type'])).toContain('text/javascript')
      expect(js.headers['content-encoding']).toBe('gzip')
      expect(js.headers['x-content-type-options']).toBe('nosniff')
      expect(gunzipSync(js.body).toString('utf8')).toContain('export const ok')
      const missing = await fetch(`${baseUrl}/assets/missing-chunk.js`)
      expect(missing.status).toBe(404)
      expect(missing.headers.get('content-type')).not.toContain('text/html')
      const spa = await fetch(`${baseUrl}/settings`)
      expect(spa.status).toBe(200)
      expect(await spa.text()).toContain('spa')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('remoteBridgeScript', () => {
  // Minimal browser globals the bridge touches while installing.
  function browserWindow(): Record<string, unknown> {
    const storage = new Map<string, string>()
    const window: Record<string, unknown> = {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value)
      },
      crypto: { randomUUID: () => 'client-test' },
      document: { visibilityState: 'visible', addEventListener: () => undefined },
      location: { href: '/' },
      addEventListener: () => undefined,
      EventSource: class { addEventListener(): void {} close(): void {} },
      fetch: () => new Promise(() => undefined)
    }
    window.window = window
    return window
  }

  it('installs window.kunGui from the shipped bridge parts', () => {
    const bridgePath = resolve(__dirname, '../../renderer/public/remote-bridge.js')
    const script = remoteBridgeScript(bridgePath, { platform: 'darwin' }, true)
    expect(script).not.toBeNull()
    const window = browserWindow()
    runInNewContext(script!, window)
    expect(typeof (window.kunGui as { getSettings?: unknown }).getSettings).toBe('function')
  })

  it('keeps an unterminated IIFE part from calling into the next part', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-remote-bridge-'))
    try {
      await writeFile(join(dir, 'remote-bridge-transport.js'), 'window.a = function () { return 1 }')
      await writeFile(join(dir, 'remote-bridge-browser.js'), 'window.b = (function () { return {} })()')
      await writeFile(join(dir, 'remote-bridge.js'), '(function () { window.kunGui = { ok: true } })()')
      const script = remoteBridgeScript(join(dir, 'remote-bridge.js'), {}, true)
      const window = browserWindow()
      expect(() => runInNewContext(script!, window)).not.toThrow()
      expect(window.kunGui).toEqual({ ok: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
