import { describe, expect, it, vi } from 'vitest'
import { AppConnectionError } from '../contracts/app-connections.js'
import { AppConnectionsService } from './app-connections-service.js'
import { FigmaCredentialStore } from '../figma/figma-credential-store.js'
import type { FigmaReadServicePort } from '../figma/ports.js'
import type { ExtensionCredentialPayload } from './extension-credential-store.js'

function memoryCredentials() {
  const rows = new Map<string, ExtensionCredentialPayload>()
  const store = new FigmaCredentialStore({
    get: async (reference: string) => rows.get(reference) ?? null,
    set: async (reference: string, payload: ExtensionCredentialPayload) => { rows.set(reference, payload) },
    delete: async (reference: string) => { rows.delete(reference) }
  })
  return { rows, store }
}

function figmaService(overrides: Partial<FigmaReadServicePort> = {}): FigmaReadServicePort {
  return {
    identify: async () => ({ id: '42', handle: 'designer', email: 'designer@example.com' }),
    readFile: async () => ({ fileKey: 'abcdefghij', name: 'File', lastModified: null, version: null, role: null, depth: 2, pages: [] }),
    readNodes: async () => ({ fileKey: 'abcdefghij', nodes: [], missingNodeIds: [] }),
    exportImages: async () => ({ fileKey: 'abcdefghij', images: [], missingNodeIds: [], download: { supported: false, reason: 'x' } }),
    ...overrides
  }
}

function github(overrides: Record<string, unknown> = {}) {
  return {
    status: vi.fn(async () => ({
      configured: true, connected: true, allowModelSharing: false, reconnectRequired: false,
      login: 'octocat', repositoryCount: 2, repositories: ['a', 'b']
    })),
    authorizeAccount: vi.fn(async () => ({ id: 'auth-1', status: 'pending' as const, expiresAt: '2030-01-01T00:00:00.000Z' })),
    pollAccount: vi.fn(async () => ({ id: 'auth-1', status: 'connected', expiresAt: '2030-01-01T00:00:00.000Z' })),
    cancelAccount: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    ...overrides
  }
}

function gmail() {
  return {
    status: vi.fn(async () => ({
      configured: false, connected: false, allowModelSharing: false, reconnectRequired: false
    }))
  }
}

function build(options: { github?: ReturnType<typeof github>; figmaToken?: string } = {}) {
  const credentials = memoryCredentials()
  if (options.figmaToken) {
    void credentials.store.saveToken(options.figmaToken)
  }
  const state = { connected: Boolean(options.figmaToken) }
  const githubDeps = options.github ?? github()
  const service = new AppConnectionsService({
    github: githubDeps,
    gmail: gmail(),
    figma: { credentials: credentials.store, service: figmaService(), state },
    platform: 'darwin'
  })
  return { service, credentials, state, github: githubDeps }
}

describe('app connections service', () => {
  it('projects account readiness without implying a conversation grant', async () => {
    const { service } = build()
    const githubView = (await service.list()).find((view) => view.presetId === 'github')
    expect(githubView).toMatchObject({
      accountStatus: 'connected',
      accountLabel: 'octocat',
      availability: 'ready',
      revision: 0
    })
    expect(githubView?.toolCount).toBeGreaterThan(0)
  })

  it('keeps planned and vendor-approval presets out of the connect path', async () => {
    const { service, github: deps } = build()
    const views = await service.list()
    const notion = views.find((view) => view.presetId === 'notion')
    expect(notion).toMatchObject({ availability: 'planned', accountStatus: 'disconnected' })
    await expect(service.connect('notion')).rejects.toMatchObject({ code: 'not_ready' })
    await expect(service.connect('figma-desktop')).rejects.toMatchObject({ code: 'not_ready' })
    expect(deps.authorizeAccount).not.toHaveBeenCalled()
  })

  it('rejects unknown presets and unsupported platforms', async () => {
    const { service } = build()
    await expect(service.status('nope')).rejects.toMatchObject({ code: 'not_found' })
    const windows = new AppConnectionsService({ platform: 'win32' })
    await expect(windows.connect('github')).rejects.toMatchObject({ code: 'connect_failed' })
    const linux = new AppConnectionsService({ platform: 'linux' })
    // Figma Desktop is macOS/Windows only, but it is also not ready yet.
    await expect(linux.connect('figma-desktop')).rejects.toMatchObject({ code: 'not_ready' })
  })

  it('starts an account login only, never a conversation authorization', async () => {
    const { service, github: deps } = build()
    const attempt = await service.connect('github')
    expect(attempt).toMatchObject({ presetId: 'github', attemptId: 'auth-1' })
    expect(deps.authorizeAccount).toHaveBeenCalledTimes(1)
    expect(await service.status('github')).toMatchObject({ revision: 1 })
    expect(deps.pollAccount).not.toHaveBeenCalled()
  })

  it('stores a verified Figma token and hides it from the view', async () => {
    const { service, credentials, state } = build()
    const view = await service.setCredential('figma-api', '  figd_secret  ')
    expect(state.connected).toBe(true)
    expect(credentials.rows.get('cred_figma-pat')?.accessToken).toBe('figd_secret')
    expect(view).toMatchObject({ accountStatus: 'connected', toolCount: 3, nextAction: 'manage' })
    expect(JSON.stringify(view)).not.toContain('figd_secret')
  })

  it('discards a rejected Figma token instead of keeping it', async () => {
    const credentials = memoryCredentials()
    const service = new AppConnectionsService({
      figma: {
        credentials: credentials.store,
        service: figmaService({
          identify: async () => {
            throw Object.assign(new Error('invalid token'), { code: 'credential_invalid' })
          }
        }),
        state: { connected: false }
      },
      platform: 'darwin'
    })
    await expect(service.setCredential('figma-api', 'figd_bad')).rejects.toMatchObject({
      code: 'credential_rejected'
    })
    expect(credentials.rows.has('cred_figma-pat')).toBe(false)
  })

  it('refuses credentials for apps that do not use them', async () => {
    const { service } = build()
    await expect(service.setCredential('github', 'pat')).rejects.toMatchObject({
      code: 'unsupported_operation'
    })
  })

  it('disconnects Figma locally and keeps provider revocation separate', async () => {
    const { service, credentials, state } = build({ figmaToken: 'figd_live' })
    const view = await service.disconnect('figma-api')
    expect(credentials.rows.has('cred_figma-pat')).toBe(false)
    expect(state.connected).toBe(false)
    expect(view).toMatchObject({ accountStatus: 'disconnected', revision: 1 })
    expect(view.nextAction).toBe('add_credential')
  })

  it('routes Gmail disconnect back to its conversation card', async () => {
    const { service } = build()
    await expect(service.disconnect('google_gmail')).rejects.toMatchObject({
      code: 'unsupported_operation'
    })
    await expect(service.connect('google_gmail')).rejects.toMatchObject({
      code: 'unsupported_operation'
    })
  })

  it('reports a missing release configuration instead of a login loop', async () => {
    const unconfigured = github({
      status: vi.fn(async () => ({
        configured: false, connected: false, allowModelSharing: false, reconnectRequired: false,
        repositoryCount: 0, repositories: []
      }))
    })
    const { service } = build({ github: unconfigured as never })
    expect((await service.status('github'))).toMatchObject({
      accountStatus: 'unavailable',
      errorCode: 'app_not_configured'
    })
  })

  it('surfaces a pending account authorization as the next action', async () => {
    const pending = github({
      status: vi.fn(async () => ({
        configured: true, connected: false, allowModelSharing: false, reconnectRequired: false,
        repositoryCount: 0, repositories: [],
        pendingAccountAuthorization: { id: 'auth-9', status: 'pending', expiresAt: '2030-01-01T00:00:00.000Z' }
      }))
    })
    const { service } = build({ github: pending as never })
    expect(await service.status('github')).toMatchObject({
      accountStatus: 'pending',
      nextAction: 'authorize'
    })
  })

  it('wraps GitHub login failures without leaking internals', async () => {
    const failing = github({
      authorizeAccount: vi.fn(async () => {
        throw new Error('callback port 12345 busy')
      })
    })
    const { service } = build({ github: failing as never })
    const error = await service.connect('github').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AppConnectionError)
    expect((error as AppConnectionError).code).toBe('connect_failed')
  })
})
