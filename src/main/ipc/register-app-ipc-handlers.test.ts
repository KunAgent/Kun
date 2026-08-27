import {
  cleanupAppIpcHandlerTestState,
  getAppIpcElectronMock,
  getProtectedProviderMocks,
  handlers,
  registerOptions,
  resetAppIpcHandlerTestState,
  settings,
  settingsWithProtectedSubscriptionCredentials
} from './register-app-ipc-handlers.test-support'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {
  tmpdir
} from 'node:os'
import {
  join
} from 'node:path'
import {
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  registerAppIpcHandlers
} from './register-app-ipc-handlers'

vi.mock('../main-window', () => ({
  trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html'
}))

const electronMock = getAppIpcElectronMock()
const protectedProviderMocks = getProtectedProviderMocks()

describe('registerAppIpcHandlers security and provider', () => {
  beforeEach(resetAppIpcHandlerTestState)
  afterEach(cleanupAppIpcHandlerTestState)

  it('applies bounded app badge counts only for the trusted workbench frame', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const trustedEvent = { sender: contents, senderFrame: mainFrame }
    const untrustedEvent = { sender: { id: 9 }, senderFrame: mainFrame }
    registerAppIpcHandlers(registerOptions({ getMainWindow: () => mainWindow as never }))

    const supported = process.platform === 'darwin' || process.platform === 'linux'
    await expect(handlers.get('app:badge-count')?.(trustedEvent, 3))
      .resolves.toEqual({ applied: supported })
    expect(electronMock.setBadgeCount).toHaveBeenCalledTimes(supported ? 1 : 0)
    if (supported) expect(electronMock.setBadgeCount).toHaveBeenCalledWith(3)
    await expect(handlers.get('app:badge-count')?.(trustedEvent, -1)).rejects.toThrow(
      /Invalid payload for app:badge-count/
    )
    await expect(handlers.get('app:badge-count')?.(untrustedEvent, 1)).rejects.toThrow(
      /trusted workbench frame/
    )
  })

  it('registers the Cursor subscription discovery handler at application startup', () => {
    registerAppIpcHandlers(registerOptions())

    expect(handlers.get('cursor-subscription:discover')).toBeTypeOf('function')
    expect(handlers.get('gemini-cli-subscription:status')).toBeTypeOf('function')
    expect(handlers.get('gemini-cli-subscription:models')).toBeTypeOf('function')
  })

  it('resolves persisted Claude and Cursor credentials through the Main-only Registry projection', async () => {
    const projected = settingsWithProtectedSubscriptionCredentials()
    const stored: AppSettingsV1 = {
      ...projected,
      provider: {
        ...projected.provider,
        providers: projected.provider.providers.map((provider) => ({
          ...provider,
          apiKey: ''
        }))
      }
    }
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const trustedEvent = { sender: contents, senderFrame: mainFrame }
    const withRegistryCredentials = vi.fn(async () => projected)
    registerAppIpcHandlers(registerOptions({
      store: { load: vi.fn(async () => stored) } as never,
      getMainWindow: () => mainWindow as never,
      withRegistryCredentials
    }))

    await handlers.get('claude-subscription:probe')?.(
      trustedEvent,
      undefined,
      'claude-subscription'
    )
    await handlers.get('claude-subscription:models')?.(
      trustedEvent,
      undefined,
      'claude-subscription'
    )
    await handlers.get('cursor-subscription:discover')?.(
      trustedEvent,
      { providerId: 'cursor-subscription' }
    )

    expect(protectedProviderMocks.probeClaudeSubscription).toHaveBeenCalledWith(expect.objectContaining({
      token: 'registry-claude-secret'
    }))
    expect(protectedProviderMocks.fetchSdkModels).toHaveBeenCalledWith(expect.objectContaining({
      token: 'registry-claude-secret'
    }))
    expect(protectedProviderMocks.discoverCursorSubscription).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'registry-cursor-secret'
    }))
    expect(withRegistryCredentials).toHaveBeenCalledTimes(3)
    expect(withRegistryCredentials.mock.calls).toEqual([
      [stored, ['claude-subscription']],
      [stored, ['claude-subscription']],
      [stored, ['cursor-subscription']]
    ])
  })

  it('rejects untrusted Registry credential lookups before loading protected settings', async () => {
    const projected = settingsWithProtectedSubscriptionCredentials()
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const untrustedEvent = {
      sender: { id: 99 },
      senderFrame: { processId: 90, routingId: 91, url: 'http://127.0.0.1:5173/index.html' }
    }
    const storeLoad = vi.fn(async () => settings())
    const withRegistryCredentials = vi.fn(async () => projected)
    registerAppIpcHandlers(registerOptions({
      store: { load: storeLoad } as never,
      getMainWindow: () => mainWindow as never,
      withRegistryCredentials
    }))

    await expect(handlers.get('claude-subscription:probe')?.(
      untrustedEvent,
      undefined,
      'claude-subscription'
    )).rejects.toThrow(/trusted workbench frame/)
    await expect(handlers.get('claude-subscription:models')?.(
      untrustedEvent,
      undefined,
      'claude-subscription'
    )).rejects.toThrow(/trusted workbench frame/)
    await expect(handlers.get('cursor-subscription:discover')?.(
      untrustedEvent,
      { providerId: 'cursor-subscription' }
    )).rejects.toThrow(/trusted workbench frame/)
    await expect(handlers.get('claude-subscription:probe')?.(
      untrustedEvent,
      'renderer-supplied-secret'
    )).rejects.toThrow(/trusted workbench frame/)

    expect(storeLoad).not.toHaveBeenCalled()
    expect(withRegistryCredentials).not.toHaveBeenCalled()
    expect(protectedProviderMocks.probeClaudeSubscription).not.toHaveBeenCalled()
    expect(protectedProviderMocks.fetchSdkModels).not.toHaveBeenCalled()
    expect(protectedProviderMocks.discoverCursorSubscription).not.toHaveBeenCalled()
  })

  it('binds protected subscription credentials to the expected provider transport', async () => {
    const projected = settingsWithProtectedSubscriptionCredentials()
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const trustedEvent = { sender: contents, senderFrame: mainFrame }
    const withRegistryCredentials = vi.fn(async () => projected)
    registerAppIpcHandlers(registerOptions({
      store: { load: vi.fn(async () => projected) } as never,
      getMainWindow: () => mainWindow as never,
      withRegistryCredentials
    }))

    await expect(handlers.get('claude-subscription:probe')?.(
      trustedEvent,
      undefined,
      'cursor-subscription'
    )).rejects.toThrow(/not an? agent-sdk provider/)
    await expect(handlers.get('claude-subscription:models')?.(
      trustedEvent,
      undefined,
      'cursor-subscription'
    )).rejects.toThrow(/not an? agent-sdk provider/)
    await expect(handlers.get('cursor-subscription:discover')?.(
      trustedEvent,
      { providerId: 'claude-subscription' }
    )).rejects.toThrow(/not a cursor-sdk provider/)

    expect(protectedProviderMocks.probeClaudeSubscription).not.toHaveBeenCalled()
    expect(protectedProviderMocks.fetchSdkModels).not.toHaveBeenCalled()
    expect(protectedProviderMocks.discoverCursorSubscription).not.toHaveBeenCalled()
    expect(withRegistryCredentials).not.toHaveBeenCalled()
  })

  it('allows explicit subscription credential drafts without a Registry lookup', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const trustedEvent = { sender: contents, senderFrame: mainFrame }
    const withRegistryCredentials = vi.fn(async () => {
      throw new Error('Registry lookup must not run for an explicit draft')
    })
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      withRegistryCredentials
    }))

    await handlers.get('claude-subscription:probe')?.(
      trustedEvent,
      'draft-claude-secret',
      'cursor-subscription'
    )
    await handlers.get('claude-subscription:models')?.(
      trustedEvent,
      'draft-claude-secret',
      'cursor-subscription'
    )
    await handlers.get('cursor-subscription:discover')?.(trustedEvent, {
      apiKey: 'draft-cursor-secret',
      providerId: 'claude-subscription'
    })

    expect(withRegistryCredentials).not.toHaveBeenCalled()
    expect(protectedProviderMocks.probeClaudeSubscription).toHaveBeenCalledWith(expect.objectContaining({
      token: 'draft-claude-secret'
    }))
    expect(protectedProviderMocks.fetchSdkModels).toHaveBeenCalledWith(expect.objectContaining({
      token: 'draft-claude-secret'
    }))
    expect(protectedProviderMocks.discoverCursorSubscription).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'draft-cursor-secret'
    }))
  })

  it('bypasses cache for development reload commands and keeps packaged reloads ordinary', async () => {
    const reload = vi.fn()
    const reloadIgnoringCache = vi.fn()
    const contents = { reload, reloadIgnoringCache }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    registerAppIpcHandlers(registerOptions({ getMainWindow: () => mainWindow as never }))
    const handler = handlers.get('desktop:command')

    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173')
    await handler?.({ sender: contents }, 'reload')
    expect(reloadIgnoringCache).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()

    reloadIgnoringCache.mockClear()
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    await handler?.({ sender: contents }, 'reload')
    expect(reload).toHaveBeenCalledOnce()
    expect(reloadIgnoringCache).not.toHaveBeenCalled()
  })

  it('registers a trusted dedicated runtime image upload bridge', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const runtimeRequest = vi.fn(async (path: string, _method?: string, body?: string) => {
      if (path === '/v1/runtime/info') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            capabilities: {
              attachments: {
                maxImageBytes: 5 * 1024 * 1024,
                maxImageDimension: 4096,
                allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
                textFallbackMaxBase64Bytes: 512 * 1024,
                textFallbackMaxImageDimension: 1280,
                textFallbackPreferredMimeType: 'image/webp'
              }
            }
          })
        }
      }
      const upload = JSON.parse(body ?? '{}') as Record<string, unknown>
      return {
        ok: true,
        status: 201,
        body: JSON.stringify({
          attachment: {
            id: 'att_ipc',
            name: upload.name,
            kind: 'image',
            mimeType: upload.mimeType,
            byteSize: Buffer.from(String(upload.dataBase64), 'base64').byteLength,
            hash: 'hash',
            textFallback: upload.textFallback,
            createdAt: 't0',
            updatedAt: 't0'
          }
        })
      }
    })
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      runtimeRequest: runtimeRequest as never
    }))
    const handler = handlers.get('runtime:attachment:upload-image')
    const payload = {
      source: {
        kind: 'base64',
        mimeType: 'image/png',
        dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      },
      name: 'pixel.png'
    }

    await expect(handler?.({
      sender: { id: 99 },
      senderFrame: { processId: 90, routingId: 91, url: 'http://127.0.0.1:5173/index.html' }
    }, payload)).rejects.toThrow(/trusted workbench frame/)
    await expect(handler?.({ sender: contents, senderFrame: mainFrame }, payload)).resolves.toMatchObject({
      ok: true,
      attachment: { id: 'att_ipc' }
    })
    expect(runtimeRequest.mock.calls.map((call) => call[0])).toEqual([
      '/v1/runtime/info',
      '/v1/attachments'
    ])
  })

  it('reveals a workspace file only for the trusted workbench frame', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-reveal-workspace-'))
    const filePath = join(root, 'preview.md')
    writeFileSync(filePath, '# Preview', 'utf8')
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    try {
      registerAppIpcHandlers(registerOptions({ getMainWindow: () => mainWindow as never }))
      const handler = handlers.get('file:reveal-workspace-file')
      const payload = { path: 'preview.md', workspaceRoot: root }

      await expect(handler?.({
        sender: { id: 99 },
        senderFrame: { processId: 90, routingId: 91, url: 'http://127.0.0.1:5173/index.html' }
      }, payload)).rejects.toThrow(/trusted workbench frame/)
      await expect(handler?.({ sender: contents, senderFrame: mainFrame }, payload)).resolves.toEqual({ ok: true })
      const shownPath = electronMock.showItemInFolder.mock.calls[0]?.[0]
      expect(shownPath).toBeTypeOf('string')
      const canonicalPath = (candidate: string): string =>
        typeof (realpathSync as { native?: (path: string) => string }).native === 'function'
          ? realpathSync.native(candidate).toLowerCase()
          : realpathSync(candidate).toLowerCase()
      expect(canonicalPath(shownPath as string)).toBe(canonicalPath(filePath))
      expect(electronMock.openPath).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects reveal targets that escape or do not name a workspace file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-reveal-boundary-'))
    const workspaceRoot = join(root, 'workspace')
    const outsideFile = join(root, 'outside.md')
    mkdirSync(workspaceRoot)
    writeFileSync(outsideFile, '# Outside', 'utf8')
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const event = { sender: contents, senderFrame: mainFrame }

    try {
      registerAppIpcHandlers(registerOptions({ getMainWindow: () => mainWindow as never }))
      const handler = handlers.get('file:reveal-workspace-file')
      expect(handler).toBeTypeOf('function')

      await expect(handler?.(event, {
        path: '../outside.md',
        workspaceRoot
      })).resolves.toMatchObject({ ok: false })
      await expect(handler?.(event, {
        path: outsideFile,
        workspaceRoot
      })).resolves.toMatchObject({ ok: false })
      await expect(handler?.(event, {
        path: '.',
        workspaceRoot
      })).resolves.toEqual({
        ok: false,
        message: 'Path must point to a regular workspace file.'
      })
      await expect(handler?.(event, {
        path: 'missing.md',
        workspaceRoot
      })).resolves.toMatchObject({ ok: false })
      await expect(handler?.(event, {
        path: outsideFile
      })).rejects.toThrow(/Invalid payload for file:reveal-workspace-file/)
      expect(electronMock.showItemInFolder).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires startup readiness and a trusted workbench URL for generic Runtime requests', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const assertRendererRuntimeReady = vi.fn(() => {
      throw new Error('Kun desktop startup is not ready (phase: runtime_handoff).')
    })
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      runtimeRequest,
      assertRendererRuntimeReady
    }))

    await expect(handlers.get('runtime:request')?.({
      sender: contents,
      senderFrame: mainFrame
    }, { path: '/health', method: 'GET' })).rejects.toThrow(/startup is not ready/)
    expect(runtimeRequest).not.toHaveBeenCalled()

    await expect(handlers.get('runtime:request')?.({
      sender: contents,
      senderFrame: { ...mainFrame, url: 'https://example.com' }
    }, { path: '/health', method: 'GET' })).rejects.toThrow(/trusted workbench frame/)
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

})
