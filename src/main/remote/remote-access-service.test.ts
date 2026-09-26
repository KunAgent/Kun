import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    off: vi.fn(),
    getAppPath: () => '/nonexistent-kun-app'
  }
}))

vi.mock('../main-app-context', () => ({
  appEnvironment: {
    flavor: 'development',
    appName: 'kun-dv',
    appId: 'test',
    runtimeFlavor: 'development',
    profilePath: '/tmp',
    isPackaged: false
  }
}))

import type { AppSettingsV1 } from '../../shared/app-settings'
import { hashRemoteAccessPassword, RemoteSessionRegistry } from './remote-auth'
import { RemoteAccessService } from './remote-access-service'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer as createNetServer } from 'node:net'
import { request as httpRequest } from 'node:http'

const PASSWORD = 'test-password-1'

function makeSettings(): AppSettingsV1 {
  return {
    remote: {
      enabled: true,
      bind: 'loopback',
      port: 0,
      passwordHash: hashRemoteAccessPassword(PASSWORD),
      sessionTtlHours: 1
    }
  } as unknown as AppSettingsV1
}

describe('RemoteAccessService port fallback', () => {
  it('rebinds to a fresh port when the persisted one is occupied', async () => {
    const blocker = createNetServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const occupied = (blocker.address() as { port: number }).port
    const persisted: number[] = []
    const service = new RemoteAccessService({
      getSettings: async () => ({
        remote: {
          enabled: true,
          bind: 'loopback',
          port: occupied,
          passwordHash: hashRemoteAccessPassword('pw-123456'),
          sessionTtlHours: 1
        }
      }) as unknown as AppSettingsV1,
      persistRemotePatch: async (patch) => {
        if (typeof patch.port === 'number') persisted.push(patch.port)
      },
      getMainWindow: () => null,
      logError: () => undefined
    })
    try {
      await service.sync()
      expect(service.running).toBe(true)
      const status = service.status(makeSettings())
      expect(status.port).not.toBe(occupied)
      expect(status.port).toBeGreaterThan(0)
      expect(persisted).toContain(status.port)
    } finally {
      await service.destroy()
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })
})

describe('RemoteAccessService HTTP surface', () => {
  let service: RemoteAccessService
  let baseUrl = ''
  const persistedPorts: number[] = []

  beforeAll(async () => {
    service = new RemoteAccessService({
      getSettings: async () => makeSettings(),
      persistRemotePatch: async (patch) => {
        if (typeof patch.port === 'number') persistedPorts.push(patch.port)
      },
      getMainWindow: () => null,
      logError: () => undefined
    })
    await service.sync()
    expect(service.running).toBe(true)
    const status = service.status(makeSettings())
    expect(status.port).toBeGreaterThan(0)
    expect(status.running).toBe(true)
    baseUrl = `http://127.0.0.1:${status.port}`
  })

  afterAll(async () => {
    await service.destroy()
  })

  async function login(): Promise<string> {
    const response = await fetch(`${baseUrl}/remote/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('kun_remote_session=')
    return cookie.split(';')[0]
  }

  it('redirects unauthenticated page loads to the login screen', async () => {
    const response = await fetch(`${baseUrl}/`, {
      headers: { accept: 'text/html' },
      redirect: 'manual'
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/remote/login')
  })

  it('serves the login page and rejects wrong passwords', async () => {
    const page = await fetch(`${baseUrl}/remote/login`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Kun Remote')
    const bad = await fetch(`${baseUrl}/remote/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' })
    })
    expect(bad.status).toBe(403)
  })

  it('authenticates, reports status, and gates invoke by allowlist', async () => {
    const cookie = await login()
    const status = await fetch(`${baseUrl}/remote/status`, { headers: { cookie } })
    expect(status.status).toBe(200)
    const body = await status.json()
    expect(body.running).toBe(true)
    expect(body.passwordSet).toBe(true)

    const noHeader = await fetch(`${baseUrl}/remote/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ channel: 'app:version' })
    })
    expect(noHeader.status).toBe(403)

    const disallowed = await fetch(`${baseUrl}/remote/invoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-kun-remote-request': '1',
        'x-kun-remote-client': 'test-client'
      },
      body: JSON.stringify({ channel: 'remote:password:set', args: ['x'] })
    })
    expect(disallowed.status).toBe(403)

    const missingHandler = await fetch(`${baseUrl}/remote/invoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-kun-remote-request': '1',
        'x-kun-remote-client': 'test-client'
      },
      body: JSON.stringify({ channel: 'app:version' })
    })
    expect(missingHandler.status).toBe(404)
  })

  it('streams workspace files to authenticated browsers within the workspace', async () => {
    const cookie = await login()
    const dir = await mkdtemp(join(tmpdir(), 'kun-remote-test-ws-'))
    await writeFile(join(dir, 'note.txt'), 'hello remote', 'utf8')
    const url = `${baseUrl}/remote/file-preview?workspaceRoot=${encodeURIComponent(dir)}&path=note.txt`
    const response = await fetch(url, { headers: { cookie } })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hello remote')

    const outside = await fetch(
      `${baseUrl}/remote/file-preview?workspaceRoot=${encodeURIComponent(dir)}&path=${encodeURIComponent('/etc/hosts')}`,
      { headers: { cookie } }
    )
    expect(outside.status).toBe(404)

    const noRoot = await fetch(`${baseUrl}/remote/file-preview?path=${encodeURIComponent('/etc/hosts')}`, {
      headers: { cookie }
    })
    expect(noRoot.status).toBe(400)
  })

  it('sandboxes active preview content so scripts cannot reach remote control APIs', async () => {
    const cookie = await login()
    const dir = await mkdtemp(join(tmpdir(), 'kun-remote-test-ws-'))
    await writeFile(join(dir, 'payload.html'), '<script>fetch("/remote/invoke")</script>', 'utf8')
    await writeFile(join(dir, 'payload.svg'), '<svg onload="fetch(\'/remote/invoke\')"/>', 'utf8')
    await writeFile(join(dir, 'note.txt'), 'hello remote', 'utf8')
    for (const name of ['payload.html', 'payload.svg', 'note.txt']) {
      const response = await fetch(
        `${baseUrl}/remote/file-preview?workspaceRoot=${encodeURIComponent(dir)}&path=${name}`,
        { headers: { cookie } }
      )
      expect(response.status).toBe(200)
      // A bare sandbox directive disables script execution and forces a unique
      // opaque origin, so fetched content can neither run JS nor invoke
      // /remote/invoke with the visitor's session cookie.
      expect(response.headers.get('content-security-policy')).toBe('sandbox')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      await response.body?.cancel()
    }
  })

  it('accepts uploads and stores them in a host temp directory', async () => {
    const cookie = await login()
    const response = await fetch(`${baseUrl}/remote/upload`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-kun-remote-request': '1',
        'x-kun-remote-client': 'test-client'
      },
      body: JSON.stringify({ name: '../evil/shot.png', dataBase64: Buffer.from('img').toString('base64') })
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.name).not.toContain('..')
    const written = await readFile(body.path, 'utf8')
    expect(written).toBe('img')
    await rm(dirname(body.path), { recursive: true, force: true })
  })

  it('opens the SSE event stream for authenticated clients', async () => {
    const cookie = await login()
    const response = await fetch(`${baseUrl}/remote/events?client=test-client`, {
      headers: { cookie }
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    await response.body?.cancel()
  })

  it('rejects unauthenticated API calls', async () => {
    const response = await fetch(`${baseUrl}/remote/status`)
    expect(response.status).toBe(401)
  })

  it('logs out and invalidates the session', async () => {
    const cookie = await login()
    const logout = await fetch(`${baseUrl}/remote/auth/logout`, {
      method: 'POST',
      headers: { cookie }
    })
    expect(logout.status).toBe(200)
    const status = await fetch(`${baseUrl}/remote/status`, { headers: { cookie } })
    expect(status.status).toBe(401)
  })
})

describe('RemoteAccessService session teardown and shutdown', () => {
  let now: number
  let service: RemoteAccessService
  let baseUrl = ''

  beforeAll(async () => {
    now = Date.now()
    service = new RemoteAccessService({
      getSettings: async () => makeSettings(),
      persistRemotePatch: async () => undefined,
      getMainWindow: () => null,
      logError: () => undefined,
      sessions: new RemoteSessionRegistry(() => now),
      serverCloseGraceMs: 150
    })
    await service.sync()
    expect(service.running).toBe(true)
    baseUrl = `http://127.0.0.1:${service.status(makeSettings()).port}`
  })

  afterAll(async () => {
    await service.destroy()
  })

  async function login(): Promise<string> {
    const response = await fetch(`${baseUrl}/remote/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    })
    expect(response.status).toBe(200)
    return (response.headers.get('set-cookie') ?? '').split(';')[0]
  }

  function sseReaderDone(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<'ended' | 'timeout'> {
    return Promise.race([
      reader.read().then((chunk) => (chunk.done ? 'ended' as const : sseReaderDone(reader))),
      new Promise<'timeout'>((resolveTimeout) => setTimeout(() => resolveTimeout('timeout'), 3_000))
    ])
  }

  it('closes an open SSE stream when its session logs out', async () => {
    const cookie = await login()
    const events = await fetch(`${baseUrl}/remote/events?client=logout-client`, {
      headers: { cookie }
    })
    expect(events.status).toBe(200)
    const reader = events.body!.getReader()
    await reader.read()
    const logout = await fetch(`${baseUrl}/remote/auth/logout`, {
      method: 'POST',
      headers: { cookie }
    })
    expect(logout.status).toBe(200)
    expect(await sseReaderDone(reader)).toBe('ended')
    const status = await fetch(`${baseUrl}/remote/status`, { headers: { cookie } })
    expect(status.status).toBe(401)
  })

  it('closes an open SSE stream once a request finds the session expired', async () => {
    const cookie = await login()
    const events = await fetch(`${baseUrl}/remote/events?client=expired-client`, {
      headers: { cookie }
    })
    expect(events.status).toBe(200)
    const reader = events.body!.getReader()
    await reader.read()
    // Jump past the 1-hour session TTL; the next verify() must evict the
    // session and tear down the already-open stream, not just fail requests.
    now += 3_600_001
    const status = await fetch(`${baseUrl}/remote/status`, { headers: { cookie } })
    expect(status.status).toBe(401)
    expect(await sseReaderDone(reader)).toBe('ended')
  })

  it('force-closes a hung request within the shutdown grace and can re-listen', async () => {
    const cookie = await login()
    const url = new URL(baseUrl)
    // A request whose body never ends keeps its socket active server-side,
    // which is what previously stalled server.close() forever.
    const hung = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: '/remote/invoke',
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-kun-remote-request': '1',
        'x-kun-remote-client': 'hang-client',
        'content-length': '1048576'
      }
    })
    hung.on('error', () => undefined)
    hung.write('{"channel"')
    try {
      const started = Date.now()
      await service.stopServer()
      expect(Date.now() - started).toBeLessThan(5_000)
      expect(service.running).toBe(false)
    } finally {
      hung.destroy()
    }
    await service.sync()
    expect(service.running).toBe(true)
    baseUrl = `http://127.0.0.1:${service.status(makeSettings()).port}`
    const freshCookie = await login()
    const status = await fetch(`${baseUrl}/remote/status`, { headers: { cookie: freshCookie } })
    expect(status.status).toBe(200)
  })
})
