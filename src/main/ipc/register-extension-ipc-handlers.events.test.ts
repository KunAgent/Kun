import {
  fixture,
  getExtensionIpcElectronMock,
  resetExtensionIpcHandlerTestState
} from './register-extension-ipc-handlers.test-support'
import {
  resolve
} from 'node:path'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

const electronMock = getExtensionIpcElectronMock()

describe('extension IPC security bridge environment and events', () => {
  beforeEach(resetExtensionIpcHandlerTestState)

  it('serves the real workbench environment locally and publishes live changes to bound guests', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const guest = {
      id: 20,
      once: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
      close: vi.fn()
    }
    state.viewSessions.bindNextGuest(1, guest as never)

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-theme',
        method: 'ui.getTheme',
        params: {}
      }
    )).resolves.toMatchObject({ kind: 'light', tokens: { foreground: '#233659' } })
    expect(state.runtimeRequest).not.toHaveBeenCalled()

    state.setWorkbenchEnvironment({
      theme: {
        kind: 'dark',
        tokens: { foreground: '#f0f5fc' },
        zoomFactor: 1.25,
        reducedMotion: true
      },
      locale: { language: 'zh', direction: 'ltr', messages: {} }
    })
    await state.registration.publishWorkbenchEnvironmentChanged()

    expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/workbench/environment',
      'PUT',
      JSON.stringify({
        theme: {
          kind: 'dark',
          tokens: { foreground: '#f0f5fc' },
          zoomFactor: 1.25,
          reducedMotion: true
        },
        locale: { language: 'zh', direction: 'ltr', messages: {} }
      })
    )
    expect(guest.send).toHaveBeenCalledWith('extension:view:notification', {
      sessionId: record.sessionId,
      method: 'ui.themeChanged',
      params: expect.objectContaining({ kind: 'dark', zoomFactor: 1.25, reducedMotion: true })
    })
    expect(guest.send).toHaveBeenCalledWith('extension:view:notification', {
      sessionId: record.sessionId,
      method: 'ui.localeChanged',
      params: { language: 'zh', direction: 'ltr', messages: {} }
    })
  })

  it('serializes environment PUTs and coalesces queued publishes to the latest Host state', async () => {
    const state = fixture()
    const broadcastToGuests = vi.spyOn(state.viewSessions, 'broadcastToGuests')
    type RuntimeResult = { ok: boolean; status: number; body: string }
    const success: RuntimeResult = { ok: true, status: 200, body: '{}' }
    const pendingPuts: Array<{
      body: string
      resolve: (result: RuntimeResult) => void
    }> = []
    const deferredRuntimeRequest = vi.fn((
      path: string,
      method?: string,
      body?: string,
      _headers?: Record<string, string>
    ): Promise<RuntimeResult> => {
      if (path !== '/v1/extensions/workbench/environment' || method !== 'PUT') {
        return Promise.resolve(success)
      }
      return new Promise((resolve) => {
        pendingPuts.push({ body: body ?? '', resolve })
      })
    })
    state.options.runtimeRequest = deferredRuntimeRequest

    const firstPublish = state.registration.publishWorkbenchEnvironmentChanged()
    await vi.waitFor(() => expect(pendingPuts).toHaveLength(1))

    state.setWorkbenchEnvironment({
      theme: {
        kind: 'dark',
        tokens: { foreground: '#f0f5fc' },
        zoomFactor: 1.25,
        reducedMotion: true
      },
      locale: { language: 'zh', direction: 'ltr', messages: {} }
    })
    const intermediatePublish = state.registration.publishWorkbenchEnvironmentChanged()
    state.setWorkbenchEnvironment({
      theme: {
        kind: 'dark',
        tokens: { foreground: '#ffffff' },
        zoomFactor: 1.5,
        reducedMotion: false
      },
      locale: { language: 'en', direction: 'ltr', messages: { ready: 'Ready' } }
    })
    const latestPublish = state.registration.publishWorkbenchEnvironmentChanged()

    await Promise.resolve()
    expect(pendingPuts).toHaveLength(1)
    expect(JSON.parse(pendingPuts[0]!.body)).toMatchObject({
      theme: { kind: 'light', zoomFactor: 1 },
      locale: { language: 'en' }
    })

    pendingPuts[0]!.resolve(success)
    await vi.waitFor(() => expect(pendingPuts).toHaveLength(2))
    expect(broadcastToGuests).not.toHaveBeenCalled()
    expect(JSON.parse(pendingPuts[1]!.body)).toEqual({
      theme: {
        kind: 'dark',
        tokens: { foreground: '#ffffff' },
        zoomFactor: 1.5,
        reducedMotion: false
      },
      locale: { language: 'en', direction: 'ltr', messages: { ready: 'Ready' } }
    })

    pendingPuts[1]!.resolve(success)
    await Promise.all([firstPublish, intermediatePublish, latestPublish])
    expect(deferredRuntimeRequest).toHaveBeenCalledTimes(2)
    expect(broadcastToGuests).toHaveBeenCalledTimes(2)
    expect(broadcastToGuests).toHaveBeenNthCalledWith(
      1,
      'ui.themeChanged',
      expect.objectContaining({ kind: 'dark', zoomFactor: 1.5 })
    )
    expect(broadcastToGuests).toHaveBeenNthCalledWith(
      2,
      'ui.localeChanged',
      { language: 'en', direction: 'ltr', messages: { ready: 'Ready' } }
    )
  })

  it('queues trusted HostMessages for one owned View Session through the bounded runtime pump', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })

    await electronMock.handlers.get('extension:view-session:message')!(state.trustedEvent, {
      sessionId: record.sessionId,
      channel: 'preview.initialize',
      payload: { artifactId: 'artifact-1' }
    })

    expect(state.runtimeRequest).toHaveBeenCalledWith(
      `/v1/extensions/view-sessions/${record.runtimeSessionId}/host-messages`,
      'POST',
      JSON.stringify({
        channel: 'preview.initialize',
        payload: { artifactId: 'artifact-1' }
      })
    )
  })

  it('routes only View-safe replayed broker notifications to the owning guest', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const guest = {
      id: 20,
      once: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
      close: vi.fn()
    }
    state.viewSessions.bindNextGuest(1, guest as never)
    state.runtimeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        events: [
          {
            sequence: 2,
            type: 'bridge',
            payload: {
              method: 'agent.event',
              params: { subscriptionId: 'agentsub-1', event: { sequence: 7 } }
            }
          },
          {
            sequence: 3,
            type: 'bridge',
            payload: {
              method: 'jobs.event',
              params: { subscriptionId: 'jobsub-1', event: { jobId: 'job_12345678', sequence: 3 } }
            }
          },
          {
            sequence: 4,
            type: 'bridge',
            payload: {
              method: 'workspace.changed',
              params: { path: 'private.txt' }
            }
          }
        ],
        nextCursor: 4,
        hasMore: false
      })
    })

    await electronMock.handlers.get('extension:view-session:events')!(state.trustedEvent, {
      sessionId: record.sessionId,
      cursor: 1,
      limit: 10
    })

    expect(guest.send).toHaveBeenCalledWith('extension:view:notification', {
      sessionId: record.sessionId,
      method: 'agent.event',
      params: { subscriptionId: 'agentsub-1', event: { sequence: 7 } }
    })
    expect(guest.send).toHaveBeenCalledWith('extension:view:notification', {
      sessionId: record.sessionId,
      method: 'jobs.event',
      params: { subscriptionId: 'jobsub-1', event: { jobId: 'job_12345678', sequence: 3 } }
    })
    expect(guest.send).not.toHaveBeenCalledWith('extension:view:notification', {
      sessionId: record.sessionId,
      method: 'workspace.changed',
      params: { path: 'private.txt' }
    })
  })

  it('reconnects the production event pump from a bounded cursor gap and resumes live delivery', async () => {
    const state = fixture()
    state.descriptors.resolveView.mockResolvedValue({
      extensionVersion: '1.0.0',
      entry: 'dist/index.html',
      grantedPermissions: ['ui.views', 'webview']
    })
    let eventPoll = 0
    state.runtimeRequest.mockImplementation(async (path: string, method?: string) => {
      if (path === '/v1/extensions/view-sessions' && method === 'POST') {
        return {
          ok: true,
          status: 201,
          body: JSON.stringify({
            sessionId: 'view_12345678-1234-1234-1234-123456789abc',
            nonce: 'n'.repeat(43),
            extensionId: 'acme.example',
            extensionVersion: '1.0.0',
            contributionId: 'extension:acme.example/issues'
          })
        }
      }
      if (path.includes('/events?')) {
        eventPoll += 1
        if (eventPoll === 1) {
          return {
            ok: false,
            status: 409,
            body: JSON.stringify({ code: 'cursor_expired', oldestAvailableCursor: 4 })
          }
        }
        if (eventPoll === 2) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              events: [{
                sequence: 5,
                type: 'bridge',
                payload: {
                  method: 'agent.event',
                  params: { subscriptionId: 'agentsub-live', event: { sequence: 9 } }
                }
              }],
              nextCursor: 5,
              hasMore: false
            })
          }
        }
        return { ok: false, status: 404, body: '{}' }
      }
      return { ok: true, status: 200, body: '{}' }
    })

    const created = await electronMock.handlers.get('extension:view-session:create')!(
      state.trustedEvent,
      { contributionId: 'extension:acme.example/issues' }
    ) as { sessionId: string; src: string }
    expect(state.viewProtocols.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: created.sessionId }),
      expect.objectContaining({ extensionVersion: '1.0.0', entry: 'dist/index.html' })
    )
    state.viewSessions.prepareAttach(1, created.src)
    const guest = {
      id: 20,
      once: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
      close: vi.fn()
    }
    state.viewSessions.bindNextGuest(1, guest as never)

    await vi.waitFor(() => expect(guest.send).toHaveBeenCalledWith(
      'extension:view:notification',
      {
        sessionId: created.sessionId,
        method: 'agent.event',
        params: { subscriptionId: 'agentsub-live', event: { sequence: 9 } }
      }
    ))
    expect(guest.send).toHaveBeenCalledWith('extension:view:notification', {
      sessionId: created.sessionId,
      method: 'ui.message',
      params: {
        channel: 'kun.extension.view.overflow',
        payload: { code: 'cursor_expired', oldestAvailableCursor: 4 }
      }
    })
    expect(eventPoll).toBeGreaterThanOrEqual(2)
    await vi.waitFor(() => expect(state.mainContents.send).toHaveBeenCalledWith(
      'extension:view-session:invalidated',
      { sessionId: created.sessionId }
    ))
    expect(state.viewSessions.get(created.sessionId)).toBeUndefined()
    state.registration.dispose()
  })

  it('binds reviewed external Webview hosts into the Main-owned View Session', async () => {
    const state = fixture()
    state.descriptors.resolveView.mockResolvedValue({
      extensionId: 'acme.social',
      extensionVersion: '1.0.0',
      packageRoot: '/extensions/acme.social/1.0.0',
      entry: 'dist/index.html',
      localResourceRoots: ['dist'],
      grantedPermissions: [
        'ui.views',
        'webview',
        'webview.external',
        'network:bilibili.com',
        'network:*.bilibili.com'
      ]
    })
    state.runtimeRequest.mockImplementation(async (path: string, method?: string) => {
      if (path === '/v1/extensions/view-sessions' && method === 'POST') {
        return {
          ok: true,
          status: 201,
          body: JSON.stringify({
            sessionId: 'view_12345678-1234-1234-1234-123456789abc',
            nonce: 'n'.repeat(43),
            extensionId: 'acme.social',
            extensionVersion: '1.0.0',
            contributionId: 'extension:acme.social/social'
          })
        }
      }
      return { ok: false, status: 404, body: '{}' }
    })

    const created = await electronMock.handlers.get('extension:view-session:create')!(
      state.trustedEvent,
      { contributionId: 'extension:acme.social/social' }
    ) as { sessionId: string }

    expect(state.viewSessions.get(created.sessionId)?.externalWebviewHosts).toEqual([
      '*.bilibili.com',
      'bilibili.com'
    ])
    const sessionPostIndex = state.runtimeRequest.mock.calls.findIndex(
      ([path, method]) => path === '/v1/extensions/view-sessions' && method === 'POST'
    )
    expect(state.runtimeRequest.mock.invocationCallOrder[sessionPostIndex]!).toBeLessThan(
      state.descriptors.resolveView.mock.invocationCallOrder[0]!
    )
    expect(state.descriptors.resolveView).toHaveBeenCalledTimes(1)
    state.registration.dispose()
  })

  it('rolls back a runtime View Session when its current descriptor no longer resolves', async () => {
    const state = fixture()
    state.descriptors.resolveView.mockRejectedValue(new Error('workspace grant was revoked'))
    state.runtimeRequest.mockImplementation(async (path: string, method?: string) => {
      if (path === '/v1/extensions/view-sessions' && method === 'POST') {
        return {
          ok: true,
          status: 201,
          body: JSON.stringify({
            sessionId: 'view_12345678-1234-1234-1234-123456789abc',
            nonce: 'n'.repeat(43),
            extensionId: 'acme.example',
            extensionVersion: '1.0.0',
            contributionId: 'extension:acme.example/issues'
          })
        }
      }
      return { ok: true, status: 200, body: '{}' }
    })

    await expect(electronMock.handlers.get('extension:view-session:create')!(
      state.trustedEvent,
      { contributionId: 'extension:acme.example/issues', workspaceRoot: '/workspace' }
    )).rejects.toThrow(/workspace grant was revoked/)

    expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/view-sessions/view_12345678-1234-1234-1234-123456789abc',
      'DELETE'
    )
    expect(state.viewSessions.get('view_12345678-1234-1234-1234-123456789abc')).toBeUndefined()
    state.registration.dispose()
  })

  it('mounts the native external browser only for a workbench-owned reviewed Session', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      extensionId: 'acme.social',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.social/social',
      entryPath: 'dist/index.html',
      externalWebviewHosts: ['bilibili.com', '*.bilibili.com'],
      parentWebContentsId: state.mainContents.id
    })
    const bounds = { x: 700, y: 120, width: 500, height: 680, visible: true }

    await electronMock.handlers.get('extension:external-browser:control')!(state.trustedEvent, {
      sessionId: record.sessionId,
      action: 'mount',
      siteId: 'bilibili',
      url: 'https://www.bilibili.com/',
      presentation: 'mobile',
      bounds
    })

    expect(state.externalBrowsers.mount).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: record.sessionId }),
      expect.objectContaining({ webContents: state.mainContents }),
      'bilibili',
      'https://www.bilibili.com/',
      bounds,
      'mobile'
    )
    await expect(electronMock.handlers.get('extension:external-browser:control')!(
      state.untrustedEvent,
      {
        sessionId: record.sessionId,
        action: 'navigate',
        url: 'https://www.bilibili.com/video/BV1'
      }
    )).rejects.toThrow(/trusted workbench/)
    state.registration.dispose()
  })

  it('rolls back the runtime View Session when isolated protocol preparation fails', async () => {
    const state = fixture()
    state.descriptors.resolveView.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      packageRoot: '/extensions/acme.example/1.0.0',
      entry: 'dist/index.html',
      localResourceRoots: ['dist/assets'],
      grantedPermissions: ['ui.views', 'webview']
    })
    state.viewProtocols.prepare.mockImplementationOnce(() => {
      throw new Error('isolated protocol unavailable')
    })
    state.runtimeRequest.mockImplementation(async (path: string, method?: string) => {
      if (path === '/v1/extensions/view-sessions' && method === 'POST') {
        return {
          ok: true,
          status: 201,
          body: JSON.stringify({
            sessionId: 'view_12345678-1234-1234-1234-123456789abc',
            nonce: 'n'.repeat(43),
            extensionId: 'acme.example',
            extensionVersion: '1.0.0',
            contributionId: 'extension:acme.example/issues'
          })
        }
      }
      return { ok: true, status: 200, body: '{}' }
    })

    await expect(electronMock.handlers.get('extension:view-session:create')!(
      state.trustedEvent,
      { contributionId: 'extension:acme.example/issues' }
    )).rejects.toThrow(/isolated protocol unavailable/)

    expect(state.viewSessions.get('view_12345678-1234-1234-1234-123456789abc')).toBeUndefined()
    await vi.waitFor(() => expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/view-sessions/view_12345678-1234-1234-1234-123456789abc',
      'DELETE'
    ))
  })

  it('clears Host crash state before an explicit View retry without forwarding the recovery flag', async () => {
    const state = fixture()
    state.descriptors.resolveView.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      packageRoot: '/extensions/acme.example/1.0.0',
      entry: 'dist/index.html',
      localResourceRoots: ['dist/assets'],
      grantedPermissions: ['ui.views', 'webview']
    })
    state.runtimeRequest.mockImplementation(async (path: string, method?: string) => {
      if (path === '/v1/extensions/acme.example/retry' && method === 'POST') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/extensions/view-sessions' && method === 'POST') {
        return {
          ok: true,
          status: 201,
          body: JSON.stringify({
            sessionId: 'view_12345678-1234-1234-1234-123456789abc',
            nonce: 'n'.repeat(43),
            extensionId: 'acme.example',
            extensionVersion: '1.0.0',
            contributionId: 'extension:acme.example/issues'
          })
        }
      }
      return { ok: true, status: 200, body: '{}' }
    })

    await electronMock.handlers.get('extension:view-session:create')!(state.trustedEvent, {
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/workspace',
      retryHost: true
    })

    expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/acme.example/retry',
      'POST'
    )
    expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/view-sessions',
      'POST',
      JSON.stringify({
        contributionId: 'extension:acme.example/issues',
        workspaceRoot: '/workspace'
      })
    )
    expect(state.runtimeRequest.mock.invocationCallOrder[1]).toBeLessThan(
      state.runtimeRequest.mock.invocationCallOrder[2]!
    )
  })

  it('binds cleanup to a Main window created after IPC registration', () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })

    state.registration.bindMainWindow({
      webContents: state.mainContents
    } as never)
    state.triggerMainDestroyed()

    expect(state.protectedActions.revokeSender).toHaveBeenCalledWith(1)
    expect(state.viewSessions.get(record.sessionId)).toBeUndefined()
    expect(state.viewProtocols.dispose).toHaveBeenCalledWith(record.sessionId)
  })

  it('does not report an explicit Renderer disposal as a lifecycle invalidation', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })

    await electronMock.handlers.get('extension:view-session:dispose')!(state.trustedEvent, {
      sessionId: record.sessionId
    })

    expect(state.mainContents.send).not.toHaveBeenCalledWith(
      'extension:view-session:invalidated',
      expect.anything()
    )
    expect(state.viewSessions.get(record.sessionId)).toBeUndefined()
  })

  it('cancels the event pump and disposes the runtime session when a guest is destroyed', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      runtimeSessionId: 'view_runtime_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    let destroyed: (() => void) | undefined
    const guest = {
      id: 20,
      once: vi.fn((_event: string, listener: () => void) => {
        destroyed = listener
      }),
      send: vi.fn(),
      isDestroyed: () => true,
      close: vi.fn()
    }
    state.viewSessions.bindNextGuest(1, guest as never)

    destroyed?.()
    await vi.waitFor(() => expect(state.runtimeRequest).toHaveBeenCalledWith(
      `/v1/extensions/view-sessions/${record.runtimeSessionId}`,
      'DELETE'
    ))
    expect(state.viewSessions.get(record.sessionId)).toBeUndefined()
  })

})
