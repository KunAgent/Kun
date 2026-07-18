import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_EXTENSION_NOTIFICATION_TTL_MS,
  ExtensionViewSessionError,
  ExtensionViewSessionService,
  type ExtensionViewSessionTarget
} from './extension-view-session-service.js'
import { DEFAULT_EXTENSION_REQUEST_TIMEOUT_MS } from '../extensions/host-protocol.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'

const target: ExtensionViewSessionTarget = {
  extensionId: 'acme.dashboard',
  extensionVersion: '1.2.3',
  contributionId: 'extension:acme.dashboard/panel',
  localContributionId: 'panel',
  entry: 'webview/index.html',
  activationEvent: 'onView:panel',
  workspaceTrusted: true,
  workspaceRoot: '/workspace',
  grantedPermissions: ['ui.views', 'webview', 'agent.run']
}

describe('ExtensionViewSessionService', () => {
  it('binds an opaque nonce to one session without retaining it in projections', () => {
    const service = new ExtensionViewSessionService()
    const created = service.create(target)

    expect(created.nonce).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(service.authenticate(created.sessionId, created.nonce)).not.toHaveProperty('nonce')
    expect(service.principal(created.sessionId)).toMatchObject({
      extensionId: 'acme.dashboard',
      extensionVersion: '1.2.3',
      viewSessionId: created.sessionId,
      viewContributionId: target.contributionId,
      workspaceRoots: ['/workspace']
    })
    expect(() => service.authenticate(created.sessionId, `${created.nonce}x`)).toThrowError(
      expect.objectContaining<Partial<ExtensionViewSessionError>>({ code: 'unauthorized' })
    )
  })

  it('provides cursor replay, reports retention gaps, and isolates extension events', async () => {
    const service = new ExtensionViewSessionService({ maxEvents: 2, maxEventBytes: 64 * 1024 })
    const first = service.create(target)
    const second = service.create({ ...target, extensionId: 'other.dashboard' })
    const listener = vi.fn()
    service.subscribe(first.sessionId, listener)

    await service.onUiRequest({
      principal: service.principal(first.sessionId),
      method: 'ui.postMessage',
      params: { channel: 'one', payload: { value: 1 } }
    })
    await service.onUiRequest({
      principal: service.principal(first.sessionId),
      method: 'ui.postMessage',
      params: { channel: 'two', payload: { value: 2 } }
    })

    const replay = service.replay(first.sessionId, 0, 10)
    expect(replay.cursorExpired).toBe(true)
    expect(replay.events.map((event) => event.type)).toEqual(['message', 'message'])
    expect(listener).toHaveBeenCalledTimes(2)
    expect(service.replay(second.sessionId, 0, 10).events).toHaveLength(1)

    service.setWorkbenchEnvironment(service.workbenchEnvironment())
    const notificationResult = service.onUiRequest({
      principal: service.principal(first.sessionId),
      method: 'ui.showNotification',
      params: {
        id: 'notice',
        title: 'Notice',
        message: 'Safe message',
        severity: 'info',
        actions: [{ id: 'open', title: 'Open' }]
      }
    })
    await vi.waitFor(() => expect(service.listWorkbenchNotifications()).toHaveLength(1))
    const [notification] = service.listWorkbenchNotifications()
    expect(notification).toMatchObject({
      notificationId: expect.stringMatching(/^notification_/),
      extensionId: 'acme.dashboard',
      extensionVersion: '1.2.3',
      sourceId: 'notice',
      title: 'Notice',
      actions: [{ id: 'open', title: 'Open' }]
    })
    expect(service.respondWorkbenchNotification(notification!.notificationId, 'open')).toBe(true)
    await expect(notificationResult).resolves.toEqual({ value: 'open' })
    expect(service.listWorkbenchNotifications()).toHaveLength(0)
  })

  it('delivers Host messages only to sessions in the publishing workspace', async () => {
    const service = new ExtensionViewSessionService()
    const workspaceA = service.create({ ...target, workspaceRoot: '/workspace/a' })
    const workspaceB = service.create({ ...target, workspaceRoot: '/workspace/b' })

    await service.onUiRequest({
      principal: service.principal(workspaceA.sessionId),
      method: 'ui.postMessage',
      params: { channel: 'project.changed', payload: { workspace: 'a' } }
    })

    expect(service.replay(workspaceA.sessionId, 0, 10).events
      .filter((event) => event.type === 'message')
      .map((event) => event.payload)).toEqual([
      { channel: 'project.changed', payload: { workspace: 'a' } }
    ])
    expect(service.replay(workspaceB.sessionId, 0, 10).events
      .filter((event) => event.type === 'message')).toEqual([])

    service.publishMessage(target.extensionId, {
      channel: 'project.changed',
      payload: { workspace: 'b' }
    }, { workspaceRoots: ['/workspace/b'] })

    expect(service.replay(workspaceA.sessionId, 0, 10).events
      .filter((event) => event.type === 'message')).toHaveLength(1)
    expect(service.replay(workspaceB.sessionId, 0, 10).events
      .filter((event) => event.type === 'message')
      .map((event) => event.payload)).toEqual([
      { channel: 'project.changed', payload: { workspace: 'b' } }
    ])
  })

  it('disposes only Views and notifications in the revoked extension workspace', async () => {
    const service = new ExtensionViewSessionService()
    const workspaceA = service.create({ ...target, workspaceRoot: '/workspace/a' })
    const workspaceB = service.create({ ...target, workspaceRoot: '/workspace/b' })
    service.setWorkbenchEnvironment(service.workbenchEnvironment())
    const pendingA = service.publishNotification(service.principal(workspaceA.sessionId), {
      id: 'notice-a',
      title: 'Workspace A',
      message: 'Scoped prompt',
      actions: []
    })
    const pendingB = service.publishNotification(service.principal(workspaceB.sessionId), {
      id: 'notice-b',
      title: 'Workspace B',
      message: 'Peer prompt',
      actions: []
    })

    expect(service.disposeExtensionWorkspace(
      target.extensionId,
      extensionWorkspaceKey('/workspace/a')
    )).toBe(1)

    expect(() => service.principal(workspaceA.sessionId)).toThrowError(
      expect.objectContaining({ code: 'not_found' })
    )
    expect(service.principal(workspaceB.sessionId).workspaceRoots).toEqual(['/workspace/b'])
    await expect(pendingA).resolves.toBeUndefined()
    expect(service.listWorkbenchNotifications()).toEqual([
      expect.objectContaining({ sourceId: 'notice-b' })
    ])
    const remaining = service.listWorkbenchNotifications()[0]!
    service.respondWorkbenchNotification(remaining.notificationId)
    await expect(pendingB).resolves.toBeUndefined()
  })

  it('rejects spoofed notification actions and settles pending prompts during teardown', async () => {
    const service = new ExtensionViewSessionService({
      maxNotifications: 2,
      maxNotificationsPerExtension: 1
    })
    const created = service.create(target)
    const principal = service.principal(created.sessionId)
    service.setWorkbenchEnvironment(service.workbenchEnvironment())
    const pending = service.publishNotification(principal, {
      id: 'notice',
      title: 'Notice',
      message: 'Safe message',
      actions: [{ id: 'retry', title: 'Retry' }]
    })
    const [notification] = service.listWorkbenchNotifications()

    expect(() => service.respondWorkbenchNotification(
      notification!.notificationId,
      'undeclared-action'
    )).toThrowError(expect.objectContaining({ code: 'unauthorized' }))
    expect(() => service.publishNotification(principal, {
      id: 'second',
      title: 'Second',
      message: 'Bounded',
      actions: []
    })).toThrowError(expect.objectContaining({ code: 'rate_limited' }))

    service.disposeExtension(target.extensionId)
    await expect(pending).resolves.toBeUndefined()
    expect(service.listWorkbenchNotifications()).toHaveLength(0)
  })

  it('settles an originating notification request when its broker signal is cancelled', async () => {
    const service = new ExtensionViewSessionService()
    const created = service.create(target)
    service.setWorkbenchEnvironment(service.workbenchEnvironment())
    const controller = new AbortController()
    const pending = service.publishNotification(service.principal(created.sessionId), {
      id: 'notice',
      title: 'Notice',
      message: 'Safe message',
      actions: [{ id: 'open', title: 'Open' }]
    }, controller.signal)
    expect(service.listWorkbenchNotifications()).toHaveLength(1)

    controller.abort()

    await expect(pending).resolves.toBeUndefined()
    expect(service.listWorkbenchNotifications()).toEqual([])
  })

  it('returns a dismissed result immediately when no trusted workbench is connected', async () => {
    const service = new ExtensionViewSessionService()
    await expect(service.publishNotification({
      extensionId: 'acme.dashboard',
      extensionVersion: '1.2.3'
    }, {
      id: 'headless-notice',
      title: 'Notice',
      message: 'No GUI is connected.',
      actions: []
    })).resolves.toBeUndefined()
    expect(service.listWorkbenchNotifications()).toEqual([])
  })

  it('settles the documented notification timeout before the outer Host transport deadline', async () => {
    vi.useFakeTimers()
    try {
      expect(DEFAULT_EXTENSION_NOTIFICATION_TTL_MS).toBeLessThan(
        DEFAULT_EXTENSION_REQUEST_TIMEOUT_MS
      )
      const service = new ExtensionViewSessionService()
      service.setWorkbenchEnvironment(service.workbenchEnvironment())
      const pending = service.publishNotification({
        extensionId: 'acme.dashboard',
        extensionVersion: '1.2.3'
      }, {
        id: 'timeout-notice',
        title: 'Notice',
        message: 'No action was selected.',
        actions: []
      })

      await vi.advanceTimersByTimeAsync(DEFAULT_EXTENSION_NOTIFICATION_TTL_MS)

      await expect(pending).resolves.toBeUndefined()
      expect(service.listWorkbenchNotifications()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('expires the workbench heartbeat lease and dismisses pending notifications', async () => {
    vi.useFakeTimers()
    try {
      const service = new ExtensionViewSessionService({ workbenchLeaseMs: 1_000 })
      service.touchWorkbench()
      const pending = service.publishNotification({
        extensionId: 'acme.dashboard',
        extensionVersion: '1.2.3'
      }, {
        id: 'lease-notice',
        title: 'Notice',
        message: 'The workbench disconnected.',
        actions: []
      })
      expect(service.listWorkbenchNotifications()).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(1_000)

      await expect(pending).resolves.toBeUndefined()
      expect(service.listWorkbenchNotifications()).toEqual([])
      await expect(service.publishNotification({
        extensionId: 'acme.dashboard',
        extensionVersion: '1.2.3'
      }, {
        id: 'headless-after-lease',
        title: 'Notice',
        message: 'No workbench remains.',
        actions: []
      })).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('extends the workbench lease on each heartbeat before disconnecting', async () => {
    vi.useFakeTimers()
    try {
      const service = new ExtensionViewSessionService({ workbenchLeaseMs: 1_000 })
      service.touchWorkbench()
      const pending = service.publishNotification({
        extensionId: 'acme.dashboard',
        extensionVersion: '1.2.3'
      }, {
        id: 'heartbeat-notice',
        title: 'Notice',
        message: 'The workbench is still connected.',
        actions: []
      })
      const settled = vi.fn()
      void pending.then(settled)

      await vi.advanceTimersByTimeAsync(750)
      service.touchWorkbench()
      await vi.advanceTimersByTimeAsync(750)

      expect(settled).not.toHaveBeenCalled()
      expect(service.listWorkbenchNotifications()).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(250)

      await expect(pending).resolves.toBeUndefined()
      expect(service.listWorkbenchNotifications()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds rate and cleans sessions on extension disablement', () => {
    const service = new ExtensionViewSessionService({ maxRequestsPerMinute: 1, maxInFlight: 1 })
    const created = service.create(target)
    const release = service.beginRequest(created.sessionId)
    expect(() => service.beginRequest(created.sessionId)).toThrowError(
      expect.objectContaining<Partial<ExtensionViewSessionError>>({ code: 'rate_limited' })
    )
    release()
    expect(service.disposeExtension(target.extensionId)).toBe(1)
    expect(() => service.principal(created.sessionId)).toThrowError(
      expect.objectContaining<Partial<ExtensionViewSessionError>>({ code: 'not_found' })
    )
  })

  it('tracks cancellable request identities and aborts them during teardown', () => {
    const service = new ExtensionViewSessionService()
    const created = service.create(target)
    const first = service.beginOperation(created.sessionId, 'request-1')
    expect(first.signal.aborted).toBe(false)
    expect(service.cancelOperation(created.sessionId, 'request-1')).toBe(true)
    expect(first.signal.aborted).toBe(true)
    first.finish()
    expect(service.cancelOperation(created.sessionId, 'request-1')).toBe(false)

    const second = service.beginOperation(created.sessionId, 'request-2')
    service.disposeSession(created.sessionId)
    expect(second.signal.aborted).toBe(true)
    second.finish()
  })

  it('binds SDK notifications and cleanup to exactly one authenticated View Session', () => {
    const service = new ExtensionViewSessionService()
    const first = service.create(target)
    const second = service.create({
      ...target,
      contributionId: 'extension:acme.dashboard/other',
      localContributionId: 'other'
    })
    const disposed = vi.fn()
    service.onDidDispose(disposed)

    service.publishBridgeNotification({
      principal: service.principal(first.sessionId),
      method: 'agent.event',
      params: { subscriptionId: 'agentsub-1', event: { sequence: 2 } }
    })

    expect(service.replay(first.sessionId, 1, 10).events).toEqual([
      expect.objectContaining({
        type: 'bridge',
        payload: {
          method: 'agent.event',
          params: { subscriptionId: 'agentsub-1', event: { sequence: 2 } }
        }
      })
    ])
    expect(service.replay(second.sessionId, 1, 10).events).toHaveLength(0)
    expect(() => service.publishBridgeNotification({
      principal: {
        ...service.principal(first.sessionId),
        viewSessionId: second.sessionId
      },
      method: 'agent.event',
      params: null
    })).toThrowError(expect.objectContaining<Partial<ExtensionViewSessionError>>({
      code: 'unauthorized'
    }))

    service.disposeSession(first.sessionId)
    expect(disposed).toHaveBeenCalledWith(first.sessionId)
  })

  it('emits synchronous, balanced lifecycle ownership for concurrent View instances', () => {
    const service = new ExtensionViewSessionService()
    const lifecycle = vi.fn()
    const stop = service.onDidLifecycle(lifecycle)

    const first = service.create(target)
    const second = service.create({
      ...target,
      contributionId: 'extension:acme.dashboard/other',
      localContributionId: 'other'
    })
    expect(lifecycle).toHaveBeenNthCalledWith(1, {
      state: 'created',
      session: expect.objectContaining({
        sessionId: first.sessionId,
        extensionId: target.extensionId
      })
    })
    expect(lifecycle).toHaveBeenNthCalledWith(2, {
      state: 'created',
      session: expect.objectContaining({
        sessionId: second.sessionId,
        extensionId: target.extensionId
      })
    })

    service.disposeSession(first.sessionId)
    service.disposeSession(first.sessionId)
    service.disposeSession(second.sessionId)
    expect(lifecycle.mock.calls.filter(([event]) => event.state === 'disposed')).toHaveLength(2)
    stop()
    service.create(target)
    expect(lifecycle).toHaveBeenCalledTimes(4)
  })

  it('queues a trusted HostMessage for one exact session without a Node Host', () => {
    const service = new ExtensionViewSessionService()
    const first = service.create(target)
    const second = service.create(target)

    service.publishHostMessage(first.sessionId, {
      channel: 'preview.initialize',
      payload: { artifactId: 'artifact-1' }
    })

    expect(service.replay(first.sessionId, 1, 10).events).toEqual([
      expect.objectContaining({
        type: 'message',
        payload: {
          channel: 'preview.initialize',
          payload: { artifactId: 'artifact-1' }
        }
      })
    ])
    expect(service.replay(second.sessionId, 1, 10).events).toHaveLength(0)
  })

  it('serves the latest Main-synchronized workbench environment to broker callers', async () => {
    const service = new ExtensionViewSessionService()
    const created = service.create(target)
    expect(service.setWorkbenchEnvironment({
      theme: {
        kind: 'light',
        tokens: { foreground: '#233659' },
        zoomFactor: 1.25,
        reducedMotion: true
      },
      locale: { language: 'zh', direction: 'ltr', messages: {} }
    })).toEqual({ themeChanged: true, localeChanged: true })
    const principal = service.principal(created.sessionId)

    await expect(service.onUiRequest({ principal, method: 'ui.getTheme', params: null }))
      .resolves.toMatchObject({ kind: 'light', zoomFactor: 1.25, reducedMotion: true })
    await expect(service.onUiRequest({ principal, method: 'ui.getLocale', params: null }))
      .resolves.toEqual({ language: 'zh', direction: 'ltr', messages: {} })
    expect(service.workbenchEnvironment()).toMatchObject({
      theme: { tokens: { foreground: '#233659' } },
      locale: { language: 'zh' }
    })
    expect(service.setWorkbenchEnvironment(service.workbenchEnvironment())).toEqual({
      themeChanged: false,
      localeChanged: false
    })
  })
})
