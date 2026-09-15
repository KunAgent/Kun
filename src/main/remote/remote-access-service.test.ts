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
import { hashRemoteAccessPassword } from './remote-auth'
import { RemoteAccessService } from './remote-access-service'

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
