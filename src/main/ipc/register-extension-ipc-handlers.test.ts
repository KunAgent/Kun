import { ExtensionManifestSchema } from '@kun/extension-api'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionViewSessionRegistry } from '../extensions/extension-view-sessions'
import {
  registerExtensionIpcHandlers,
  startExtensionNotificationPump,
  startExtensionSecretRevealConsentPump,
  type ExtensionWorkbenchEnvironment
} from './register-extension-ipc-handlers'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, payload?: unknown) => void>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  fromId: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electronMock.showOpenDialog,
    showSaveDialog: electronMock.showSaveDialog,
    showMessageBox: electronMock.showMessageBox
  },
  shell: {
    openPath: electronMock.openPath,
    showItemInFolder: electronMock.showItemInFolder
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      electronMock.handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, listener: (event: unknown, payload?: unknown) => void) => {
      electronMock.listeners.set(channel, listener)
    })
  },
  webContents: {
    fromId: electronMock.fromId
  }
}))

function fixture() {
  const mainFrame = { processId: 100, routingId: 200 }
  let mainDestroyedListener: (() => void) | undefined
  const mainContents = {
    id: 1,
    mainFrame,
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') mainDestroyedListener = listener
    }),
    send: vi.fn(),
    isDestroyed: () => false
  }
  const mainWindow = { isDestroyed: () => false, webContents: mainContents }
  const runtimeRequest = vi.fn(async (
    _path: string,
    _method?: string,
    _body?: string,
    _headers?: Record<string, string>
  ) => ({
    ok: true,
    status: 200,
    body: JSON.stringify({ result: { ok: true } })
  }))
  const viewSessions = new ExtensionViewSessionRegistry(() => 1_000)
  const viewProtocols = {
    prepare: vi.fn(),
    assertPrepared: vi.fn(),
    isPreparedInitialNavigation: vi.fn(() => false),
    dispose: vi.fn(() => true),
    disposeAll: vi.fn()
  }
  const mediaProtocols = {
    createLease: vi.fn(async (input: { handleId: string; mimeType?: string }) => ({
      leaseId: 'lease_123456789012',
      handleId: input.handleId,
      url: 'kun-media://lease/opaque-lease-token',
      mimeType: input.mimeType ?? 'application/octet-stream',
      expiresAt: '2026-07-13T00:05:00.000Z'
    })),
    revokeLease: vi.fn(() => true)
  }
  const externalBrowserState = {
    sessionId: 'view_123456789012',
    siteId: 'bilibili',
    presentation: 'mobile' as const,
    url: 'https://www.bilibili.com/',
    title: 'Bilibili',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    zoomFactor: 1
  }
  const externalBrowsers = {
    mount: vi.fn(() => externalBrowserState),
    activate: vi.fn(() => externalBrowserState),
    updateBounds: vi.fn(() => externalBrowserState),
    navigate: vi.fn(() => externalBrowserState),
    command: vi.fn(() => externalBrowserState),
    state: vi.fn(() => externalBrowserState),
    disposeAll: vi.fn()
  }
  const contentScripts = {
    sync: vi.fn(async (_sender: unknown, request: { protectedSurface?: string }) =>
      request.protectedSurface
        ? {
            ok: false as const,
            code: 'EXTENSION_PROTECTED_SURFACE_DENIED',
            message: 'Host content scripts cannot run in a protected surface.',
            reloadScheduled: false
          }
        : { ok: true as const, active: [] }),
    bootstrap: vi.fn(() => ({ version: 1, generation: 'test', bindings: [] })),
    handleBridgeRequest: vi.fn(),
    clearFrame: vi.fn(async () => undefined),
    disposeFrame: vi.fn(async () => undefined),
    revokeExtension: vi.fn(async () => true),
    recentDiagnostics: vi.fn(() => [{
      code: 'HOST_DOM_EXTENSION_DIAGNOSTIC',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'dom',
      workspaceScope: 'global',
      message: 'Selector missing.',
      at: '2026-07-11T00:00:00.000Z'
    }])
  }
  const descriptors = {
    resolvePackage: vi.fn(),
    resolveView: vi.fn(),
    resolveHostContentScript: vi.fn()
  }
  const protectedActions = {
    revokeSender: vi.fn(),
    authorize: vi.fn(),
    consume: vi.fn(),
    authorizeAndPerform: vi.fn(async (
      _binding: unknown,
      _copy: unknown,
      perform: () => Promise<unknown>
    ) => perform()),
    performAfterProtectedDecision: vi.fn(async (
      _binding: unknown,
      _protectedWindowSessionId: string,
      perform: () => Promise<unknown>
    ) => perform())
  }
  const credentialSurface = { prompt: vi.fn(), presentAuthorization: vi.fn() }
  let workbenchEnvironment: ExtensionWorkbenchEnvironment = {
    theme: {
      kind: 'light' as const,
      tokens: { foreground: '#233659' },
      zoomFactor: 1,
      reducedMotion: false
    },
    locale: { language: 'en', direction: 'ltr' as const, messages: {} }
  }
  const options = {
    getMainWindow: () => mainWindow as never,
    runtimeRequest,
    descriptors: descriptors as never,
    viewSessions,
    viewProtocols: viewProtocols as never,
    externalBrowsers: externalBrowsers as never,
    mediaProtocols: mediaProtocols as never,
    protectedActions: protectedActions as never,
    credentialSurface: credentialSurface as never,
    contentScripts: contentScripts as never,
    getWorkbenchEnvironment: async () => workbenchEnvironment
  }
  const registration = registerExtensionIpcHandlers(options)
  return {
    runtimeRequest,
    mainContents,
    viewSessions,
    viewProtocols,
    mediaProtocols,
    externalBrowsers,
    contentScripts,
    descriptors,
    protectedActions,
    credentialSurface,
    registration,
    options,
    setWorkbenchEnvironment(environment: typeof workbenchEnvironment) {
      workbenchEnvironment = environment
    },
    triggerMainDestroyed() {
      mainDestroyedListener?.()
    },
    trustedEvent: { sender: mainContents, senderFrame: mainFrame },
    untrustedEvent: { sender: { id: 99 }, senderFrame: { processId: 999, routingId: 999 } }
  }
}

beforeEach(() => {
  electronMock.handlers.clear()
  electronMock.listeners.clear()
  electronMock.showOpenDialog.mockReset()
  electronMock.showSaveDialog.mockReset()
  electronMock.showMessageBox.mockReset()
  electronMock.openPath.mockReset()
  electronMock.openPath.mockResolvedValue('')
  electronMock.showItemInFolder.mockReset()
  electronMock.showMessageBox.mockResolvedValue({ response: 0 })
  electronMock.fromId.mockReset()
})

describe('extension IPC security bridge', () => {
  it('presents source, digest, signature, and high-risk contributions before installation', async () => {
    const state = fixture()
    const manifest = ExtensionManifestSchema.parse({
      manifestVersion: 1,
      apiVersion: '1.0.0',
      publisher: 'acme',
      name: 'example',
      version: '1.2.3',
      engines: { kun: '*' },
      main: 'dist/main.mjs',
      activationEvents: ['onStartup'],
      contributes: {
        hostContentScripts: [{
          id: 'direct-dom',
          matches: ['workbench:code'],
          scripts: ['dist/content.js']
        }]
      },
      permissions: ['hostDom'],
      stateSchemaVersion: 0
    })
    state.runtimeRequest.mockImplementation(async (path: string) => path === '/v1/extensions/inspect'
      ? {
          ok: true,
          status: 200,
          body: JSON.stringify({
            inspection: {
              id: 'acme.example',
              version: '1.2.3',
              archiveSha256: 'a'.repeat(64),
              signatureStatus: 'present-unverified',
              manifest
            }
          })
        }
      : { ok: true, status: 201, body: JSON.stringify({ extension: { id: 'acme.example' } }) })

    await electronMock.handlers.get('extension:install')!(state.trustedEvent, {
      source: 'archive',
      path: '/tmp/example.kunx'
    })

    expect(state.protectedActions.authorizeAndPerform).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        operationKind: 'extension.install'
      }),
      expect.objectContaining({
        detail: expect.stringMatching(/Local \.kunx archive[\s\S]*a{64}[\s\S]*not verified[\s\S]*Direct DOM/i)
      }),
      expect.any(Function)
    )
  })

  it('rejects extension management calls from a non-workbench sender', async () => {
    const state = fixture()
    await expect(
      electronMock.handlers.get('extension:list')!(state.untrustedEvent, undefined)
    ).rejects.toThrow(/trusted workbench frame/)
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('binds permission consent to the expected version and discloses the actual workspace delta', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      grantedPermissions: ['media.read'],
      workspaceTrusted: true
    })

    await electronMock.handlers.get('extension:set-permissions')!(state.trustedEvent, {
      extensionId: 'acme.example',
      expectedVersion: '1.2.3',
      permissions: ['workspace.write'],
      workspaceRoot: '/workspace'
    })

    expect(state.protectedActions.authorizeAndPerform).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        operationKind: 'extension.permissions',
        parameters: expect.objectContaining({ expectedVersion: '1.2.3' })
      }),
      expect.objectContaining({
        detail: expect.stringMatching(
          /Added broker permissions:[\s\S]*workspace\.write[\s\S]*Removed broker permissions:[\s\S]*media\.read[\s\S]*Workspace write permission/
        )
      }),
      expect.any(Function)
    )
    expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/acme.example/permissions',
      'PUT',
      JSON.stringify({
        workspaceRoot: '/workspace',
        permissions: ['workspace.write'],
        expectedVersion: '1.2.3'
      })
    )
  })

  it.each([
    ['global', '{}'],
    ['workspace', JSON.stringify({ workspaceRoot: '/workspace' })]
  ] as const)('applies reviewed permissions and enables the %s scope in one protected decision', async (
    enableAfterApply,
    expectedEnableBody
  ) => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      grantedPermissions: [],
      workspaceTrusted: false
    })

    await electronMock.handlers.get('extension:set-permissions')!(state.trustedEvent, {
      extensionId: 'acme.example',
      expectedVersion: '1.2.3',
      permissions: ['ui.views', 'webview'],
      workspaceRoot: '/workspace',
      enableAfterApply
    })

    expect(state.protectedActions.authorizeAndPerform).toHaveBeenCalledWith(
      expect.objectContaining({
        operationKind: 'extension.permissions',
        parameters: {
          extensionId: 'acme.example',
          expectedVersion: '1.2.3',
          permissions: ['ui.views', 'webview'],
          workspaceRoot: '/workspace',
          enableAfterApply
        }
      }),
      expect.objectContaining({
        title: 'Review permissions and enable extension',
        detail: expect.stringMatching(/apply these permissions[\s\S]*Resulting broker permissions/i)
      }),
      expect.any(Function)
    )
    expect(state.runtimeRequest).toHaveBeenNthCalledWith(
      1,
      '/v1/extensions/acme.example/permissions',
      'PUT',
      JSON.stringify({
        workspaceRoot: '/workspace',
        permissions: ['ui.views', 'webview'],
        expectedVersion: '1.2.3'
      })
    )
    expect(state.runtimeRequest).toHaveBeenNthCalledWith(
      2,
      '/v1/extensions/acme.example/enable',
      'POST',
      expectedEnableBody
    )
  })

  it('does not change permissions or enable when the combined review is cancelled', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      grantedPermissions: [],
      workspaceTrusted: false
    })
    state.protectedActions.authorizeAndPerform.mockResolvedValueOnce(undefined)

    const result = await electronMock.handlers.get('extension:set-permissions')!(state.trustedEvent, {
      extensionId: 'acme.example',
      expectedVersion: '1.2.3',
      permissions: ['ui.views'],
      workspaceRoot: '/workspace',
      enableAfterApply: 'global'
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('does not enable when the reviewed permission update fails', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      grantedPermissions: [],
      workspaceTrusted: false
    })
    state.runtimeRequest.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: JSON.stringify({ code: 'EXTENSION_VERSION_CONFLICT' })
    })

    const result = await electronMock.handlers.get('extension:set-permissions')!(state.trustedEvent, {
      extensionId: 'acme.example',
      expectedVersion: '1.2.3',
      permissions: ['ui.views'],
      workspaceRoot: '/workspace',
      enableAfterApply: 'workspace'
    })

    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(state.runtimeRequest).toHaveBeenCalledTimes(1)
    expect(state.runtimeRequest).not.toHaveBeenCalledWith(
      '/v1/extensions/acme.example/enable',
      expect.anything(),
      expect.anything()
    )
  })

  it('omits an absent workspace from the protected enable binding', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      grantedPermissions: [],
      workspaceTrusted: true
    })

    await electronMock.handlers.get('extension:enable')!(state.trustedEvent, {
      extensionId: 'acme.example'
    })

    expect(state.protectedActions.authorizeAndPerform).toHaveBeenCalledWith(
      expect.objectContaining({
        operationKind: 'extension.enable',
        parameters: { extensionId: 'acme.example' }
      }),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('rejects a stale permission review before presenting native consent', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '2.0.0',
      grantedPermissions: [],
      workspaceTrusted: false
    })

    await expect(electronMock.handlers.get('extension:set-permissions')!(state.trustedEvent, {
      extensionId: 'acme.example',
      expectedVersion: '1.0.0',
      permissions: ['ui.views'],
      workspaceRoot: '/workspace'
    })).rejects.toThrow(/version changed/i)

    expect(state.protectedActions.authorizeAndPerform).not.toHaveBeenCalled()
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('treats an identical persisted workspace grant as an idempotent no-op', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      grantedPermissions: ['webview', 'ui.views'],
      workspaceTrusted: true
    })
    const view = state.viewSessions.create({
      sessionId: 'permission-noop-view',
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      contributionId: 'issues',
      workspaceRoot: '/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })

    const result = await electronMock.handlers.get('extension:set-permissions')!(state.trustedEvent, {
      extensionId: 'acme.example',
      expectedVersion: '1.2.3',
      permissions: ['ui.views', 'webview'],
      workspaceRoot: '/workspace'
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: JSON.stringify({ unchanged: true })
    })
    expect(state.protectedActions.authorizeAndPerform).not.toHaveBeenCalled()
    expect(state.runtimeRequest).not.toHaveBeenCalled()
    expect(state.viewSessions.get(view.sessionId)).toMatchObject({ workspaceRoot: '/workspace' })
    expect(state.contentScripts.revokeExtension).not.toHaveBeenCalled()
  })

  it('binds guest requests to the Main-owned session and forwards nonce headers', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      runtimeSessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const guest = { id: 20, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)

    const response = await electronMock.handlers.get('extension:view:request')!(
      { sender: guest },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-123',
        method: 'ui.getViewState',
        params: {}
      }
    )

    expect(response).toEqual({ ok: true })
    expect(state.runtimeRequest).toHaveBeenCalledWith(
      `/v1/extensions/view-sessions/${record.runtimeSessionId}/requests`,
      'POST',
      expect.stringContaining('ui.getViewState'),
      {
        'x-kun-extension-session-id': record.runtimeSessionId,
        'x-kun-extension-session-nonce': record.nonce
      }
    )
  })

  it('attaches bounded View context through the owning workbench with Host provenance', async () => {
    const state = fixture()
    const workspaceRoot = '/tmp/workspace'
    const canonicalWorkspaceRoot = resolve(workspaceRoot)
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      runtimeSessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot,
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    state.descriptors.resolveView.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      grantedPermissions: ['webview', 'ui.views', 'ui.actions'],
      enabled: true,
      workspaceTrusted: true
    })

    const response = await electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-attach-context',
        method: 'ui.attachComposerContext',
        params: {
          schemaVersion: 1,
          id: 'video-selection',
          title: 'Interview selection',
          summary: 'Revision 4, two preview sources',
          reference: { projectId: 'project-1', selectedItemIds: ['clip-1'] },
          revision: 4,
          generation: 7
        }
      }
    )

    const workspaceId = createHash('sha256').update(canonicalWorkspaceRoot).digest('hex')
    expect(response).toMatchObject({
      schemaVersion: 1,
      title: 'Interview selection',
      provenance: {
        extensionId: 'acme.example',
        extensionVersion: '1.0.0',
        viewContributionId: 'extension:acme.example/issues',
        workspaceId
      }
    })
    expect(response).toMatchObject({ attachmentId: expect.stringMatching(/^extension-context:[a-f0-9]{64}$/) })
    expect(JSON.stringify(response)).not.toContain(workspaceRoot)
    expect(state.mainContents.send).toHaveBeenCalledWith(
      'extension:composer-context-attached',
      expect.objectContaining({ workspaceRoot: canonicalWorkspaceRoot, attachment: response })
    )
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('denies composer context attachment without ui.actions or from a stale frame', async () => {
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
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    state.descriptors.resolveView.mockResolvedValue({
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      grantedPermissions: ['webview', 'ui.views'],
      enabled: true,
      workspaceTrusted: true
    })
    const payload = {
      sessionId: record.sessionId,
      sessionNonce: record.nonce,
      requestId: 'request-attach-context',
      method: 'ui.attachComposerContext',
      params: {
        schemaVersion: 1,
        id: 'selection',
        title: 'Selection',
        summary: 'One selected clip',
        reference: { selectedItemIds: ['clip-1'] },
        revision: 1,
        generation: 1
      }
    }

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      payload
    )).rejects.toThrow(/permission is not granted/i)
    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: { processId: 999, routingId: 999 } },
      payload
    )).rejects.toThrow(/current guest main frame/i)
    expect(state.mainContents.send).not.toHaveBeenCalled()
  })

  it('keeps protected media paths and one-time operation tokens in Main while returning opaque handles', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      runtimeSessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/tmp/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    electronMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/private/media/interview.mp4']
    })
    state.runtimeRequest.mockResolvedValue({
      ok: true,
      status: 201,
      body: JSON.stringify({
        selections: [{
          handleId: 'media_handle_0000000001',
          mode: 'read',
          kind: 'video',
          displayName: 'interview.mp4',
          mimeType: 'video/mp4',
          byteSize: 1234,
          revoked: false
        }]
      })
    })

    const response = await electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-pick',
        method: 'media.pickFiles',
        params: {
          multiple: true,
          maxFiles: 2,
          filters: [{ name: 'Videos', extensions: ['mp4'], mimeTypes: ['video/mp4'] }]
        }
      }
    )

    expect(response).toMatchObject({
      outcome: 'selected',
      files: [{ handleId: 'media_handle_0000000001', displayName: 'interview.mp4' }]
    })
    expect(JSON.stringify(response)).not.toContain('/private/media')
    expect(JSON.stringify(response)).not.toContain('operationToken')
    expect(electronMock.showOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Select media files for acme.example',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Videos', extensions: ['mp4'] }]
      })
    )
    const [path, method, body] = state.runtimeRequest.mock.calls[0]!
    expect({ path, method }).toEqual({ path: '/v1/extensions/media/selections', method: 'POST' })
    const registration = JSON.parse(body as string)
    expect(registration).toMatchObject({
      mode: 'read',
      binding: {
        sessionId: record.sessionId,
        runtimeSessionId: record.runtimeSessionId,
        extensionId: record.extensionId,
        extensionVersion: record.extensionVersion,
        contributionId: record.contributionId,
        workspaceRoot: record.workspaceRoot,
        senderWebContentsId: guest.id,
        senderMainFrameProcessId: mainFrame.processId,
        senderMainFrameRoutingId: mainFrame.routingId
      },
      selections: [{
        absolutePath: '/private/media/interview.mp4',
        displayName: 'interview.mp4'
      }]
    })
    expect(registration.operationToken).toMatch(/^[A-Za-z0-9_-]{32,}$/)
  })

  it('mints and releases sender-bound kun-media leases without returning a path', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      runtimeSessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/tmp/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const attachFrame = { processId: 299, routingId: 399 }
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame: attachFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    guest.mainFrame = mainFrame
    state.runtimeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        binding: {
          sessionId: record.sessionId,
          runtimeSessionId: record.runtimeSessionId,
          sessionNonce: record.nonce,
          extensionId: record.extensionId,
          extensionVersion: record.extensionVersion,
          contributionId: record.contributionId,
          workspaceRoot: record.workspaceRoot,
          senderWebContentsId: guest.id,
          senderMainFrameProcessId: mainFrame.processId,
          senderMainFrameRoutingId: mainFrame.routingId
        },
        handleId: 'media_handle_0000000001',
        absolutePath: '/private/media/interview.mp4',
        mimeType: 'video/mp4',
        fileIdentity: { byteSize: 1234, modifiedAtMs: 1000, device: 2, inode: 3 },
        expiresAt: '2026-07-13T00:05:00.000Z'
      })
    })

    const opened = await electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-open',
        method: 'media.openViewResource',
        params: { handleId: 'media_handle_0000000001' }
      }
    )
    expect(opened).toEqual({
      leaseId: 'lease_123456789012',
      handleId: 'media_handle_0000000001',
      url: 'kun-media://lease/opaque-lease-token',
      mimeType: 'video/mp4',
      expiresAt: '2026-07-13T00:05:00.000Z'
    })
    expect(JSON.stringify(opened)).not.toContain('/private/media')
    expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/media/leases/resolve',
      'POST',
      expect.stringContaining('media_handle_0000000001')
    )
    expect(JSON.parse(state.runtimeRequest.mock.calls[0]![2] as string).binding).toMatchObject({
      senderWebContentsId: guest.id,
      senderMainFrameProcessId: mainFrame.processId,
      senderMainFrameRoutingId: mainFrame.routingId
    })
    expect(state.mediaProtocols.createLease).toHaveBeenCalledWith(expect.objectContaining({
      viewSessionId: record.sessionId,
      absolutePath: '/private/media/interview.mp4',
      fileIdentity: { byteSize: 1234, modifiedAtMs: 1000, device: 2, inode: 3 }
    }))

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: attachFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-open-stale-frame',
        method: 'media.openViewResource',
        params: { handleId: 'media_handle_0000000001' }
      }
    )).rejects.toMatchObject({ code: 'MEDIA_SCOPE_DENIED' })
    expect(state.runtimeRequest).toHaveBeenCalledTimes(1)

    const released = await electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-release',
        method: 'media.release',
        params: { resource: 'lease', leaseId: 'lease_123456789012' }
      }
    )
    expect(released).toEqual({ released: true })
    expect(state.mediaProtocols.revokeLease).toHaveBeenCalledWith(
      'lease_123456789012',
      'released'
    )
  })

  it('rechecks the original media frame after resolution and lease creation awaits', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      runtimeSessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/tmp/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const nextFrame = { processId: 301, routingId: 401 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    const resolution = {
      ok: true,
      status: 200,
      body: JSON.stringify({
        binding: {
          sessionId: record.sessionId,
          runtimeSessionId: record.runtimeSessionId,
          sessionNonce: record.nonce,
          extensionId: record.extensionId,
          extensionVersion: record.extensionVersion,
          contributionId: record.contributionId,
          workspaceRoot: record.workspaceRoot,
          senderWebContentsId: guest.id,
          senderMainFrameProcessId: mainFrame.processId,
          senderMainFrameRoutingId: mainFrame.routingId
        },
        handleId: 'media_handle_0000000001',
        absolutePath: '/private/media/interview.mp4',
        mimeType: 'video/mp4',
        fileIdentity: { byteSize: 1234, modifiedAtMs: 1000 },
        expiresAt: '2026-07-13T00:05:00.000Z'
      })
    }
    const invoke = () => electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-navigation-race',
        method: 'media.openViewResource',
        params: { handleId: 'media_handle_0000000001' }
      }
    )

    state.runtimeRequest.mockImplementationOnce(async () => {
      guest.mainFrame = nextFrame
      return resolution
    })
    await expect(invoke()).rejects.toMatchObject({ code: 'MEDIA_SCOPE_DENIED' })
    expect(state.mediaProtocols.createLease).not.toHaveBeenCalled()

    guest.mainFrame = mainFrame
    state.runtimeRequest.mockResolvedValueOnce(resolution)
    state.mediaProtocols.createLease.mockImplementationOnce(async () => {
      guest.mainFrame = nextFrame
      return {
        leaseId: 'lease_123456789012',
        handleId: 'media_handle_0000000001',
        url: 'kun-media://lease/opaque-lease-token',
        mimeType: 'video/mp4',
        expiresAt: '2026-07-13T00:05:00.000Z'
      }
    })
    await expect(invoke()).rejects.toMatchObject({ code: 'MEDIA_SCOPE_DENIED' })
    expect(state.mediaProtocols.revokeLease).toHaveBeenCalledWith(
      'lease_123456789012',
      'released'
    )
  })

  it('opens and reveals owned artifacts from the authenticated View binding without exposing paths', async () => {
    const state = fixture()
    const workspaceRoot = '/tmp/workspace'
    const canonicalWorkspaceRoot = resolve(workspaceRoot)
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      runtimeSessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot,
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    state.runtimeRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify({
        artifactId: 'artifact_subtitle_1234567890',
        absolutePath: '/private/generated/captions.srt',
        displayName: 'captions.srt',
        mimeType: 'application/x-subrip'
      })
    })

    const invoke = (action: 'open' | 'reveal') =>
      electronMock.handlers.get('extension:view:request')!(
        { sender: guest, senderFrame: mainFrame },
        {
          sessionId: record.sessionId,
          sessionNonce: record.nonce,
          requestId: `request-artifact-${action}`,
          method: 'media.performArtifactAction',
          params: { artifactId: 'artifact_subtitle_1234567890', action }
        }
      )

    await expect(invoke('open')).resolves.toEqual({ performed: true })
    await expect(invoke('reveal')).resolves.toEqual({ performed: true })
    expect(electronMock.openPath).toHaveBeenCalledWith('/private/generated/captions.srt')
    expect(electronMock.showItemInFolder).toHaveBeenCalledWith('/private/generated/captions.srt')
    const [, , body] = state.runtimeRequest.mock.calls[0]!
    expect(JSON.parse(body as string)).toEqual({
      artifactId: 'artifact_subtitle_1234567890',
      ownerExtensionId: record.extensionId,
      ownerExtensionVersion: record.extensionVersion,
      workspaceId: createHash('sha256').update(canonicalWorkspaceRoot).digest('hex'),
      workspaceRoot: canonicalWorkspaceRoot
    })
    expect(JSON.stringify(await invoke('open'))).not.toContain('/private/generated')

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-artifact-forged-owner',
        method: 'media.performArtifactAction',
        params: {
          artifactId: 'artifact_subtitle_1234567890',
          action: 'open',
          ownerExtensionId: 'other.extension'
        }
      }
    )).rejects.toThrow()
    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: { processId: 301, routingId: 401 } },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-artifact-subframe',
        method: 'media.performArtifactAction',
        params: { artifactId: 'artifact_subtitle_1234567890', action: 'reveal' }
      }
    )).rejects.toMatchObject({ code: 'MEDIA_SCOPE_DENIED' })
  })

  it('does not invoke the desktop shell when artifact ownership resolution fails', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/tmp/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    state.runtimeRequest.mockResolvedValue({
      ok: false,
      status: 404,
      body: JSON.stringify({ error: { message: 'Generated artifact is unavailable' } })
    })

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-artifact-unavailable',
        method: 'media.performArtifactAction',
        params: { artifactId: 'artifact_subtitle_1234567890', action: 'open' }
      }
    )).rejects.toThrow()
    expect(electronMock.openPath).not.toHaveBeenCalled()
    expect(electronMock.showItemInFolder).not.toHaveBeenCalled()
  })

  it('treats native picker cancellation as no consent and creates no grant', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/tmp/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    electronMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-cancel',
        method: 'media.pickFiles',
        params: {}
      }
    )).resolves.toEqual({ outcome: 'cancelled', files: [] })
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('localizes protected native media picker titles from the current Host locale', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/tmp/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    electronMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    electronMock.showSaveDialog.mockResolvedValue({ canceled: true })

    state.setWorkbenchEnvironment({
      theme: {
        kind: 'light',
        tokens: { foreground: '#233659' },
        zoomFactor: 1,
        reducedMotion: false
      },
      locale: { language: 'zh', direction: 'ltr', messages: {} }
    })
    await electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-localized-media-import',
        method: 'media.pickFiles',
        params: {}
      }
    )
    state.setWorkbenchEnvironment({
      theme: {
        kind: 'light',
        tokens: { foreground: '#233659' },
        zoomFactor: 1,
        reducedMotion: false
      },
      locale: { language: 'zh-CN', direction: 'ltr', messages: {} }
    })
    await electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-localized-media-export',
        method: 'media.pickSaveTarget',
        params: {}
      }
    )

    state.setWorkbenchEnvironment({
      theme: {
        kind: 'light',
        tokens: { foreground: '#233659' },
        zoomFactor: 1,
        reducedMotion: false
      },
      locale: { language: 'en', direction: 'ltr', messages: {} }
    })
    await electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-english-media-import',
        method: 'media.pickFiles',
        params: {}
      }
    )
    await electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-english-media-export',
        method: 'media.pickSaveTarget',
        params: {}
      }
    )

    expect(electronMock.showOpenDialog).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ title: '为 acme.example 选择媒体文件' })
    )
    expect(electronMock.showSaveDialog).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ title: '为 acme.example 选择导出位置' })
    )
    expect(electronMock.showOpenDialog).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ title: 'Select media files for acme.example' })
    )
    expect(electronMock.showSaveDialog).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ title: 'Choose export destination for acme.example' })
    )
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('does not open a native picker if its View navigates while Main resolves the locale', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/tmp/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    state.options.getWorkbenchEnvironment = vi.fn(async (): Promise<ExtensionWorkbenchEnvironment> => {
      guest.mainFrame = { processId: 301, routingId: 401 }
      return {
        theme: {
          kind: 'light',
          tokens: { foreground: '#233659' },
          zoomFactor: 1,
          reducedMotion: false
        },
        locale: { language: 'zh-CN', direction: 'ltr', messages: {} }
      }
    })

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-picker-locale-navigation-race',
        method: 'media.pickFiles',
        params: {}
      }
    )).rejects.toMatchObject({ code: 'MEDIA_SCOPE_DENIED' })
    expect(electronMock.showOpenDialog).not.toHaveBeenCalled()
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('does not register a picker selection after its originating frame navigates', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/tmp/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    electronMock.showOpenDialog.mockImplementationOnce(async () => {
      guest.mainFrame = { processId: 301, routingId: 401 }
      return { canceled: false, filePaths: ['/private/media/interview.mp4'] }
    })

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-picker-navigation-race',
        method: 'media.pickFiles',
        params: {}
      }
    )).rejects.toMatchObject({ code: 'MEDIA_SCOPE_DENIED' })
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('releases picker handles when the frame navigates during runtime registration', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      runtimeSessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/tmp/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    electronMock.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/private/media/interview.mp4']
    })
    state.runtimeRequest.mockImplementationOnce(async () => {
      guest.mainFrame = { processId: 301, routingId: 401 }
      return {
        ok: true,
        status: 201,
        body: JSON.stringify({
          selections: [{
            handleId: 'media_handle_0000000001',
            mode: 'read',
            kind: 'video',
            displayName: 'interview.mp4',
            mimeType: 'video/mp4',
            revoked: false
          }]
        })
      }
    })
    state.runtimeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({ schemaVersion: 1, result: { released: true } })
    })

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-picker-registration-race',
        method: 'media.pickFiles',
        params: {}
      }
    )).rejects.toMatchObject({ code: 'MEDIA_SCOPE_DENIED' })
    expect(state.runtimeRequest).toHaveBeenCalledTimes(2)
    const [cleanupPath, cleanupMethod, cleanupBody, cleanupHeaders] =
      state.runtimeRequest.mock.calls[1]!
    expect({ cleanupPath, cleanupMethod }).toEqual({
      cleanupPath: `/v1/extensions/view-sessions/${record.runtimeSessionId}/requests`,
      cleanupMethod: 'POST'
    })
    expect(JSON.parse(cleanupBody as string)).toMatchObject({
      method: 'media.release',
      params: { resource: 'handle', handleId: 'media_handle_0000000001' }
    })
    expect(cleanupHeaders).toEqual({
      'x-kun-extension-session-id': record.runtimeSessionId,
      'x-kun-extension-session-nonce': record.nonce
    })

    guest.mainFrame = mainFrame
    state.runtimeRequest.mockClear()
    electronMock.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/private/media/interview.mp4']
    })
    state.runtimeRequest.mockImplementationOnce(async () => {
      guest.mainFrame = { processId: 302, routingId: 402 }
      return {
        ok: true,
        status: 201,
        body: JSON.stringify({
          selections: [{
            handleId: 'media_handle_0000000002',
            mode: 'read',
            kind: 'video',
            displayName: 'interview.mp4',
            mimeType: 'video/mp4',
            revoked: false
          }]
        })
      }
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      state.runtimeRequest.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, result: { released: false } })
      })
    }
    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-picker-cleanup-failure',
        method: 'media.pickFiles',
        params: {}
      }
    )).rejects.toMatchObject({ code: 'MEDIA_REGISTRATION_FAILED' })
    expect(state.runtimeRequest).toHaveBeenCalledTimes(4)
  })

  it('rejects picker path forgery and non-main-frame senders before opening a dialog', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot: '/tmp/workspace',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-forged-path',
        method: 'media.pickFiles',
        params: { absolutePath: '/tmp/forged.mp4' }
      }
    )).rejects.toThrow()
    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: { processId: 301, routingId: 401 } },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-subframe',
        method: 'media.pickFiles',
        params: {}
      }
    )).rejects.toMatchObject({ code: 'MEDIA_SCOPE_DENIED' })
    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-forged-save-name',
        method: 'media.pickSaveTarget',
        params: { suggestedName: '../escape.mp4' }
      }
    )).rejects.toMatchObject({ code: 'MEDIA_INVALID_ARGUMENT' })
    expect(electronMock.showOpenDialog).not.toHaveBeenCalled()
    expect(electronMock.showSaveDialog).not.toHaveBeenCalled()
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('registers a save target without returning or creating the selected path', async () => {
    const state = fixture()
    const workspaceRoot = '/tmp/workspace'
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      workspaceRoot,
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const mainFrame = { processId: 300, routingId: 400 }
    const guest = { id: 20, mainFrame, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)
    electronMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/private/exports/final.mp4'
    })
    state.runtimeRequest.mockResolvedValue({
      ok: true,
      status: 201,
      body: JSON.stringify({
        selections: [{
          handleId: 'media_export_000000001',
          mode: 'export',
          kind: 'video',
          displayName: 'final.mp4',
          mimeType: 'video/mp4',
          revoked: false
        }]
      })
    })

    const response = await electronMock.handlers.get('extension:view:request')!(
      { sender: guest, senderFrame: mainFrame },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-media-save',
        method: 'media.pickSaveTarget',
        params: {
          suggestedName: 'final.mp4',
          filters: [{ name: 'MP4', extensions: ['mp4'], mimeTypes: [] }]
        }
      }
    )

    expect(response).toMatchObject({
      outcome: 'selected',
      target: { handleId: 'media_export_000000001', mode: 'export' }
    })
    expect(JSON.stringify(response)).not.toContain('/private/exports')
    expect(electronMock.showSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Choose export destination for acme.example',
        defaultPath: join(workspaceRoot, 'final.mp4'),
        filters: [{ name: 'MP4', extensions: ['mp4'] }]
      })
    )
    const registration = JSON.parse(state.runtimeRequest.mock.calls[0]![2] as string)
    expect(registration).toMatchObject({
      mode: 'export',
      selections: [{ absolutePath: '/private/exports/final.mp4', displayName: 'final.mp4' }]
    })
  })

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

  it('denies protected account methods from a Webview before runtime dispatch', async () => {
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
    const guest = { id: 20, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)

    await expect(electronMock.handlers.get('extension:view:request')!(
      { sender: guest },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        requestId: 'request-123',
        method: 'authentication.createSession',
        params: {}
      }
    )).rejects.toThrow(/not available/)
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('collects OAuth callbacks only in a protected Main surface', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionVersion: '1.2.3',
      manifest: {
        contributes: {
          modelProviders: [{ id: 'models', authenticationProviderId: 'oauth' }],
          authentication: [{ id: 'oauth', scopes: ['models.read'] }]
        }
      }
    })
    state.credentialSurface.prompt.mockResolvedValue({
      submitted: true,
      value: 'https://callback.example/?code=secret-code&state=expected-state',
      protectedWindowSessionId: 'protected-session-123456'
    })

    const response = await electronMock.handlers.get('extension:accounts:complete-session')!(
      state.trustedEvent,
      {
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        sessionId: 'account-session-123456',
        workspaceRoot: '/workspace'
      }
    )

    expect(response).toMatchObject({ ok: true, status: 200 })
    expect(state.credentialSurface.prompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ label: 'OAuth callback URL' })
    )
    expect(state.protectedActions.performAfterProtectedDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        operationKind: 'account.complete-session',
        parameters: expect.objectContaining({
          extensionId: 'acme.example',
          extensionVersion: '1.2.3',
          sessionId: 'account-session-123456',
          callbackDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      }),
      'protected-session-123456',
      expect.any(Function)
    )
    const runtimeBody = JSON.parse(state.runtimeRequest.mock.calls.at(-1)?.[2] as string)
    expect(runtimeBody).toEqual({
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      callbackUrl: 'https://callback.example/?code=secret-code&state=expected-state',
      workspaceRoot: '/workspace'
    })
    expect(JSON.stringify(state.protectedActions.performAfterProtectedDecision.mock.calls[0]?.[0]))
      .not.toContain('secret-code')
  })

  it('binds account-session creation to the selected workspace version', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionVersion: '1.2.3',
      manifest: {
        contributes: {
          modelProviders: [{ id: 'models', authenticationProviderId: 'oauth' }],
          authentication: [{ id: 'oauth', scopes: ['models.read'] }]
        }
      }
    })

    const response = await electronMock.handlers.get('extension:accounts:create-session')!(
      state.trustedEvent,
      {
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        providerId: 'models',
        authenticationProviderId: 'oauth',
        scopes: ['models.read'],
        workspaceRoot: '/workspace'
      }
    )

    expect(response).toMatchObject({ ok: true, status: 200 })
    expect(state.descriptors.resolvePackage).toHaveBeenCalledWith('acme.example', '/workspace')
    expect(state.protectedActions.authorizeAndPerform).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        operationKind: 'account.create-session',
        workspaceRoot: '/workspace'
      }),
      expect.any(Object),
      expect.any(Function)
    )
    expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/accounts/sessions',
      'POST',
      JSON.stringify({
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        providerId: 'models',
        authenticationProviderId: 'oauth',
        scopes: ['models.read'],
        workspaceRoot: '/workspace'
      })
    )
  })

  it('shows full model-input disclosure before persisting an exact provider binding', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionVersion: '1.2.3',
      manifest: {
        displayName: 'Example models',
        contributes: {
          modelProviders: [{
            id: 'models',
            displayName: 'Example Provider',
            models: [{
              id: 'model-a',
              capabilities: { input: ['text', 'image'] }
            }]
          }]
        }
      }
    })

    const response = await electronMock.handlers.get('extension:providers:set-binding')!(
      state.trustedEvent,
      {
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        providerId: 'models',
        accountId: 'account-123',
        modelId: 'model-a',
        workspaceRoot: '/workspace'
      }
    )

    expect(response).toMatchObject({ ok: true, status: 200 })
    expect(state.protectedActions.authorizeAndPerform).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        operationKind: 'provider.bind',
        workspaceRoot: '/workspace',
        parameters: expect.objectContaining({
          providerId: 'models',
          accountId: 'account-123',
          modelId: 'model-a'
        })
      }),
      expect.objectContaining({
        detail: expect.stringMatching(/complete conversation history[\s\S]*system and mode instructions[\s\S]*attachments[\s\S]*tool names/i)
      }),
      expect.any(Function)
    )
    expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/model-providers/binding',
      'PUT',
      JSON.stringify({
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        providerId: 'models',
        accountId: 'account-123',
        modelId: 'model-a',
        workspaceRoot: '/workspace',
        acknowledgedDataAccess: true
      })
    )
  })

  it('keeps OAuth and device verification material inside the protected Main window', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionVersion: '1.2.3',
      manifest: {
        contributes: {
          modelProviders: [{ id: 'models', authenticationProviderId: 'device-auth' }],
          authentication: [{
            id: 'device-auth',
            type: 'device-code',
            scopes: ['models.read']
          }]
        }
      }
    })
    state.runtimeRequest.mockResolvedValue({
      ok: true,
      status: 201,
      body: JSON.stringify({
        schemaVersion: 1,
        session: {
          id: 'account-session-device',
          status: 'pending',
          verificationUrl: 'https://auth.example/device',
          userCode: 'ABCD-EFGH',
          expiresAt: '2099-07-11T10:10:00.000Z'
        }
      })
    })
    state.credentialSurface.presentAuthorization.mockResolvedValue(undefined)

    const response = await electronMock.handlers.get('extension:accounts:create-session')!(
      state.trustedEvent,
      {
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        providerId: 'models',
        authenticationProviderId: 'device-auth',
        workspaceRoot: '/workspace'
      }
    ) as { body: string }

    expect(state.credentialSurface.presentAuthorization).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        verificationUrl: 'https://auth.example/device',
        userCode: 'ABCD-EFGH'
      })
    )
    expect(JSON.parse(response.body).session).toEqual({
      id: 'account-session-device',
      status: 'pending',
      expiresAt: '2099-07-11T10:10:00.000Z'
    })
    expect(response.body).not.toContain('ABCD-EFGH')
    expect(response.body).not.toContain('auth.example')

    const refreshed = await electronMock.handlers.get('extension:accounts:get-session')!(
      state.trustedEvent,
      { extensionId: 'acme.example', sessionId: 'account-session-device' }
    ) as { body: string }
    expect(refreshed.body).not.toContain('ABCD-EFGH')
    expect(refreshed.body).not.toContain('auth.example')
  })

  it('replaces an API key through the protected surface while binding only its digest to consent', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({ extensionVersion: '1.2.3' })
    state.credentialSurface.prompt.mockResolvedValue({
      submitted: true,
      value: 'replacement-secret-key',
      protectedWindowSessionId: 'protected-session-replace'
    })

    await electronMock.handlers.get('extension:accounts:replace-api-key')!(state.trustedEvent, {
      extensionId: 'acme.example',
      extensionVersion: '1.2.3',
      providerId: 'models',
      accountId: 'account-123',
      workspaceRoot: '/workspace'
    })

    const binding = state.protectedActions.performAfterProtectedDecision.mock.calls.at(-1)?.[0]
    expect(binding).toMatchObject({
      operationKind: 'account.replace-api-key',
      parameters: expect.objectContaining({
        accountId: 'account-123',
        secretDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    })
    expect(JSON.stringify(binding)).not.toContain('replacement-secret-key')
    expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/accounts/account-123/api-key',
      'PUT',
      expect.stringContaining('replacement-secret-key')
    )
  })

  it('pumps one-shot raw secret decisions through a Main-owned warning dialog', async () => {
    const state = fixture()
    state.runtimeRequest.mockImplementation(async (path: string, method?: string) => {
      if (path === '/v1/extensions/secret-reveal-requests' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            requests: [{
              id: 'secret_reveal_12345678-1234-1234-1234-123456789abc',
              extensionId: 'acme.example',
              extensionVersion: '1.2.3',
              accountId: 'account-123',
              operation: 'sign-request'
            }]
          })
        }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    electronMock.showMessageBox.mockResolvedValue({ response: 1 })

    const stop = startExtensionSecretRevealConsentPump(state.options, 10_000)
    await vi.waitFor(() => expect(electronMock.showMessageBox).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/secret-reveal-requests/secret_reveal_12345678-1234-1234-1234-123456789abc/decision',
      'POST',
      JSON.stringify({ decision: 'allow' })
    ))
    stop()
  })

  it('projects validated runtime notification snapshots and returns trusted user actions', async () => {
    const state = fixture()
    const notificationId = 'notification_12345678-1234-1234-1234-123456789abc'
    state.runtimeRequest.mockImplementation(async (path: string, method?: string, body?: string) => {
      if (path === '/v1/extensions/workbench/notifications' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            schemaVersion: 1,
            notifications: [{
              notificationId,
              extensionId: 'acme.example',
              extensionVersion: '1.2.3',
              sourceId: 'provider-warning',
              title: 'Provider unavailable',
              message: 'Reconnect the account and retry.',
              severity: 'warning',
              actions: [{ id: 'retry', title: 'Retry' }],
              createdAt: '2026-07-11T00:00:00.000Z',
              expiresAt: '2026-07-11T00:01:00.000Z'
            }]
          })
        }
      }
      if (path.endsWith(`/${notificationId}/respond`) && method === 'POST') {
        expect(body).toBe(JSON.stringify({ actionId: 'retry' }))
        return { ok: true, status: 200, body: JSON.stringify({ responded: true }) }
      }
      return { ok: false, status: 404, body: '{}' }
    })

    const stop = startExtensionNotificationPump(state.options, 10_000)
    const workbench = state.mainContents
    await vi.waitFor(() => expect(workbench.send).toHaveBeenCalledWith(
      'extension:notifications',
      {
        notifications: [expect.objectContaining({
          notificationId,
          extensionId: 'acme.example',
          actions: [{ id: 'retry', title: 'Retry' }]
        })]
      }
    ))
    stop()
    await vi.waitFor(() => expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/workbench/presence',
      'DELETE'
    ))

    await expect(electronMock.handlers.get('extension:notification:respond')!(
      state.trustedEvent,
      { notificationId, actionId: 'retry' }
    )).resolves.toBe(true)
    await expect(electronMock.handlers.get('extension:notification:respond')!(
      state.untrustedEvent,
      { notificationId, actionId: 'retry' }
    )).rejects.toThrow(/trusted workbench frame/)
  })

  it('dispatches fire-and-forget guest notifications through the broker route', async () => {
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
    const guest = { id: 20, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)

    await electronMock.handlers.get('extension:view:notify')!(
      { sender: guest },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        method: 'ui.setViewState',
        params: { value: { selected: 'item-1' } }
      }
    )

    expect(state.runtimeRequest).toHaveBeenCalledWith(
      `/v1/extensions/view-sessions/${record.runtimeSessionId}/requests`,
      'POST',
      expect.stringMatching(/"requestId":"view-notify-[^"]+".*"method":"ui\.setViewState"/),
      {
        'x-kun-extension-session-id': record.runtimeSessionId,
        'x-kun-extension-session-nonce': record.nonce
      }
    )
  })

  it('tears down content scripts and rejects protected surfaces', async () => {
    const state = fixture()
    await expect(electronMock.handlers.get('extension:sync-host-content-scripts')!(
      state.trustedEvent,
      {
        surface: null,
        protectedSurface: 'account-credentials',
        descriptors: []
      }
    )).resolves.toMatchObject({
      ok: false,
      code: 'EXTENSION_PROTECTED_SURFACE_DENIED',
      reloadScheduled: false
    })
    expect(state.contentScripts.sync).toHaveBeenCalledWith(
      state.trustedEvent.sender,
      expect.objectContaining({ protectedSurface: 'account-credentials' })
    )
    expect(state.contentScripts.clearFrame).not.toHaveBeenCalled()
  })

  it('binds preload bootstrap and the narrow bridge to the trusted main frame', async () => {
    const state = fixture()
    const bootstrapEvent = { ...state.trustedEvent, returnValue: undefined as unknown }
    electronMock.listeners.get('extension:content-script:bootstrap')!(bootstrapEvent)
    expect(bootstrapEvent.returnValue).toEqual({ version: 1, generation: 'test', bindings: [] })
    expect(state.contentScripts.bootstrap).toHaveBeenCalledWith(state.trustedEvent.sender)

    const request = {
      bindingId: 'content_script_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      method: 'reportDiagnostic',
      diagnostic: { code: 'SELECTOR_MISSING', message: 'Expected selector was absent.' }
    }
    await expect(electronMock.handlers.get('extension:content-script:bridge')!(
      state.untrustedEvent,
      request
    )).rejects.toThrow(/trusted workbench frame/)
    await expect(electronMock.handlers.get('extension:content-script:bridge')!(
      state.trustedEvent,
      request
    )).resolves.toEqual({ ok: true })
    expect(state.contentScripts.handleBridgeRequest).toHaveBeenCalledWith(
      state.trustedEvent.sender,
      expect.objectContaining({ bindingId: request.bindingId, method: 'reportDiagnostic' })
    )
  })

  it('merges bounded Main content-script diagnostics into extension doctor output', async () => {
    const state = fixture()
    state.runtimeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({ diagnostics: [] })
    })
    const result = await electronMock.handlers.get('extension:diagnostics')!(
      state.trustedEvent,
      'acme.example'
    ) as { body: string }
    expect(JSON.parse(result.body)).toMatchObject({
      diagnostics: [],
      contentScriptDiagnostics: [expect.objectContaining({
        code: 'HOST_DOM_EXTENSION_DIAGNOSTIC',
        extensionId: 'acme.example'
      })]
    })
  })

  it('revokes only the disabled extension workspace in Main-owned surfaces', async () => {
    const state = fixture()
    const workspaceA = state.viewSessions.create({
      sessionId: 'view-workspace-a',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      workspaceRoot: '/workspace/a',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    const workspaceB = state.viewSessions.create({
      sessionId: 'view-workspace-b',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      workspaceRoot: '/workspace/b',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    await electronMock.handlers.get('extension:disable')!(state.trustedEvent, {
      extensionId: 'acme.example',
      workspaceRoot: '/workspace/a'
    })
    expect(state.viewSessions.get(workspaceA.sessionId)).toBeUndefined()
    expect(state.viewSessions.get(workspaceB.sessionId)).toMatchObject({
      workspaceRoot: '/workspace/b'
    })
    expect(state.contentScripts.revokeExtension).toHaveBeenCalledWith(
      state.trustedEvent.sender,
      'acme.example',
      'disable',
      '/workspace/a'
    )
  })

  it('revokes only the permission-changed extension workspace in Main-owned surfaces', async () => {
    const state = fixture()
    state.descriptors.resolvePackage.mockResolvedValue({
      extensionVersion: '1.0.0',
      grantedPermissions: ['ui.views']
    })
    const workspaceA = state.viewSessions.create({
      sessionId: 'permission-workspace-a',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      workspaceRoot: '/workspace/a',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    const workspaceB = state.viewSessions.create({
      sessionId: 'permission-workspace-b',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      workspaceRoot: '/workspace/b',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })

    await electronMock.handlers.get('extension:set-permissions')!(state.trustedEvent, {
      extensionId: 'acme.example',
      workspaceRoot: '/workspace/a',
      expectedVersion: '1.0.0',
      permissions: []
    })

    expect(state.viewSessions.get(workspaceA.sessionId)).toBeUndefined()
    expect(state.viewSessions.get(workspaceB.sessionId)).toMatchObject({
      workspaceRoot: '/workspace/b'
    })
    expect(state.contentScripts.revokeExtension).toHaveBeenCalledWith(
      state.trustedEvent.sender,
      'acme.example',
      'permission-change',
      '/workspace/a'
    )
  })

  it('forwards only the fixed command route and validated absolute workspace', async () => {
    const state = fixture()
    const result = await electronMock.handlers.get('extension:invoke-command')!(
      state.trustedEvent,
      {
        commandId: 'extension:acme.example/open',
        context: { source: 'topBar' },
        workspaceRoot: '/workspace'
      }
    )
    expect(result).toEqual({ ok: true })
    expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/commands/invoke',
      'POST',
      JSON.stringify({
        commandId: 'extension:acme.example/open',
        context: { source: 'topBar' },
        workspaceRoot: '/workspace'
      })
    )
  })

  it('maps trusted workbench and provider reads only onto fixed runtime routes', async () => {
    const state = fixture()

    await electronMock.handlers.get('extension:workbench:get')!(
      state.trustedEvent,
      { workspaceRoot: '/workspace one', locale: 'zh-CN' }
    )
    expect(state.runtimeRequest).toHaveBeenLastCalledWith(
      '/v1/extensions/workbench?workspace_root=%2Fworkspace+one&locale=zh-CN',
      'GET'
    )

    await electronMock.handlers.get('extension:list')!(
      state.trustedEvent,
      { limit: 50, workspaceRoot: '/workspace one', locale: 'zh-CN' }
    )
    expect(state.runtimeRequest).toHaveBeenLastCalledWith(
      '/v1/extensions?limit=50&workspace_root=%2Fworkspace+one&locale=zh-CN',
      'GET'
    )

    await electronMock.handlers.get('extension:model-providers:list')!(
      state.trustedEvent,
      undefined
    )
    expect(state.runtimeRequest).toHaveBeenLastCalledWith(
      '/v1/extensions/model-providers',
      'GET'
    )

    await electronMock.handlers.get('extension:model-providers:list-models')!(
      state.trustedEvent,
      {
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        providerId: 'models',
        accountId: 'account/with?delimiters',
        workspaceRoot: '/workspace'
      }
    )
    expect(state.runtimeRequest).toHaveBeenLastCalledWith(
      '/v1/extensions/model-providers/models?' +
        'extension_id=acme.example&extension_version=1.2.3&provider_id=models&' +
        'account_id=account%2Fwith%3Fdelimiters&workspace_root=%2Fworkspace',
      'GET'
    )
  })

  it('maps trusted configuration operations onto fixed methods and JSON bodies', async () => {
    const state = fixture()
    const load = {
      contributionIds: ['extension:acme.example/general'],
      workspaceRoot: '/workspace'
    }
    await electronMock.handlers.get('extension:configuration:load')!(state.trustedEvent, load)
    expect(state.runtimeRequest).toHaveBeenLastCalledWith(
      '/v1/extensions/configuration/snapshot',
      'POST',
      JSON.stringify(load)
    )

    const update = {
      contributionId: 'extension:acme.example/general',
      key: 'mode',
      value: 'safe',
      expectedRevision: 2,
      workspaceRoot: '/workspace'
    }
    await electronMock.handlers.get('extension:configuration:update')!(state.trustedEvent, update)
    expect(state.runtimeRequest).toHaveBeenLastCalledWith(
      '/v1/extensions/configuration',
      'PUT',
      JSON.stringify(update)
    )
  })

  it('rejects every dedicated workbench bridge before runtime dispatch for untrusted senders', async () => {
    const state = fixture()
    const calls: Array<[string, unknown]> = [
      ['extension:workbench:get', { workspaceRoot: '/workspace' }],
      ['extension:model-providers:list', { workspaceRoot: '/workspace' }],
      ['extension:model-providers:list-models', {
        extensionId: 'acme.example',
        extensionVersion: '1.2.3',
        providerId: 'models',
        accountId: 'account-1',
        workspaceRoot: '/workspace'
      }],
      ['extension:configuration:load', {
        contributionIds: ['extension:acme.example/general'],
        workspaceRoot: '/workspace'
      }],
      ['extension:configuration:update', {
        contributionId: 'extension:acme.example/general',
        key: 'mode',
        value: 'safe',
        expectedRevision: 0,
        workspaceRoot: '/workspace'
      }]
    ]
    for (const [channel, payload] of calls) {
      await expect(
        electronMock.handlers.get(channel)!(state.untrustedEvent, payload)
      ).rejects.toThrow(/trusted workbench frame/)
    }
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('rejects route injection and relative workspaces before runtime dispatch', async () => {
    const state = fixture()
    await expect(electronMock.handlers.get('extension:workbench:get')!(
      state.trustedEvent,
      { workspaceRoot: 'relative', path: '/v1/usage' }
    )).rejects.toThrow(/Invalid payload/)
    await expect(electronMock.handlers.get('extension:configuration:update')!(
      state.trustedEvent,
      {
        contributionId: 'extension:acme.example/general',
        key: 'mode',
        value: 'safe',
        expectedRevision: 0,
        workspaceRoot: '/workspace',
        method: 'DELETE'
      }
    )).rejects.toThrow(/Invalid payload/)
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })

  it('rejects configuration bodies above the runtime route limit in Main', async () => {
    const state = fixture()
    await expect(electronMock.handlers.get('extension:configuration:update')!(
      state.trustedEvent,
      {
        contributionId: 'extension:acme.example/general',
        key: 'mode',
        value: 'x'.repeat(256 * 1024),
        expectedRevision: 0,
        workspaceRoot: '/workspace'
      }
    )).rejects.toThrow(/payload is too large/)
    expect(state.runtimeRequest).not.toHaveBeenCalled()
  })
})
