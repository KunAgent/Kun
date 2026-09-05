import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseExtensionManifest } from '@kun/extension-api'
import {
  ExtensionPaths,
  ExtensionRegistry,
  manifestCompatibilityReport,
  type DevelopmentExtensionRecord
} from '../../src/extensions/index.js'
import { ExtensionViewSessionService } from '../../src/services/extension-view-session-service.js'
import { extensionProviderId } from '../../src/services/extension-provider-account-store.js'
import type { ExtensionAgentEvent } from '../../src/services/extension-agent-service.js'
import type { ServerRuntime } from '../../src/server/routes/server-runtime.js'
import {
  buildExtensionPublicRouter,
  EXTENSION_SESSION_ID_HEADER,
  EXTENSION_SESSION_NONCE_HEADER
} from '../../src/server/routes/extension-public.js'
import {
  WORKSPACE_ROOT,
  createFixture,
  createSession,
  dispatchJson,
  dispatchRaw,
  runtimeHeaders,
  sessionHeaders
} from './extension-public-fixture.js'

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
      { workspaceRoot: WORKSPACE_ROOT }
    )
    expect(fixture.broker.handlePrincipal).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({
        extensionId: 'acme.dashboard',
        extensionVersion: '1.0.0',
        workspaceRoots: [WORKSPACE_ROOT]
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
      workspaceRoot: WORKSPACE_ROOT
    }, runtimeHeaders())
    expect(created.status).toBe(201)
    const expectedActivationOptions = {
      workspaceRoot: WORKSPACE_ROOT,
      workspaceContext: {
        id: fixture.paths.workspaceKey(WORKSPACE_ROOT),
        name: 'workspace',
        root: WORKSPACE_ROOT,
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
    expect(fixture.runtime.extensionPlatform!.packageManager.waitForPendingOperation)
      .toHaveBeenCalledTimes(1)
    expect(fixture.manager.activate).toHaveBeenCalledTimes(1)
    expect(lifecycle).toEqual([
      { state: 'created', sessionId: expect.any(String) },
      { state: 'disposed', sessionId: expect.any(String) }
    ])
    expect(lifecycle[1]!.sessionId).toBe(lifecycle[0]!.sessionId)
    expect(() => fixture.viewSessions.principal(lifecycle[0]!.sessionId)).toThrowError(
      expect.objectContaining({ code: 'not_found' })
    )
  })

  it('rebuilds a View Session once when lifecycle fencing cancels Host activation', async () => {
    const fixture = await createFixture()
    const lifecycle: Array<{ state: string; sessionId: string }> = []
    fixture.viewSessions.onDidLifecycle(({ state, session }) => {
      lifecycle.push({ state, sessionId: session.sessionId })
    })
    fixture.manager.activate.mockRejectedValueOnce(Object.assign(
      new Error('activation was fenced'),
      { code: 'EXTENSION_ACTIVATION_CANCELLED' }
    ))

    const response = await createSession(buildExtensionPublicRouter(fixture.runtime))

    expect(response.status).toBe(201)
    expect(fixture.runtime.extensionPlatform!.packageManager.waitForPendingOperation)
      .toHaveBeenCalledTimes(2)
    expect(fixture.manager.activate).toHaveBeenCalledTimes(2)
    expect(lifecycle.map(({ state }) => state)).toEqual(['created', 'disposed', 'created'])
    expect(lifecycle[0]!.sessionId).not.toBe(lifecycle[2]!.sessionId)
    expect(() => fixture.viewSessions.principal(lifecycle[0]!.sessionId)).toThrowError(
      expect.objectContaining({ code: 'not_found' })
    )
    expect(fixture.viewSessions.principal(lifecycle[2]!.sessionId)).toMatchObject({
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0'
    })
  })

  it('re-resolves workspace grants after a cancelled View activation', async () => {
    const fixture = await createFixture()
    const lifecycle: Array<{ state: string; sessionId: string }> = []
    fixture.viewSessions.onDidLifecycle(({ state, session }) => {
      lifecycle.push({ state, sessionId: session.sessionId })
    })
    fixture.manager.activate.mockRejectedValueOnce(Object.assign(
      new Error('activation was fenced'),
      { code: 'EXTENSION_ACTIVATION_CANCELLED' }
    ))
    const waitForPendingOperation = vi.mocked(
      fixture.runtime.extensionPlatform!.packageManager.waitForPendingOperation
    )
    waitForPendingOperation.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      await fixture.registry.setWorkspacePermissionGrant(
        'acme.dashboard',
        fixture.paths.workspaceKey(WORKSPACE_ROOT),
        undefined,
        '1.0.0'
      )
    })

    const response = await dispatchJson(
      buildExtensionPublicRouter(fixture.runtime),
      'POST',
      '/v1/extensions/view-sessions',
      {
        contributionId: 'extension:acme.dashboard/panel',
        workspaceRoot: WORKSPACE_ROOT
      },
      runtimeHeaders()
    )

    expect(response.status).toBe(404)
    expect(waitForPendingOperation).toHaveBeenCalledWith('acme.dashboard')
    expect(waitForPendingOperation).toHaveBeenCalledTimes(2)
    expect(fixture.manager.activate).toHaveBeenCalledTimes(1)
    expect(lifecycle.map(({ state }) => state)).toEqual(['created', 'disposed'])
  })

  it('recovers when adjacent lifecycle changes cancel View activation twice', async () => {
    const fixture = await createFixture()
    const lifecycle: Array<{ state: string; sessionId: string }> = []
    fixture.viewSessions.onDidLifecycle(({ state, session }) => {
      lifecycle.push({ state, sessionId: session.sessionId })
    })
    const cancelled = () => Object.assign(
      new Error('activation was fenced'),
      { code: 'EXTENSION_ACTIVATION_CANCELLED' }
    )
    fixture.manager.activate
      .mockRejectedValueOnce(cancelled())
      .mockRejectedValueOnce(cancelled())

    const response = await createSession(buildExtensionPublicRouter(fixture.runtime))

    expect(response.status).toBe(201)
    expect(fixture.manager.activate).toHaveBeenCalledTimes(3)
    expect(fixture.runtime.extensionPlatform!.packageManager.waitForPendingOperation)
      .toHaveBeenCalledTimes(3)
    expect(lifecycle.map(({ state }) => state)).toEqual([
      'created',
      'disposed',
      'created',
      'disposed',
      'created'
    ])
  })

  it('bounds repeated cancelled View activation recovery to three retries', async () => {
    const fixture = await createFixture()
    const lifecycle: Array<{ state: string; sessionId: string }> = []
    fixture.viewSessions.onDidLifecycle(({ state, session }) => {
      lifecycle.push({ state, sessionId: session.sessionId })
    })
    fixture.manager.activate.mockRejectedValue(Object.assign(
      new Error('activation was repeatedly fenced'),
      { code: 'EXTENSION_ACTIVATION_CANCELLED' }
    ))

    const response = await createSession(buildExtensionPublicRouter(fixture.runtime))

    expect(response).toMatchObject({
      status: 500,
      body: { code: 'extension_operation_failed' }
    })
    expect(fixture.manager.activate).toHaveBeenCalledTimes(4)
    expect(fixture.runtime.extensionPlatform!.packageManager.waitForPendingOperation)
      .toHaveBeenCalledTimes(4)
    expect(lifecycle.map(({ state }) => state)).toEqual([
      'created',
      'disposed',
      'created',
      'disposed',
      'created',
      'disposed',
      'created',
      'disposed'
    ])
    for (const { sessionId } of lifecycle) {
      expect(() => fixture.viewSessions.principal(sessionId)).toThrowError(
        expect.objectContaining({ code: 'not_found' })
      )
    }
  })
})
