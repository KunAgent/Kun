import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseExtensionManifest } from '@kun/extension-api'
import {
  ExtensionPaths,
  ExtensionRegistry,
  manifestCompatibilityReport,
  type DevelopmentExtensionRecord
} from '../../extensions/index.js'
import { ExtensionViewSessionService } from '../../services/extension-view-session-service.js'
import { extensionProviderId } from '../../services/extension-provider-account-store.js'
import type { ServerRuntime } from './server-runtime.js'
import {
  buildExtensionPublicRouter,
  EXTENSION_SESSION_ID_HEADER,
  EXTENSION_SESSION_NONCE_HEADER
} from './extension-public.js'

const cleanupRoots: string[] = []

afterEach(async () => {
  for (const root of cleanupRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('extension public routes', () => {
  it('authenticates workbench discovery and returns only sanitized enabled contributions', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)

    const unauthorized = await dispatchJson(router, 'GET', '/v1/extensions/workbench')
    expect(unauthorized.status).toBe(401)

    ;(fixture.runtime as { insecure: boolean }).insecure = true
    const insecureStillProtected = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/accounts?extension_id=acme.dashboard'
    )
    expect(insecureStillProtected.status).toBe(401)
    ;(fixture.runtime as { insecure: boolean }).insecure = false

    const response = await dispatchJson(router, 'GET', '/v1/extensions/workbench', undefined, runtimeHeaders())
    expect(response.status).toBe(200)
    expect(response.body.extensions).toHaveLength(1)
    expect(response.body.extensions[0]).toMatchObject({
      id: 'acme.dashboard',
      version: '1.0.0',
      enabled: true,
      source: { type: 'development', mutable: true }
    })
    expect(response.body.extensions[0].source).not.toHaveProperty('locator')
    expect(response.body.extensions[0].contributes['views.rightSidebar']).toHaveLength(1)
    // Backend declarations are intentionally omitted from renderer discovery.
    expect(response.body.extensions[0].contributes.tools).toEqual([])
    expect(response.body.extensions[0].contributes.modelProviders).toEqual([])

    const untrusted = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/workbench?workspace_root=%2Funtrusted&locale=zh-CN',
      undefined,
      runtimeHeaders()
    )
    expect(untrusted.status).toBe(200)
    expect(untrusted.body.extensions).toHaveLength(1)
    expect(untrusted.body.extensions[0]).toMatchObject({
      id: 'acme.dashboard',
      workspaceTrusted: false,
      grantedPermissions: [],
      rightRailDiscovery: {
        views: [{ id: 'panel', title: '仪表盘' }],
        containers: []
      }
    })
    expect(untrusted.body.extensions[0].rightRailDiscovery.views[0]).not.toHaveProperty('entry')
    expect(untrusted.body.extensions[0].contributes.commands).toEqual([])
    expect(untrusted.body.extensions[0].contributes['views.rightSidebar']).toEqual([])
  })

  it('localizes bounded workbench display fields with base-manifest fallback', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const localized = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/workbench?locale=zh-CN',
      undefined,
      runtimeHeaders()
    )
    expect(localized.status).toBe(200)
    expect(localized.body.extensions[0].contributes.commands[0]).toMatchObject({
      id: 'refresh',
      title: '刷新面板'
    })
    expect(localized.body.extensions[0].contributes['views.rightSidebar'][0]).toMatchObject({
      id: 'panel',
      title: '仪表盘'
    })
    expect(localized.body.extensions[0].contributes.settings[0]).toMatchObject({
      id: 'general',
      title: '通用',
      properties: {
        mode: { title: '模式', description: '选择处理模式。' }
      }
    })

    const unsupported = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/workbench?locale=fr-FR',
      undefined,
      runtimeHeaders()
    )
    expect(unsupported.body.extensions[0].contributes['views.rightSidebar'][0].title).toBe('Dashboard')
    expect((await dispatchJson(
      router,
      'GET',
      '/v1/extensions/workbench?locale=not_a_locale',
      undefined,
      runtimeHeaders()
    )).status).toBe(400)
  })

  it('keeps right-rail-hidden Views out of untrusted launcher discovery', async () => {
    const fixture = await createFixture({ showInRightRail: false })
    const response = await dispatchJson(
      buildExtensionPublicRouter(fixture.runtime),
      'GET',
      '/v1/extensions/workbench?workspace_root=%2Funtrusted',
      undefined,
      runtimeHeaders()
    )

    expect(response.status).toBe(200)
    expect(response.body.extensions[0].rightRailDiscovery.views).toEqual([{
      id: 'panel',
      title: 'Dashboard',
      showInRightRail: false,
      order: 0
    }])
  })

  it('projects real compatibility reports instead of admitting future API minors to workbench', async () => {
    const fixture = await createFixture({ apiVersion: '1.1.0' })
    const response = await dispatchJson(
      buildExtensionPublicRouter(fixture.runtime),
      'GET',
      '/v1/extensions/workbench',
      undefined,
      runtimeHeaders()
    )
    expect(response.status).toBe(200)
    expect(response.body.extensions[0]).toMatchObject({
      id: 'acme.dashboard',
      compatible: false,
      compatibility: {
        api: {
          compatible: false,
          declaredApiVersion: '1.1.0',
          code: 'API_MINOR_UNSUPPORTED'
        }
      },
      diagnostics: [{ code: 'API_MINOR_UNSUPPORTED' }]
    })
    const session = await dispatchJson(
      buildExtensionPublicRouter(fixture.runtime),
      'POST',
      '/v1/extensions/view-sessions',
      { contributionId: 'extension:acme.dashboard/panel' },
      runtimeHeaders()
    )
    expect(session.status).toBe(404)
    expect(fixture.manager.activate).not.toHaveBeenCalled()
  })

  it('invokes a declared command with a core-derived extension principal', async () => {
    const fixture = await createFixture()
    fixture.broker.handlePrincipal.mockResolvedValue({ refreshed: true })
    const router = buildExtensionPublicRouter(fixture.runtime)

    const response = await dispatchJson(router, 'POST', '/v1/extensions/commands/invoke', {
      commandId: 'extension:acme.dashboard/refresh',
      context: { source: 'topbar' },
      workspaceRoot: '/workspace'
    }, runtimeHeaders())
    expect(response).toMatchObject({
      status: 200,
      body: { result: { refreshed: true } }
    })
    expect(fixture.manager.activate).toHaveBeenCalledWith(
      'acme.dashboard',
      'onCommand:refresh',
      { workspaceRoot: '/workspace' }
    )
    expect(fixture.broker.handlePrincipal).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        workspaceRoots: ['/workspace']
      }),
      method: 'commands.execute',
      params: { id: 'refresh', args: { source: 'topbar' } }
    }))

    const forged = await dispatchJson(router, 'POST', '/v1/extensions/commands/invoke', {
      commandId: 'extension:other.extension/refresh',
      context: null
    }, runtimeHeaders())
    expect(forged.status).toBe(404)
  })

  it('does not treat an arbitrary workspace path as trusted before protected grant review', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const command = await dispatchJson(router, 'POST', '/v1/extensions/commands/invoke', {
      commandId: 'extension:acme.dashboard/refresh',
      context: { source: 'topbar' },
      workspaceRoot: '/untrusted-workspace'
    }, runtimeHeaders())
    expect(command.status).toBe(404)
    const view = await dispatchJson(router, 'POST', '/v1/extensions/view-sessions', {
      contributionId: 'extension:acme.dashboard/panel',
      workspaceRoot: '/untrusted-workspace'
    }, runtimeHeaders())
    expect(view.status).toBe(404)
    expect(fixture.manager.activate).not.toHaveBeenCalled()
  })

  it('loads and updates only declared settings in an explicitly trusted workspace', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const snapshot = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/configuration/snapshot',
      {
        contributionIds: ['extension:acme.dashboard/general'],
        workspaceRoot: '/workspace'
      },
      runtimeHeaders()
    )
    expect(snapshot).toMatchObject({
      status: 200,
      body: {
        revisions: { 'acme.dashboard': 0 },
        values: { 'extension:acme.dashboard/general': { mode: 'safe' } }
      }
    })
    const updated = await dispatchJson(
      router,
      'PUT',
      '/v1/extensions/configuration',
      {
        contributionId: 'extension:acme.dashboard/general',
        key: 'mode',
        value: 'fast',
        expectedRevision: 0,
        workspaceRoot: '/workspace'
      },
      runtimeHeaders()
    )
    expect(updated).toMatchObject({ status: 200, body: { revision: 1 } })
    expect(fixture.configuration.update).toHaveBeenCalledWith(expect.objectContaining({
      sectionId: 'general',
      key: 'mode',
      value: 'fast',
      principal: expect.objectContaining({ workspaceTrusted: true })
    }))

    const untrusted = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/configuration/snapshot',
      {
        contributionIds: ['extension:acme.dashboard/general'],
        workspaceRoot: '/untrusted-workspace'
      },
      runtimeHeaders()
    )
    expect(untrusted.status).toBe(403)
  })

  it('derives a core-bound view identity and never accepts a forged or runtime guest credential', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)

    const strict = await dispatchJson(router, 'POST', '/v1/extensions/view-sessions', {
      contributionId: 'extension:acme.dashboard/panel',
      unexpected: true
    }, runtimeHeaders())
    expect(strict.status).toBe(400)

    const created = await createSession(router)
    expect(created.body).toMatchObject({
      contributionId: 'extension:acme.dashboard/panel',
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0'
    })
    expect(created.body.nonce).not.toBe('route-runtime-token')
    expect(created.body.src).toBe('kun-extension://acme.dashboard/webview/index.html')
    expect(created.body.partition).not.toContain('persist:')

    const runtimeTokenAsGuest = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/messages`,
      { channel: 'ping', payload: null },
      runtimeHeaders()
    )
    expect(runtimeTokenAsGuest.status).toBe(401)

    const wrongNonce = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/messages`,
      { channel: 'ping', payload: null },
      sessionHeaders(created.body.sessionId, 'wrong')
    )
    expect(wrongNonce.status).toBe(401)

    const accepted = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/messages`,
      { channel: 'ping', payload: { ok: true } },
      sessionHeaders(created.body.sessionId, created.body.nonce)
    )
    expect(accepted).toMatchObject({ status: 202, body: { accepted: true } })
    expect(fixture.manager.activate).toHaveBeenCalledWith(
      'acme.dashboard',
      'onView:panel',
      expect.any(Object)
    )

    const hostMessage = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/host-messages`,
      { channel: 'preview.initialize', payload: { artifactId: 'artifact-1' } },
      runtimeHeaders()
    )
    expect(hostMessage).toMatchObject({ status: 202, body: { accepted: true } })
    const guestCannotSpoofHost = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/host-messages`,
      { channel: 'preview.initialize', payload: null },
      sessionHeaders(created.body.sessionId, created.body.nonce)
    )
    expect(guestCannotSpoofHost.status).toBe(401)
    expect(fixture.viewSessions.replay(created.body.sessionId, 1, 10).events).toEqual([
      expect.objectContaining({
        type: 'message',
        payload: { channel: 'preview.initialize', payload: { artifactId: 'artifact-1' } }
      })
    ])
  })

  it('keeps the trusted active workspace context across View Host activation and messages', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    fixture.broker.handlePrincipal.mockImplementation(async (input: { method: string }) => {
      if (input.method !== 'commands.execute') return null
      const workspaceContext = fixture.manager.activate.mock.calls.at(-1)?.[2]?.workspaceContext
      if (!workspaceContext?.active || !workspaceContext.trusted) {
        throw new Error('Project commands require an active trusted workspace')
      }
      return { projects: [] }
    })

    const created = await dispatchJson(router, 'POST', '/v1/extensions/view-sessions', {
      contributionId: 'extension:acme.dashboard/panel',
      workspaceRoot: '/workspace'
    }, runtimeHeaders())
    expect(created.status).toBe(201)
    const expectedActivationOptions = {
      workspaceRoot: '/workspace',
      workspaceContext: {
        id: fixture.paths.workspaceKey('/workspace'),
        name: 'workspace',
        root: '/workspace',
        trusted: true,
        active: true
      }
    }
    expect(fixture.manager.activate).toHaveBeenLastCalledWith(
      'acme.dashboard',
      'onView:panel',
      expectedActivationOptions
    )

    const headers = sessionHeaders(created.body.sessionId, created.body.nonce)
    const projectList = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/requests`,
      {
        requestId: 'request-project-list-1',
        method: 'commands.execute',
        params: { id: 'editor-request', args: { action: 'project.list' } }
      },
      headers
    )
    expect(projectList).toMatchObject({
      status: 200,
      body: { result: { projects: [] } }
    })

    const viewMessage = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/messages`,
      { channel: 'project.refresh', payload: null },
      headers
    )
    expect(viewMessage.status).toBe(202)
    expect(fixture.manager.activate).toHaveBeenLastCalledWith(
      'acme.dashboard',
      'onView:panel',
      expectedActivationOptions
    )

    const hostMessage = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/requests`,
      {
        requestId: 'request-host-message-1',
        method: 'ui.postMessage',
        params: { channel: 'project.refresh', payload: null }
      },
      headers
    )
    expect(hostMessage).toMatchObject({ status: 200, body: { result: null } })
    expect(fixture.manager.activate).toHaveBeenLastCalledWith(
      'acme.dashboard',
      'onView:panel',
      expectedActivationOptions
    )
  })

  it('rolls back the pre-retained View Session when Node Host activation fails', async () => {
    const fixture = await createFixture()
    const lifecycle: Array<{ state: string; sessionId: string }> = []
    fixture.viewSessions.onDidLifecycle(({ state, session }) => {
      lifecycle.push({ state, sessionId: session.sessionId })
    })
    fixture.manager.activate.mockRejectedValueOnce(new Error('activation failed'))

    const response = await createSession(buildExtensionPublicRouter(fixture.runtime))
    expect(response).toMatchObject({
      status: 500,
      body: { code: 'extension_operation_failed' }
    })
    expect(lifecycle).toEqual([
      { state: 'created', sessionId: expect.any(String) },
      { state: 'disposed', sessionId: expect.any(String) }
    ])
    expect(lifecycle[1]!.sessionId).toBe(lifecycle[0]!.sessionId)
    expect(() => fixture.viewSessions.principal(lifecycle[0]!.sessionId)).toThrowError(
      expect.objectContaining({ code: 'not_found' })
    )
  })

  it('polls and streams cursor events with bounded replay and no secret projection', async () => {
    const fixture = await createFixture({ maxEvents: 3 })
    const router = buildExtensionPublicRouter(fixture.runtime)
    const created = await createSession(router)
    const headers = sessionHeaders(created.body.sessionId, created.body.nonce)

    await fixture.viewSessions.onUiRequest({
      principal: fixture.viewSessions.principal(created.body.sessionId),
      method: 'ui.postMessage',
      params: { channel: 'result', payload: { value: 1 } }
    })
    const poll = await dispatchJson(
      router,
      'GET',
      `/v1/extensions/view-sessions/${created.body.sessionId}/events?cursor=0&limit=2`,
      undefined,
      headers
    )
    expect(poll.status).toBe(200)
    expect(poll.body.events.map((event: { type: string }) => event.type)).toEqual(['session', 'message'])
    expect(JSON.stringify(poll.body)).not.toContain('route-runtime-token')
    expect(poll.body.nextCursor).toBe(2)

    const sse = await dispatchRaw(
      router,
      'GET',
      `/v1/extensions/view-sessions/${created.body.sessionId}/events?cursor=1&limit=2`,
      undefined,
      { ...headers, accept: 'text/event-stream' }
    )
    expect(sse).toBeInstanceOf(Response)
    expect((sse as Response).headers.get('content-type')).toContain('text/event-stream')
    const reader = (sse as Response).body!.getReader()
    const chunk = await reader.read()
    expect(new TextDecoder().decode(chunk.value)).toContain('event: message')
    await reader.cancel()

    await fixture.viewSessions.onUiRequest({
      principal: fixture.viewSessions.principal(created.body.sessionId),
      method: 'ui.postMessage',
      params: { channel: 'result', payload: { value: 2 } }
    })
    await fixture.viewSessions.onUiRequest({
      principal: fixture.viewSessions.principal(created.body.sessionId),
      method: 'ui.postMessage',
      params: { channel: 'result', payload: { value: 3 } }
    })
    const expired = await dispatchJson(
      router,
      'GET',
      `/v1/extensions/view-sessions/${created.body.sessionId}/events?cursor=0&limit=3`,
      undefined,
      headers
    )
    expect(expired).toMatchObject({ status: 409, body: { code: 'cursor_expired' } })
  })

  it('dispatches allowlisted Webview SDK requests through the session-bound broker', async () => {
    const fixture = await createFixture()
    fixture.broker.handlePrincipal.mockResolvedValue({
      kind: 'dark', tokens: {}, zoomFactor: 1, reducedMotion: false
    })
    const router = buildExtensionPublicRouter(fixture.runtime)
    const created = await createSession(router)
    const headers = sessionHeaders(created.body.sessionId, created.body.nonce)

    const response = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/requests`,
      { requestId: 'request-theme-1', method: 'ui.getTheme', params: {} },
      headers
    )
    expect(response).toMatchObject({
      status: 200,
      body: { result: { kind: 'dark', reducedMotion: false } }
    })
    expect(fixture.broker.handlePrincipal).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({
        extensionId: 'acme.dashboard',
        viewSessionId: created.body.sessionId,
        viewContributionId: 'extension:acme.dashboard/panel'
      }),
      method: 'ui.getTheme',
      requestId: 'request-theme-1'
    }))

    const protectedOperation = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/requests`,
      {
        requestId: 'request-delete-1',
        method: 'authentication.deleteAccount',
        params: { accountId: 'account-1' }
      },
      headers
    )
    expect(protectedOperation.status).toBe(403)
    expect(fixture.broker.handlePrincipal).toHaveBeenCalledTimes(1)
  })

  it('forwards guest-safe jobs and media methods without exposing credentials or registration', async () => {
    const fixture = await createFixture()
    fixture.broker.handlePrincipal
      .mockResolvedValueOnce({ items: [], page: { hasMore: false } })
      .mockResolvedValueOnce({ handleId: 'media_123456789012', streams: [] })
    const router = buildExtensionPublicRouter(fixture.runtime)
    const created = await dispatchJson(router, 'POST', '/v1/extensions/view-sessions', {
      contributionId: 'extension:acme.dashboard/panel',
      workspaceRoot: '/workspace'
    }, runtimeHeaders())
    const headers = sessionHeaders(created.body.sessionId, created.body.nonce)
    const requestPath = `/v1/extensions/view-sessions/${created.body.sessionId}/requests`

    const jobs = await dispatchJson(router, 'POST', requestPath, {
      requestId: 'request-jobs-list-1',
      method: 'jobs.list',
      params: {}
    }, headers)
    expect(jobs).toMatchObject({
      status: 200,
      body: { result: { items: [], page: { hasMore: false } } }
    })

    const media = await dispatchJson(router, 'POST', requestPath, {
      requestId: 'request-media-probe-1',
      method: 'media.probe',
      params: { handleId: 'media_123456789012' }
    }, headers)
    expect(media).toMatchObject({
      status: 200,
      body: { result: { handleId: 'media_123456789012' } }
    })

    for (const request of [
      {
        requestId: 'request-secret-reveal-1',
        method: 'authentication.revealSecret',
        params: { accountId: 'account-1', operation: 'sign request' }
      },
      {
        requestId: 'request-tool-register-1',
        method: 'tools.register',
        params: { id: 'unsafe-registration' }
      }
    ]) {
      const denied = await dispatchJson(router, 'POST', requestPath, request, headers)
      expect(denied.status).toBe(403)
    }
    expect(fixture.broker.handlePrincipal).toHaveBeenCalledTimes(2)
    expect(fixture.broker.handlePrincipal).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ method: 'jobs.list' })
    )
    expect(fixture.broker.handlePrincipal).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ method: 'media.probe' })
    )
  })

  it('accepts the real workbench environment only from trusted Main', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const environment = {
      theme: {
        kind: 'light',
        tokens: { foreground: '#233659' },
        zoomFactor: 1.25,
        reducedMotion: true
      },
      locale: { language: 'zh', direction: 'ltr', messages: {} }
    }
    const accepted = await dispatchJson(
      router,
      'PUT',
      '/v1/extensions/workbench/environment',
      environment,
      runtimeHeaders()
    )
    expect(accepted).toMatchObject({ status: 200, body: { accepted: true } })
    expect(fixture.viewSessions.workbenchEnvironment()).toEqual(environment)
    expect(fixture.manager.notify).toHaveBeenCalledWith(
      'acme.dashboard',
      'ui.themeChanged',
      environment.theme
    )
    expect(fixture.manager.notify).toHaveBeenCalledWith(
      'acme.dashboard',
      'ui.localeChanged',
      environment.locale
    )

    const created = await createSession(router)
    const rejected = await dispatchJson(
      router,
      'PUT',
      '/v1/extensions/workbench/environment',
      environment,
      sessionHeaders(created.body.sessionId, created.body.nonce)
    )
    expect(rejected.status).toBe(401)
  })

  it('registers Main-confirmed media selections once and returns only opaque metadata', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const created = await dispatchJson(router, 'POST', '/v1/extensions/view-sessions', {
      contributionId: 'extension:acme.dashboard/panel',
      workspaceRoot: '/workspace'
    }, runtimeHeaders())
    const body = {
      operationToken: 't'.repeat(43),
      binding: {
        sessionId: created.body.sessionId,
        runtimeSessionId: created.body.sessionId,
        sessionNonce: created.body.nonce,
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        contributionId: 'extension:acme.dashboard/panel',
        workspaceRoot: '/workspace',
        senderWebContentsId: 42,
        senderMainFrameProcessId: 7,
        senderMainFrameRoutingId: 11
      },
      mode: 'read',
      selections: [{
        absolutePath: '/private/media/interview.mp4',
        displayName: 'interview.mp4'
      }]
    }

    const unauthorized = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/media/selections',
      body
    )
    expect(unauthorized.status).toBe(401)
    expect(fixture.mediaHandles.register).not.toHaveBeenCalled()

    const registered = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/media/selections',
      body,
      runtimeHeaders()
    )
    expect(registered).toMatchObject({
      status: 201,
      body: {
        selections: [{
          handleId: 'media_handle_0000000001',
          mode: 'read',
          kind: 'video',
          displayName: 'interview.mp4',
          mimeType: 'video/mp4',
          revoked: false
        }]
      }
    })
    expect(JSON.stringify(registered.body)).not.toContain('/private/media')
    expect(JSON.stringify(registered.body)).not.toContain('operationToken')
    expect(JSON.stringify(registered.body)).not.toContain(created.body.nonce)
    expect(fixture.mediaHandles.register).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        viewSessionId: created.body.sessionId,
        viewContributionId: 'extension:acme.dashboard/panel',
        workspaceRoots: ['/workspace']
      }),
      {
        workspaceRoot: '/workspace',
        path: '/private/media/interview.mp4',
        mode: 'read',
        source: 'picker',
        displayName: 'interview.mp4'
      }
    )

    const replayed = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/media/selections',
      body,
      runtimeHeaders()
    )
    expect(replayed).toMatchObject({
      status: 409,
      body: { code: 'conflict' }
    })
    expect(fixture.mediaHandles.register).toHaveBeenCalledTimes(1)
  })

  it('burns a protected media token when its View binding is forged', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const created = await dispatchJson(router, 'POST', '/v1/extensions/view-sessions', {
      contributionId: 'extension:acme.dashboard/panel',
      workspaceRoot: '/workspace'
    }, runtimeHeaders())
    const binding = {
      sessionId: created.body.sessionId,
      runtimeSessionId: created.body.sessionId,
      sessionNonce: created.body.nonce,
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.dashboard/panel',
      workspaceRoot: '/workspace',
      senderWebContentsId: 42,
      senderMainFrameProcessId: 7,
      senderMainFrameRoutingId: 11
    }
    const selection = {
      operationToken: 'f'.repeat(43),
      binding: { ...binding, extensionId: 'other.extension' },
      mode: 'export',
      selections: [{ absolutePath: '/private/exports/final.mp4', displayName: 'final.mp4' }]
    }
    const forged = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/media/selections',
      selection,
      runtimeHeaders()
    )
    expect(forged.status).toBe(401)
    expect(fixture.mediaHandles.register).not.toHaveBeenCalled()

    const retried = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/media/selections',
      { ...selection, binding },
      runtimeHeaders()
    )
    expect(retried).toMatchObject({ status: 409, body: { code: 'conflict' } })
    expect(fixture.mediaHandles.register).not.toHaveBeenCalled()
  })

  it('resolves a readable handle for Main lease creation without exposing it to a View route', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const created = await dispatchJson(router, 'POST', '/v1/extensions/view-sessions', {
      contributionId: 'extension:acme.dashboard/panel',
      workspaceRoot: '/workspace'
    }, runtimeHeaders())
    const binding = {
      sessionId: created.body.sessionId,
      runtimeSessionId: created.body.sessionId,
      sessionNonce: created.body.nonce,
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.dashboard/panel',
      workspaceRoot: '/workspace',
      senderWebContentsId: 42,
      senderMainFrameProcessId: 7,
      senderMainFrameRoutingId: 11
    }
    const unauthorized = await dispatchJson(router, 'POST', '/v1/extensions/media/leases/resolve', {
      binding,
      handleId: 'media_handle_0000000001'
    })
    expect(unauthorized.status).toBe(401)
    const resolved = await dispatchJson(router, 'POST', '/v1/extensions/media/leases/resolve', {
      binding,
      handleId: 'media_handle_0000000001',
      requestedTtlMs: 60_000
    }, runtimeHeaders())
    expect(resolved).toMatchObject({
      status: 200,
      body: {
        handleId: 'media_handle_0000000001',
        absolutePath: '/private/media/interview.mp4',
        mimeType: 'video/mp4',
        fileIdentity: { byteSize: 1234, modifiedAtMs: 1000, device: 2, inode: 3 }
      }
    })
    expect(fixture.mediaHandles.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.dashboard',
        viewSessionId: created.body.sessionId,
        workspaceRoots: ['/workspace']
      }),
      'media_handle_0000000001',
      'read'
    )

    const artifact = await dispatchJson(router, 'POST', '/v1/extensions/media/artifacts/resolve', {
      artifactId: 'artifact_1234567890',
      ownerExtensionId: 'acme.dashboard',
      ownerExtensionVersion: '1.0.0',
      workspaceId: fixture.paths.workspaceKey('/workspace'),
      workspaceRoot: '/workspace'
    }, runtimeHeaders())
    expect(artifact).toMatchObject({
      status: 200,
      body: {
        artifactId: 'artifact_1234567890',
        absolutePath: '/private/media/interview.mp4',
        displayName: 'interview.mp4',
        mimeType: 'video/mp4'
      }
    })
    const forgedWorkspace = await dispatchJson(router, 'POST', '/v1/extensions/media/artifacts/resolve', {
      artifactId: 'artifact_1234567890',
      ownerExtensionId: 'acme.dashboard',
      ownerExtensionVersion: '1.0.0',
      workspaceId: fixture.paths.workspaceKey('/workspace'),
      workspaceRoot: '/other-workspace'
    }, runtimeHeaders())
    expect(forgedWorkspace.status).toBe(404)
  })

  it('delivers host-owned notifications without a View Session and resolves declared actions', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)

    const unauthorized = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/workbench/notifications'
    )
    expect(unauthorized.status).toBe(401)

    await expect(fixture.viewSessions.publishNotification({
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0'
    }, {
      id: 'headless-notice',
      title: 'No workbench',
      message: 'An unauthorized poll must not establish workbench presence.',
      actions: []
    })).resolves.toBeUndefined()

    const connected = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/workbench/notifications',
      undefined,
      runtimeHeaders()
    )
    expect(connected).toMatchObject({
      status: 200,
      body: { schemaVersion: 1, notifications: [] }
    })

    const selection = fixture.viewSessions.publishNotification({
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0'
    }, {
      id: 'retry-notice',
      title: 'Provider unavailable',
      message: 'Reconnect the account and retry.',
      severity: 'warning',
      actions: [{ id: 'retry', title: 'Retry' }]
    })
    const listed = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/workbench/notifications',
      undefined,
      runtimeHeaders()
    )
    expect(listed).toMatchObject({
      status: 200,
      body: {
        schemaVersion: 1,
        notifications: [{
          extensionId: 'acme.dashboard',
          sourceId: 'retry-notice',
          actions: [{ id: 'retry', title: 'Retry' }]
        }]
      }
    })
    const notificationId = listed.body.notifications[0].notificationId as string
    const spoofed = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/workbench/notifications/${notificationId}/respond`,
      { actionId: 'undeclared' },
      runtimeHeaders()
    )
    expect(spoofed.status).toBe(401)

    const responded = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/workbench/notifications/${notificationId}/respond`,
      { actionId: 'retry' },
      runtimeHeaders()
    )
    expect(responded).toMatchObject({ status: 200, body: { responded: true } })
    await expect(selection).resolves.toBe('retry')
    expect(fixture.viewSessions.listWorkbenchNotifications()).toEqual([])

    const disconnectedSelection = fixture.viewSessions.publishNotification({
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0'
    }, {
      id: 'disconnect-notice',
      title: 'Disconnecting',
      message: 'The workbench is closing.',
      actions: []
    })
    const disconnected = await dispatchJson(
      router,
      'DELETE',
      '/v1/extensions/workbench/presence',
      undefined,
      runtimeHeaders()
    )
    expect(disconnected).toMatchObject({ status: 200, body: { disconnected: true } })
    await expect(disconnectedSelection).resolves.toBeUndefined()
  })

  it('cancels a pending Webview SDK request by session and request identity', async () => {
    const fixture = await createFixture()
    fixture.broker.handlePrincipal.mockImplementation(({ signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })
    )
    const router = buildExtensionPublicRouter(fixture.runtime)
    const created = await createSession(router)
    const headers = sessionHeaders(created.body.sessionId, created.body.nonce)
    const pending = dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/requests`,
      { requestId: 'request-cancel-1', method: 'ui.getTheme', params: {}, timeoutMs: 10_000 },
      headers
    )
    await vi.waitFor(() => expect(fixture.broker.handlePrincipal).toHaveBeenCalled())

    const cancelled = await dispatchJson(
      router,
      'POST',
      `/v1/extensions/view-sessions/${created.body.sessionId}/requests/request-cancel-1/cancel`,
      undefined,
      headers
    )
    expect(cancelled).toMatchObject({ status: 200, body: { cancelled: true } })
    await expect(pending).resolves.toMatchObject({
      status: 408,
      body: { code: 'request_cancelled' }
    })
  })

  it('exposes headless tool/provider/account projections while keeping direct tools behind ToolHost', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const created = await createSession(router)
    const headers = sessionHeaders(created.body.sessionId, created.body.nonce)

    const tools = await dispatchJson(router, 'GET', '/v1/extensions/tools', undefined, headers)
    expect(tools).toMatchObject({
      status: 200,
      body: { tools: [{ localId: 'echo', sideEffect: 'none' }] }
    })
    const directInvoke = router.match('POST', '/v1/extensions/tools/tool-id/invoke')
    expect(directInvoke).toBeUndefined()

    const providers = await dispatchJson(router, 'GET', '/v1/extensions/providers', undefined, headers)
    expect(providers.status).toBe(200)
    expect(providers.body.providers[0]).toMatchObject({
      id: 'ext-provider',
      ownerExtensionId: 'acme.dashboard'
    })
    expect(providers.body.providers[0]).not.toHaveProperty('apiKey')

    const accounts = await dispatchJson(router, 'GET', '/v1/extensions/accounts', undefined, headers)
    expect(accounts.status).toBe(200)
    expect(accounts.body.accounts[0]).toMatchObject({
      id: 'account-1',
      providerId: 'ext-provider',
      authenticationType: 'api-key'
    })
    expect(JSON.stringify(accounts.body)).not.toContain('credentialRef')
    expect(JSON.stringify(accounts.body)).not.toContain('super-secret')
  })

  it('keeps trusted account management extension-owned and secret-redacted', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)

    const listed = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/accounts?extension_id=acme.dashboard&provider_id=provider&include_unavailable=false',
      undefined,
      runtimeHeaders()
    )
    expect(listed).toMatchObject({ status: 200, body: { accounts: [{ id: 'account-1' }] } })

    fixture.broker.handleTrustedManagement.mockResolvedValue({
      id: 'account-session-created',
      status: 'pending',
      verificationUrl: 'https://auth.example/authorize'
    })
    const accountSession = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/accounts/sessions',
      {
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        providerId: 'provider',
        authenticationProviderId: 'key-auth',
        workspaceRoot: '/workspace'
      },
      runtimeHeaders()
    )
    expect(accountSession).toMatchObject({
      status: 201,
      body: { session: { id: 'account-session-created', status: 'pending' } }
    })
    expect(fixture.manager.activate).toHaveBeenCalledWith(
      'acme.dashboard',
      'onAuthentication:key-auth',
      { workspaceRoot: '/workspace' }
    )
    expect(fixture.broker.handleTrustedManagement).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        workspaceRoots: ['/workspace']
      }),
      method: 'authentication.createSession'
    }))

    const created = await dispatchJson(router, 'POST', '/v1/extensions/accounts/api-key', {
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0',
      providerId: 'provider',
      authenticationProviderId: 'key-auth',
      label: 'Protected account',
      secret: 'sk-never-project-this'
    }, runtimeHeaders())
    expect(created.status).toBe(201)
    expect(JSON.stringify(created.body)).not.toContain('sk-never-project-this')
    expect(fixture.accounts.createApiKeyAccount).toHaveBeenCalledWith(expect.objectContaining({
      providerId: fixture.canonicalProviderId,
      apiKey: 'sk-never-project-this',
      protectedInput: true,
      principal: expect.objectContaining({ extensionId: 'acme.dashboard' })
    }))

    fixture.broker.completePkceAccountSession.mockResolvedValue({
      id: 'account-session-123456',
      status: 'completed',
      account: created.body.account
    })
    const completed = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/accounts/sessions/account-session-123456/complete',
      {
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        callbackUrl: 'https://callback.example/?code=protected-code&state=protected-state'
      },
      runtimeHeaders()
    )
    expect(completed).toMatchObject({ status: 200, body: { session: { status: 'completed' } } })
    expect(fixture.broker.completePkceAccountSession).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({ extensionId: 'acme.dashboard' }),
      sessionId: 'account-session-123456',
      callbackUrl: 'https://callback.example/?code=protected-code&state=protected-state'
    }))

    const renamed = await dispatchJson(
      router,
      'PATCH',
      '/v1/extensions/accounts/account-1/label',
      {
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        providerId: 'provider',
        label: 'Renamed account'
      },
      runtimeHeaders()
    )
    expect(renamed).toMatchObject({
      status: 200,
      body: { account: { id: 'account-1', label: 'Renamed account' } }
    })
    expect(fixture.accounts.renameAccount).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      label: 'Renamed account',
      principal: expect.objectContaining({ extensionId: 'acme.dashboard' })
    }))

    const replaced = await dispatchJson(
      router,
      'PUT',
      '/v1/extensions/accounts/account-1/api-key',
      {
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        providerId: 'provider',
        secret: 'replacement-never-project-this'
      },
      runtimeHeaders()
    )
    expect(replaced.status).toBe(200)
    expect(JSON.stringify(replaced.body)).not.toContain('replacement-never-project-this')
    expect(fixture.accounts.replaceApiKeyAccount).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      apiKey: 'replacement-never-project-this',
      protectedInput: true,
      principal: expect.objectContaining({ extensionId: 'acme.dashboard' })
    }))

    const deleted = await dispatchJson(
      router,
      'DELETE',
      '/v1/extensions/accounts/account-1',
      {
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        providerId: 'provider'
      },
      runtimeHeaders()
    )
    expect(deleted).toMatchObject({ status: 200, body: { deleted: true } })

    const wrongOwner = await dispatchJson(
      router,
      'DELETE',
      '/v1/extensions/accounts/account-1',
      {
        extensionId: 'other.extension',
        extensionVersion: '1.0.0',
        providerId: 'provider'
      },
      runtimeHeaders()
    )
    expect(wrongOwner.status).toBe(404)
  })

  it('discovers and persists an exact acknowledged extension provider binding', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)

    const unauthorized = await dispatchJson(router, 'GET', '/v1/extensions/model-providers')
    expect(unauthorized.status).toBe(401)

    const catalog = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/model-providers?workspace_root=%2Fworkspace',
      undefined,
      runtimeHeaders()
    )
    expect(catalog).toMatchObject({
      status: 200,
      body: {
        providers: [{
          extensionId: 'acme.dashboard',
          extensionVersion: '1.0.0',
          localProviderId: 'provider',
          providerId: fixture.canonicalProviderId,
          selectable: true,
          accounts: [{ id: 'account-1' }],
          binding: null,
          dataAccess: {
            categories: [
              'conversation-history',
              'system-and-mode-instructions',
              'attachments',
              'tool-schemas'
            ],
            requiresAcknowledgement: true
          }
        }]
      }
    })
    expect(JSON.stringify(catalog.body)).not.toContain('credentialRef')

    const missingAcknowledgement = await dispatchJson(
      router,
      'PUT',
      '/v1/extensions/model-providers/binding',
      {
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        providerId: 'provider',
        accountId: 'account-1',
        modelId: 'custom-model',
        workspaceRoot: '/workspace',
        acknowledgedDataAccess: false
      },
      runtimeHeaders()
    )
    expect(missingAcknowledgement.status).toBe(400)

    const staleVersion = await dispatchJson(
      router,
      'PUT',
      '/v1/extensions/model-providers/binding',
      {
        extensionId: 'acme.dashboard',
        extensionVersion: '0.9.0',
        providerId: 'provider',
        accountId: 'account-1',
        modelId: 'custom-model',
        workspaceRoot: '/workspace',
        acknowledgedDataAccess: true
      },
      runtimeHeaders()
    )
    expect(staleVersion.status).toBe(409)

    const saved = await dispatchJson(
      router,
      'PUT',
      '/v1/extensions/model-providers/binding',
      {
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        providerId: 'provider',
        accountId: 'account-1',
        modelId: 'custom-model',
        workspaceRoot: '/workspace',
        acknowledgedDataAccess: true
      },
      runtimeHeaders()
    )
    expect(saved).toMatchObject({
      status: 200,
      body: { binding: {
        providerId: fixture.canonicalProviderId,
        accountId: 'account-1',
        modelId: 'custom-model',
        ownerExtensionVersion: '1.0.0'
      } }
    })
    expect(fixture.providerAccounts.setBinding).toHaveBeenCalledWith(expect.objectContaining({
      ownerExtensionId: 'acme.dashboard',
      ownerExtensionVersion: '1.0.0',
      binding: {
        providerId: fixture.canonicalProviderId,
        accountId: 'account-1',
        modelId: 'custom-model'
      }
    }))
  })

  it('rejects guest identity fields and Agent calls without a bound session', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const unauthenticated = await dispatchJson(router, 'POST', '/v1/extensions/agent/runs', { input: 'hello' })
    expect(unauthenticated.status).toBe(401)

    const created = await createSession(router)
    const forged = await dispatchJson(router, 'POST', '/v1/extensions/agent/runs', {
      input: 'hello',
      ownerExtensionId: 'other.extension'
    }, sessionHeaders(created.body.sessionId, created.body.nonce))
    expect(forged.status).toBe(400)
    expect(fixture.agent.createRun).not.toHaveBeenCalled()
  })

  it('keeps raw-secret reveal decisions on the trusted runtime-token control plane', async () => {
    const fixture = await createFixture()
    fixture.secretReveals.list.mockReturnValue([{
      id: 'secret_reveal_12345678-1234-1234-1234-123456789abc',
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0',
      accountId: 'account-1',
      operation: 'sign request',
      createdAt: '2026-07-11T00:00:00.000Z',
      expiresAt: '2026-07-11T00:01:00.000Z'
    }])
    fixture.secretReveals.decide.mockReturnValue(true)
    const router = buildExtensionPublicRouter(fixture.runtime)

    const unauthorized = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/secret-reveal-requests'
    )
    expect(unauthorized.status).toBe(401)
    const listed = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/secret-reveal-requests',
      undefined,
      runtimeHeaders()
    )
    expect(listed.body.requests).toHaveLength(1)
    expect(listed.body.requests[0]).not.toHaveProperty('secret')
    const decided = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/secret-reveal-requests/secret_reveal_12345678-1234-1234-1234-123456789abc/decision',
      { decision: 'allow' },
      runtimeHeaders()
    )
    expect(decided).toMatchObject({ status: 200, body: { decided: true } })
    expect(fixture.secretReveals.decide).toHaveBeenCalledWith(
      'secret_reveal_12345678-1234-1234-1234-123456789abc',
      'allow'
    )
  })
})

async function createFixture(options: {
  maxEvents?: number
  apiVersion?: string
  showInRightRail?: boolean
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kun-extension-public-routes-'))
  cleanupRoots.push(root)
  const paths = new ExtensionPaths({
    packageRoot: join(root, 'packages'),
    dataRoot: join(root, 'data')
  })
  const registry = new ExtensionRegistry(paths)
  const permissions = [
    'commands.register',
    'ui.views',
    'webview',
    'agent.run',
    'agent.threads.readOwn',
    'tools.register',
    'providers.register',
    'ui.actions',
    'accounts.read',
    'accounts.use:provider',
    'accounts.manage:provider',
    'accounts.use:ext-provider',
    'accounts.manage:ext-provider',
    'media.read',
    'media.process',
    'media.export',
    'jobs.manage',
    'workspace.read',
    'workspace.write'
  ]
  const manifest = parseExtensionManifest({
    publisher: 'acme',
    name: 'dashboard',
    displayName: 'Dashboard',
    localizations: {
      'zh-CN': {
        displayName: '仪表盘',
        contributes: {
          commands: { refresh: { title: '刷新面板' } },
          'views.rightSidebar': { panel: { title: '仪表盘' } },
          settings: {
            general: {
              title: '通用',
              properties: {
                mode: { title: '模式', description: '选择处理模式。' }
              }
            }
          }
        }
      }
    },
    version: '1.0.0',
    manifestVersion: 1,
    apiVersion: options.apiVersion ?? '1.0.0',
    engines: { kun: '*' },
    main: 'dist/main.mjs',
    browser: 'webview/index.html',
    activationEvents: [
      'onView:panel',
      'onCommand:refresh',
      'onTool:echo',
      'onAuthentication:key-auth',
      'onProvider:provider'
    ],
    contributes: {
      commands: [{ id: 'refresh', title: 'Refresh dashboard' }],
      'views.rightSidebar': [{
        id: 'panel',
        title: 'Dashboard',
        entry: 'webview/index.html',
        ...(options.showInRightRail === undefined ? {} : { showInRightRail: options.showInRightRail })
      }],
      tools: [{
        id: 'echo',
        description: 'Echo input',
        inputSchema: { type: 'object' }
      }],
      modelProviders: [{
        id: 'provider',
        displayName: 'Provider',
        authenticationProviderId: 'key-auth',
        models: [{
          id: 'custom-model',
          displayName: 'Custom model',
          capabilities: {
            input: ['text'],
            output: ['text'],
            tools: true,
            reasoning: false,
            parallelTools: false,
            streaming: true
          }
        }]
      }],
      authentication: [{
        id: 'key-auth',
        displayName: 'API key',
        type: 'api-key',
        apiKey: { header: 'Authorization', prefix: 'Bearer ' }
      }],
      settings: [{
        id: 'general',
        title: 'General',
        scope: 'workspace',
        properties: { mode: { type: 'string', enum: ['safe', 'fast'], default: 'safe' } }
      }]
    },
    permissions,
    stateSchemaVersion: 0
  })
  const now = new Date().toISOString()
  const canonicalProviderId = extensionProviderId('acme.dashboard', 'provider')
  const development: DevelopmentExtensionRecord = {
    path: join(root, 'development'),
    source: { type: 'development', locator: join(root, 'development') },
    digest: 'a'.repeat(64),
    manifest,
    requestedPermissions: [...permissions],
    grantedPermissions: [...permissions],
    registeredAt: now,
    reloadedAt: now,
    generation: 1,
    mutable: true
  }
  await registry.registerDevelopment('acme.dashboard', development)
  await registry.setWorkspacePermissionGrant(
    'acme.dashboard',
    paths.workspaceKey('/workspace'),
    permissions,
    development.manifest.version
  )

  const viewSessions = new ExtensionViewSessionService({
    ...(options.maxEvents ? { maxEvents: options.maxEvents } : {})
  })
  const manager = {
    activate: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(undefined)
  }
  const agent = {
    createRun: vi.fn(),
    getRun: vi.fn(),
    steer: vi.fn(),
    cancel: vi.fn(),
    subscribe: vi.fn(),
    listOwnThreads: vi.fn(),
    getOwnThread: vi.fn()
  }
  const broker = {
    handlePrincipal: vi.fn(),
    handleTrustedManagement: vi.fn(),
    completePkceAccountSession: vi.fn()
  }
  const provider = {
    id: 'ext-provider',
    ownerExtensionId: 'acme.dashboard',
    ownerExtensionVersion: '1.0.0',
    displayName: 'Provider',
    authTypes: ['api-key'],
    apiKey: { headerName: 'Authorization', prefix: 'Bearer ' },
    capabilities: {
      streaming: true,
      toolCalls: true,
      reasoning: false,
      images: false,
      documents: false,
      tokenCounting: false
    },
    createdAt: now,
    updatedAt: now
  }
  const accounts = {
    listAccounts: vi.fn().mockResolvedValue([{
      id: 'account-1',
      providerId: 'ext-provider',
      ownerExtensionId: 'acme.dashboard',
      label: 'Personal',
      authType: 'api-key',
      status: 'connected',
      metadata: {},
      createdAt: now,
      updatedAt: now
    }]),
    createApiKeyAccount: vi.fn().mockResolvedValue({
      id: 'account-created',
      providerId: 'ext-provider',
      ownerExtensionId: 'acme.dashboard',
      label: 'Protected account',
      authType: 'api-key',
      status: 'connected',
      metadata: {},
      createdAt: now,
      updatedAt: now
    }),
    renameAccount: vi.fn().mockImplementation(async ({ accountId, label }: {
      accountId: string
      label: string
    }) => ({
      id: accountId,
      providerId: 'ext-provider',
      ownerExtensionId: 'acme.dashboard',
      label,
      authType: 'api-key',
      status: 'connected',
      metadata: {},
      createdAt: now,
      updatedAt: now
    })),
    replaceApiKeyAccount: vi.fn().mockImplementation(async ({ accountId }: {
      accountId: string
    }) => ({
      id: accountId,
      providerId: 'ext-provider',
      ownerExtensionId: 'acme.dashboard',
      label: 'Renamed account',
      authType: 'api-key',
      status: 'connected',
      metadata: {},
      createdAt: now,
      updatedAt: now
    })),
    deleteAccount: vi.fn().mockResolvedValue(true)
  }
  const secretReveals = {
    list: vi.fn((): Array<Record<string, string>> => []),
    decide: vi.fn(() => false)
  }
  const configuration = {
    snapshot: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      revision: 0,
      values: { 'extension:acme.dashboard/general': { mode: 'safe' } }
    }),
    update: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      revision: 1,
      values: { 'extension:acme.dashboard/general': { mode: 'fast' } }
    })
  }
  const mediaHandles = {
    register: vi.fn(async (_principal, input: { mode: 'read' | 'write'; displayName: string }) => ({
      id: input.mode === 'write' ? 'media_export_000000001' : 'media_handle_0000000001',
      displayName: input.displayName,
      mode: input.mode,
      source: 'picker',
      mimeType: 'video/mp4',
      ...(input.mode === 'read' ? {
        byteSize: 1234,
        modifiedAt: '2026-07-13T00:00:00.000Z',
        completionIdentity: 'identity_0000000001'
      } : {}),
      available: true,
      createdAt: '2026-07-13T00:00:00.000Z'
    })),
    release: vi.fn(async () => true),
    resolve: vi.fn(async () => ({
      id: 'media_handle_0000000001',
      displayName: 'interview.mp4',
      mode: 'read',
      source: 'picker',
      mimeType: 'video/mp4',
      byteSize: 1234,
      modifiedAt: '2026-07-13T00:00:00.000Z',
      completionIdentity: 'identity_0000000001',
      available: true,
      createdAt: '2026-07-13T00:00:00.000Z',
      absolutePath: '/private/media/interview.mp4',
      workspaceRoot: '/workspace',
      ownerExtensionId: 'acme.dashboard',
      ownerExtensionVersion: '1.0.0',
      identity: { size: 1234, mtimeMs: 1000, device: 2, inode: 3 }
    }))
  }
  const artifacts = {
    getOwned: vi.fn(async (_principal, artifactId: string) => ({
      schemaVersion: 1,
      artifactId,
      ownerExtensionId: 'acme.dashboard',
      ownerExtensionVersion: '1.0.0',
      workspaceId: paths.workspaceKey('/workspace'),
      mediaHandleId: 'media_handle_0000000001',
      displayName: 'interview.mp4',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      byteSize: 1234,
      completionIdentity: 'identity_0000000001',
      availability: 'available',
      provenance: { invocationId: 'invocation_1', operation: 'video-render' }
    }))
  }
  const platform = {
    paths,
    registry,
    packageManager: {
      compatibilityReport: (input: typeof manifest) => manifestCompatibilityReport(input, {
        kunVersion: '0.1.0',
        supportedManifestVersions: [1],
        supportedApiVersions: ['1.0.0']
      }),
      admitManifest: (input: typeof manifest) => {
        const report = manifestCompatibilityReport(input, {
          kunVersion: '0.1.0',
          supportedManifestVersions: [1],
          supportedApiVersions: ['1.0.0']
        })
        if (!report.api.compatible) throw new Error(report.api.message)
        return report
      }
    },
    manager,
    broker,
    viewSessions,
    agent,
    tools: {
      list: vi.fn(() => [{
        canonicalToolId: 'extension:acme.dashboard/echo',
        modelAlias: 'ext_echo',
        extensionId: 'acme.dashboard',
        declaration: {
          name: 'echo',
          description: 'Echo input',
          inputSchema: { type: 'object' },
          sideEffect: 'none',
          idempotent: true
        }
      }])
    },
    providerAccounts: {
      listProviders: vi.fn().mockResolvedValue([provider]),
      getProvider: vi.fn(async (id: string) => {
        if (id === canonicalProviderId) return { ...provider, id: canonicalProviderId }
        return id === 'ext-provider' ? provider : null
      }),
      getAccount: vi.fn(async (id: string) => id === 'account-1' ? {
        id: 'account-1',
        providerId: canonicalProviderId,
        ownerExtensionId: 'acme.dashboard',
        label: 'Personal',
        authType: 'api-key',
        status: 'connected',
        credentialRef: 'cred-secret',
        metadata: {},
        createdAt: now,
        updatedAt: now
      } : null),
      validateBinding: vi.fn(),
      getBinding: vi.fn().mockResolvedValue(null),
      setBinding: vi.fn().mockImplementation(async (input) => ({
        scopeKey: input.scopeKey,
        ownerExtensionId: input.ownerExtensionId,
        ownerExtensionVersion: input.ownerExtensionVersion,
        binding: input.binding,
        dataAccessDigest: input.dataAccessDigest,
        dataCategories: input.dataCategories,
        acknowledgedAt: now,
        updatedAt: now
      }))
    },
    accounts,
    credentials: {
      protection: vi.fn().mockResolvedValue({
        mode: 'encrypted-fallback',
        degraded: true,
        available: true
      })
    },
    secretReveals,
    configuration,
    mediaHandles,
    artifacts,
    modelProviders: {
      probe: vi.fn(),
      listModels: vi.fn().mockResolvedValue(manifest.contributes.modelProviders[0]!.models),
      isAvailable: vi.fn(() => true)
    }
  }
  const runtime = {
    extensionPlatform: platform,
    runtimeToken: 'route-runtime-token',
    insecure: false
  } as unknown as ServerRuntime
  return {
    runtime,
    paths,
    manager,
    agent,
    broker,
    accounts,
    providerAccounts: platform.providerAccounts,
    canonicalProviderId,
    secretReveals,
    configuration,
    mediaHandles,
    viewSessions
  }
}

async function createSession(router: ReturnType<typeof buildExtensionPublicRouter>) {
  return dispatchJson(router, 'POST', '/v1/extensions/view-sessions', {
    contributionId: 'extension:acme.dashboard/panel'
  }, runtimeHeaders())
}

function runtimeHeaders(): Record<string, string> {
  return { authorization: 'Bearer route-runtime-token' }
}

function sessionHeaders(sessionId: string, nonce: string): Record<string, string> {
  return {
    [EXTENSION_SESSION_ID_HEADER]: sessionId,
    [EXTENSION_SESSION_NONCE_HEADER]: nonce
  }
}

async function dispatchJson(
  router: ReturnType<typeof buildExtensionPublicRouter>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const response = await dispatchRaw(router, method, path, body, headers)
  if (!(response instanceof Response)) {
    return { status: response.status, body: JSON.parse(response.body) }
  }
  return { status: response.status, body: await response.json() }
}

async function dispatchRaw(
  router: ReturnType<typeof buildExtensionPublicRouter>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  const request = new Request(`http://127.0.0.1${path}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const match = router.match(method, new URL(request.url).pathname)
  if (!match) throw new Error(`route did not match: ${method} ${path}`)
  return match.handler(request, { params: match.params })
}
