import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeScheduleSettings,
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  mergeKunRuntimeSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../../shared/app-settings'
import { registerAppIpcHandlers } from './register-app-ipc-handlers'
import {
  ApprovalConsentVerifier,
  KUN_APPROVAL_CONSENT_HEADER
} from '../../../kun/src/server/approval-consent.js'

const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()
const electronMock = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  openPath: vi.fn(async () => ''),
  showItemInFolder: vi.fn()
}))
const uiPluginMocks = vi.hoisted(() => ({
  ensureBundledUiPlugins: vi.fn(async () => undefined),
  installUiPluginFromDirectory: vi.fn(),
  listUiPlugins: vi.fn(),
  loadUiPluginFigures: vi.fn(),
  removeUiPlugin: vi.fn(),
  activate: vi.fn(async (_pluginId: string, _css: string) => undefined),
  deactivate: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  app: {
    quit: vi.fn()
  },
  dialog: { showMessageBox: electronMock.showMessageBox },
  shell: {
    openPath: electronMock.openPath,
    showItemInFolder: electronMock.showItemInFolder
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../services/ui-plugin-service', () => ({
  installUiPluginFromDirectory: uiPluginMocks.installUiPluginFromDirectory,
  listUiPlugins: uiPluginMocks.listUiPlugins,
  loadUiPluginFigures: uiPluginMocks.loadUiPluginFigures,
  removeUiPlugin: uiPluginMocks.removeUiPlugin
}))

vi.mock('../ui-plugin-bundled', () => ({
  ensureBundledUiPlugins: uiPluginMocks.ensureBundledUiPlugins
}))

vi.mock('../services/ui-plugin-cdp-theme-controller', () => ({
  UiPluginCdpThemeController: class {
    activePluginId: string | null = null

    async activate(pluginId: string, css: string): Promise<void> {
      await uiPluginMocks.activate(pluginId, css)
      this.activePluginId = pluginId
    }

    async deactivate(): Promise<void> {
      await uiPluginMocks.deactivate()
      this.activePluginId = null
    }
  }
}))

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: []
  }
}

function registerOptions(overrides: Partial<Parameters<typeof import('./register-app-ipc-handlers').registerAppIpcHandlers>[0]> = {}) {
  const applySettingsPatch = vi.fn(async () => settings())
  const saveSettingsPatch = vi.fn(async () => settings())
  return {
    store: { load: vi.fn(async () => settings()) } as never,
    getMainWindow: () => null,
    applySettingsPatch,
    saveSettingsPatch,
    runtimeRequest: vi.fn() as never,
    restartRuntime: vi.fn(async () => undefined),
    fetchUpstreamModels: vi.fn() as never,
    getClawRuntime: () => null,
    getScheduleRuntime: () => null,
    getWorkflowRuntime: () => null,
    startFeishuInstallQrcode: vi.fn() as never,
    pollFeishuInstall: vi.fn() as never,
    startWeixinInstallQrcode: vi.fn() as never,
    pollWeixinInstall: vi.fn() as never,
    resolveKunConfigPath: () => '/tmp/kun.json',
    showTurnCompleteNotification: vi.fn() as never,
    getAppVersion: () => '0.1.0',
    readGuiUpdateState: vi.fn() as never,
    loadGuiUpdaterModule: vi.fn() as never,
    resolveLogDirectory: () => '/tmp/logs',
    logError: vi.fn(),
    ...overrides
  }
}

describe('registerAppIpcHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    electronMock.showMessageBox.mockReset()
    electronMock.openPath.mockClear()
    electronMock.showItemInFolder.mockClear()
    uiPluginMocks.ensureBundledUiPlugins.mockClear()
    uiPluginMocks.installUiPluginFromDirectory.mockReset()
    uiPluginMocks.listUiPlugins.mockReset()
    uiPluginMocks.loadUiPluginFigures.mockReset()
    uiPluginMocks.removeUiPlugin.mockReset()
    uiPluginMocks.activate.mockClear()
    uiPluginMocks.deactivate.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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

  it('rejects invalid settings patches at the handler boundary', async () => {
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const handler = handlers.get('settings:set')
    expect(handler).toBeTypeOf('function')
    await expect(
      handler?.({}, { agents: { kun: { mysteryFlag: true } } })
    ).rejects.toThrow(/Invalid payload for settings:set/)
    expect(applySettingsPatch).not.toHaveBeenCalled()
  })

  it('reports whether a workspace directory currently exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-workspace-exists-'))
    const filePath = join(root, 'not-a-directory')
    writeFileSync(filePath, 'file', 'utf8')
    registerAppIpcHandlers(registerOptions())

    const handler = handlers.get('workspace:directory-exists')
    expect(handler).toBeTypeOf('function')
    await expect(handler?.({}, root)).resolves.toBe(true)
    await expect(handler?.({}, filePath)).resolves.toBe(false)
    await expect(handler?.({}, join(root, 'missing'))).resolves.toBe(false)

    rmSync(root, { recursive: true, force: true })
  })

  it('passes valid settings patches through to applySettingsPatch', async () => {
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      theme: 'dark' as const,
      agents: {
        kun: {
          port: 19000
        }
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('preserves project grants instead of accepting them through generic settings writes', async () => {
    const applySettingsPatch = vi.fn(async () => settings())
    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    await handlers.get('settings:set')?.({}, {
      agents: {
        kun: {
          model: 'next-model',
          projectConfig: {
            grants: [{ workspaceRoot: '/workspace/forged', configDigest: 'a'.repeat(64) }]
          }
        }
      }
    })

    expect(applySettingsPatch).toHaveBeenCalledWith({
      agents: { kun: { model: 'next-model' } }
    })
  })

  it('does not persist a renderer-requested bypass mode without protected native consent', async () => {
    const current = settings()
    const mainFrame = { processId: 10, routingId: 20 }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const applySettingsPatch = vi.fn(async () => settings())
    const saveSettingsPatch = vi.fn(async () => settings())
    registerAppIpcHandlers(registerOptions({
      store: { load: vi.fn(async () => current) } as never,
      getMainWindow: () => mainWindow as never,
      applySettingsPatch,
      saveSettingsPatch
    }))
    const payload = {
      agents: { kun: { approvalPolicy: 'auto' as const, sandboxMode: 'danger-full-access' as const } }
    }
    const trustedEvent = { sender: contents, senderFrame: mainFrame }

    await expect(handlers.get('settings:set')?.({
      sender: { id: 99 },
      senderFrame: { processId: 90, routingId: 91 }
    }, payload)).rejects.toThrow(/trusted workbench frame/)
    expect(applySettingsPatch).not.toHaveBeenCalled()

    // A Direct DOM synthetic click can at most make the trusted renderer send
    // this request. Cancelling the Main-owned prompt leaves settings unchanged.
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await expect(handlers.get('settings:set')?.(trustedEvent, payload)).resolves.toBe(current)
    expect(applySettingsPatch).not.toHaveBeenCalled()

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 })
    await handlers.get('settings:set')?.(trustedEvent, payload)
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await handlers.get('settings:save-silent')?.(trustedEvent, payload)
    expect(saveSettingsPatch).not.toHaveBeenCalled()
  })

  it('requires a trusted workbench sender and native confirmation for user approvals', async () => {
    const current = settings()
    current.agents.kun.runtimeToken = 'approval-runtime-secret'
    const mainFrame = { processId: 10, routingId: 20 }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const runtimeRequest = vi.fn(async (
      _path: string,
      _method?: string,
      _body?: string,
      _headers?: Record<string, string>
    ) => ({ ok: true, status: 200, body: '{}' }))
    registerAppIpcHandlers(registerOptions({
      store: { load: vi.fn(async () => current) } as never,
      getMainWindow: () => mainWindow as never,
      runtimeRequest
    }))
    const handler = handlers.get('approval:decide')!
    const payload = { approvalId: 'approval-1', decision: 'allow', source: 'user' }

    await expect(handler({
      sender: { id: 99 },
      senderFrame: { processId: 90, routingId: 91 }
    }, payload)).rejects.toThrow(/trusted workbench frame/)
    expect(runtimeRequest).not.toHaveBeenCalled()

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await expect(handler({ sender: contents, senderFrame: mainFrame }, payload))
      .resolves.toEqual({ confirmed: false })
    expect(runtimeRequest).not.toHaveBeenCalled()

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 })
    await expect(handler({ sender: contents, senderFrame: mainFrame }, payload))
      .resolves.toMatchObject({ confirmed: true, response: { ok: true } })
    const headers = runtimeRequest.mock.calls[0]?.[3] as Record<string, string>
    const consent = headers[KUN_APPROVAL_CONSENT_HEADER]
    expect(consent).toMatch(/^v1\./)
    expect(new ApprovalConsentVerifier('approval-runtime-secret').verifyAndConsume({
      token: consent,
      approvalId: 'approval-1',
      decision: 'allow'
    })).toBe(true)
  })

  it('rejects every UI plugin bridge outside the trusted top-level workbench frame', async () => {
    const mainFrame = { processId: 10, routingId: 20 }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    registerAppIpcHandlers(registerOptions({ getMainWindow: () => mainWindow as never }))
    const untrustedEvent = {
      sender: contents,
      senderFrame: { processId: 10, routingId: 21 }
    }

    for (const [channel, payload] of [
      ['ui-plugin:list', undefined],
      ['ui-plugin:install', undefined],
      ['ui-plugin:remove', { id: 'starlight' }],
      ['ui-plugin:load', { id: 'starlight' }],
      ['ui-plugin:theme:activate', { id: 'starlight' }],
      ['ui-plugin:theme:deactivate', undefined]
    ] as const) {
      await expect(handlers.get(channel)?.(untrustedEvent, payload)).rejects.toThrow(
        /trusted workbench frame/
      )
    }
  })

  it('builds presentation variables in Main before activating the fixed CDP stylesheet', async () => {
    const mainFrame = { processId: 10, routingId: 20 }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    uiPluginMocks.loadUiPluginFigures.mockResolvedValueOnce({
      ok: true,
      manifest: {
        id: 'portrait-theme',
        name: 'Portrait theme',
        version: '1.0.0',
        figures: { portrait: 'img/portrait.png' },
        presentation: {
          character: {
            anchor: 'right',
            size: 'hero',
            offsetX: 4,
            offsetY: -2,
            opacity: 0.93,
            frame: 'crystal',
            motion: 'float',
            contentReserve: 'wide'
          },
          readability: { scrim: 'opposite-character', strength: 'medium' },
          surfaces: {
            sidebar: 'glass',
            topbar: 'translucent',
            composer: 'strong-glass',
            cards: 'glass'
          }
        }
      },
      figures: { portrait: 'data:image/png;base64,AAAA' },
      backgrounds: {},
      sceneAssets: {}
    })
    registerAppIpcHandlers(registerOptions({ getMainWindow: () => mainWindow as never }))

    const response = await handlers.get('ui-plugin:theme:activate')?.(
      { sender: contents, senderFrame: mainFrame },
      { id: 'portrait-theme' }
    )

    expect(response).toMatchObject({
      ok: true,
      manifest: { id: 'portrait-theme' },
      figures: { portrait: 'data:image/png;base64,AAAA' }
    })
    expect(uiPluginMocks.ensureBundledUiPlugins).toHaveBeenCalledOnce()
    expect(uiPluginMocks.activate).toHaveBeenCalledOnce()
    const [pluginId, css] = uiPluginMocks.activate.mock.calls[0] ?? []
    expect(pluginId).toBe('portrait-theme')
    expect(css).toContain("html[data-ui-plugin='portrait-theme']")
    expect(css).toContain('--kun-ui-plugin-character-offset-x: 4%;')
    expect(css).toContain('--kun-ui-plugin-character-offset-y: -2%;')
    expect(css).toContain('--kun-ui-plugin-character-opacity: 0.93;')
    expect(css).not.toContain('crystal')
    expect(css).not.toContain('opposite-character')
  })

  it('returns validated scene assets while CDP receives only host numeric scene variables', async () => {
    const mainFrame = { processId: 10, routingId: 20 }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const presentation = {
      character: {
        anchor: 'right',
        size: 'large',
        offsetX: 0,
        offsetY: 0,
        opacity: 1,
        frame: 'soft-card',
        motion: 'none',
        contentReserve: 'wide'
      },
      readability: { scrim: 'opposite-character', strength: 'medium' },
      surfaces: {
        sidebar: 'glass',
        topbar: 'glass',
        composer: 'strong-glass',
        cards: 'translucent'
      }
    }
    uiPluginMocks.loadUiPluginFigures.mockResolvedValueOnce({
      ok: true,
      manifest: {
        id: 'scene-theme',
        name: 'Scene theme',
        version: '1.0.0',
        figures: { portrait: 'img/portrait.png' },
        presentation,
        scene: {
          apiVersion: '1.6',
          layout: 'rail-left',
          character: {
            scale: 'hero',
            fit: 'contain',
            focalPoint: 'bottom',
            mask: 'arch',
            offsetX: 3,
            offsetY: -2,
            opacity: 0.96,
            flipX: false,
            motion: { preset: 'sway', speed: 'slow', phase: 'b' }
          },
          artwork: {
            frame: {
              path: 'scene/frame.png',
              anchor: 'center',
              size: 'large',
              fit: 'contain',
              offsetX: 1,
              offsetY: -1,
              opacity: 1,
              blend: 'normal',
              motion: { preset: 'none', speed: 'normal', phase: 'a' }
            }
          },
          chrome: {
            sidebar: 'paper',
            topbar: 'editorial',
            composer: 'hologram',
            cards: 'ticket'
          }
        }
      },
      figures: { portrait: 'data:image/png;base64,AAAA' },
      backgrounds: {},
      sceneAssets: { assets: { 'scene/frame.png': 'data:image/png;base64,AQID' } }
    })
    registerAppIpcHandlers(registerOptions({ getMainWindow: () => mainWindow as never }))

    const response = await handlers.get('ui-plugin:theme:activate')?.(
      { sender: contents, senderFrame: mainFrame },
      { id: 'scene-theme' }
    )

    expect(response).toMatchObject({
      ok: true,
      manifest: { id: 'scene-theme', scene: { layout: 'rail-left' } },
      sceneAssets: { assets: { 'scene/frame.png': 'data:image/png;base64,AQID' } }
    })
    const [, css] = uiPluginMocks.activate.mock.calls[0] ?? []
    expect(css).toContain('--kun-ui-plugin-scene-character-offset-x: 3%;')
    expect(css).toContain('--kun-ui-plugin-scene-character-offset-y: -2%;')
    expect(css).toContain('--kun-ui-plugin-scene-frame-offset-x: 1%;')
    expect(css).not.toContain('scene/frame.png')
    expect(css).not.toContain('rail-left')
    expect(css).not.toContain('sway')
  })

  it('accepts checkpoint cleanup settings patches', async () => {
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      checkpointCleanup: {
        intervalDays: 5
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('rejects unsupported checkpoint cleanup intervals', async () => {
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const handler = handlers.get('settings:set')
    await expect(
      handler?.({}, { checkpointCleanup: { intervalDays: 4 } })
    ).rejects.toThrow(/Invalid payload for settings:set/)
    expect(applySettingsPatch).not.toHaveBeenCalled()
  })

  it('accepts telegram phone connection settings patches', async () => {
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      claw: {
        enabled: true,
        im: { enabled: true, workspaceRoot: '' },
        channels: [{
          id: 'telegram_1',
          provider: 'telegram' as const,
          label: 'telegram agent',
          enabled: true,
          model: 'auto',
          threadId: '',
          workspaceRoot: '',
          agentProfile: {
            name: 'telegram agent',
            description: '',
            identity: '',
            personality: '',
            userContext: '',
            replyRules: ''
          },
          platformCredential: {
            kind: 'telegram' as const,
            botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
            allowedChatIds: '123456789',
            botUsername: 'kun_test_bot',
            createdAt: '2026-06-19T00:00:00.000Z'
          },
          conversations: [],
          createdAt: '2026-06-19T00:00:00.000Z',
          updatedAt: '2026-06-19T00:00:00.000Z'
        }]
      }
    }

    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('restarts the managed runtime through the restart IPC handler', async () => {
    const restartRuntime = vi.fn(async () => undefined)

    registerAppIpcHandlers(registerOptions({ restartRuntime }))

    await expect(handlers.get('runtime:restart')?.({})).resolves.toBeUndefined()
    expect(restartRuntime).toHaveBeenCalledTimes(1)
  })

  it('saves generated files to a user-selected path', async () => {
    const { dialog } = await import('electron')
    const temp = mkdtempSync(join(tmpdir(), 'kun-save-as-'))
    const source = join(temp, 'source.png')
    const target = join(temp, 'downloaded.png')
    writeFileSync(source, 'generated-image')
    ;(dialog as unknown as { showSaveDialog: ReturnType<typeof vi.fn> }).showSaveDialog = vi.fn(async () => ({
      canceled: false,
      filePath: target
    }))

    try {
      registerAppIpcHandlers(registerOptions())

      const handler = handlers.get('file:save-as')
      await expect(handler?.({}, {
        sourcePath: source,
        suggestedName: 'source.png',
        mimeType: 'image/png'
      })).resolves.toEqual({ ok: true, path: target })
      expect(readFileSync(target, 'utf8')).toBe('generated-image')
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('opens and reveals only runtime-validated generated artifacts', async () => {
    const mainFrame = { processId: 10, routingId: 20 }
    const mainContents = { id: 1, mainFrame }
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        artifactId: 'artifact_1234567890',
        absolutePath: '/tmp/workspace/exports/final.mp4',
        displayName: 'final.mp4',
        mimeType: 'video/mp4'
      })
    }))
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => ({
        isDestroyed: () => false,
        webContents: mainContents
      }) as never,
      runtimeRequest
    }))
    const handler = handlers.get('extension:artifact:open')!
    const payload = {
      artifactId: 'artifact_1234567890',
      ownerExtensionId: 'kun.video-editor',
      ownerExtensionVersion: '1.1.0',
      workspaceId: 'a'.repeat(64),
      workspaceRoot: '/tmp/workspace',
      action: 'open'
    }
    await expect(handler({ sender: mainContents, senderFrame: mainFrame }, payload))
      .resolves.toEqual({ ok: true })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/media/artifacts/resolve',
      'POST',
      JSON.stringify({
        artifactId: payload.artifactId,
        ownerExtensionId: payload.ownerExtensionId,
        ownerExtensionVersion: payload.ownerExtensionVersion,
        workspaceId: payload.workspaceId,
        workspaceRoot: payload.workspaceRoot
      })
    )
    expect(electronMock.openPath).toHaveBeenCalledWith('/tmp/workspace/exports/final.mp4')

    await expect(handler(
      { sender: mainContents, senderFrame: mainFrame },
      { ...payload, action: 'reveal' }
    )).resolves.toEqual({ ok: true })
    expect(electronMock.showItemInFolder).toHaveBeenCalledWith('/tmp/workspace/exports/final.mp4')
    await expect(handler(
      { sender: { id: 99 }, senderFrame: { processId: 99, routingId: 99 } },
      payload
    )).rejects.toThrow(/trusted workbench frame/)
  })

  it('keeps workspace watches alive across atomic replacements and releases the sender listener', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'kun-watch-atomic-'))
    const target = join(temp, 'motion.svg')
    writeFileSync(target, '<svg id="one"/>')
    const sender = Object.assign(new EventEmitter(), {
      id: 73,
      send: vi.fn(),
      isDestroyed: () => false
    })

    try {
      registerAppIpcHandlers(registerOptions())
      const watchHandler = handlers.get('file:watch-workspace')
      const unwatchHandler = handlers.get('file:unwatch-workspace')
      const result = await watchHandler?.({ sender }, { path: 'motion.svg', workspaceRoot: temp }) as {
        ok: boolean
        watchId?: string
      }
      expect(result.ok).toBe(true)
      expect(result.watchId).toBeTruthy()
      expect(sender.listenerCount('destroyed')).toBe(1)
      writeFileSync(join(temp, 'other.svg'), '<svg/>')
      const secondResult = await watchHandler?.({ sender }, { path: 'other.svg', workspaceRoot: temp }) as {
        ok: boolean
        watchId?: string
      }
      expect(secondResult.ok).toBe(true)
      expect(sender.listenerCount('destroyed')).toBe(1)

      const replace = (source: string, content: string): void => {
        const staged = join(temp, source)
        writeFileSync(staged, content)
        renameSync(staged, target)
      }
      replace('.motion-first.tmp', '<svg id="two"/>')
      await vi.waitFor(() => {
        expect(sender.send).toHaveBeenCalledWith(
          'file:workspace-changed',
          expect.objectContaining({ ok: true, content: '<svg id="two"/>' })
        )
      }, { timeout: 2_000 })

      replace('.motion-second.tmp', '<svg id="three"/>')
      await vi.waitFor(() => {
        expect(sender.send).toHaveBeenCalledWith(
          'file:workspace-changed',
          expect.objectContaining({ ok: true, content: '<svg id="three"/>' })
        )
      }, { timeout: 2_000 })

      await expect(unwatchHandler?.({}, result.watchId)).resolves.toBe(true)
      expect(sender.listenerCount('destroyed')).toBe(1)
      await expect(unwatchHandler?.({}, secondResult.watchId)).resolves.toBe(true)
      expect(sender.listenerCount('destroyed')).toBe(0)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('accepts the full settings snapshot emitted by SettingsView auto-apply', async () => {
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = { ...settings(), locale: 'zh' as const }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    const { projectConfig: _projectConfig, ...safeKun } = payload.agents.kun
    void _projectConfig
    expect(applySettingsPatch).toHaveBeenCalledWith({
      ...payload,
      agents: { kun: safeKun }
    })
  })

  it('passes schedule settings patches through to applySettingsPatch', async () => {
    const applySettingsPatch = vi.fn(async (partial: AppSettingsPatch) => ({
      ...settings(),
      schedule: mergeScheduleSettings(settings().schedule, partial.schedule)
    }))

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      schedule: {
        enabled: true,
        keepAwake: true,
        tasks: [{
          id: 'task-1',
          title: 'Daily',
          enabled: true,
          prompt: 'Run',
          schedule: { kind: 'manual' as const }
        }]
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toMatchObject({
      schedule: {
        enabled: true,
        keepAwake: true,
        tasks: [{ id: 'task-1', prompt: 'Run' }]
      }
    })
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('writes MCP config JSON and notifies the runtime apply hook', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'deepseek-gui-ipc-'))
    const configPath = join(tempRoot, 'mcp.json')
    const onKunMcpConfigWritten = vi.fn(async () => undefined)
    const content = `${JSON.stringify({
      servers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project']
        }
      }
    }, null, 2)}\n`

    try {
      registerAppIpcHandlers(registerOptions({
        resolveKunConfigPath: () => configPath,
        onKunMcpConfigWritten
      }))

      await expect(handlers.get('kun:config:write')?.({}, content)).resolves.toEqual({
        ok: true,
        path: configPath
      })
      expect(readFileSync(configPath, 'utf8')).toBe(content)
      expect(onKunMcpConfigWritten).toHaveBeenCalledWith(configPath, content)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects invalid MCP config JSON before writing or applying it', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'deepseek-gui-ipc-'))
    const configPath = join(tempRoot, 'mcp.json')
    const onKunMcpConfigWritten = vi.fn(async () => undefined)

    try {
      registerAppIpcHandlers(registerOptions({
        resolveKunConfigPath: () => configPath,
        onKunMcpConfigWritten
      }))

      await expect(handlers.get('kun:config:write')?.({}, '{')).rejects.toThrow(
        /MCP config must be JSON/
      )
      await expect(handlers.get('kun:config:write')?.({}, '[]')).rejects.toThrow(
        /MCP config must be a JSON object/
      )
      expect(existsSync(configPath)).toBe(false)
      expect(onKunMcpConfigWritten).not.toHaveBeenCalled()
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('writes and reads project config without implicitly granting MCP trust', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'kun-project-config-ipc-'))
    const workspace = join(tempRoot, 'workspace')
    const onKunProjectConfigChanged = vi.fn(async () => undefined)
    const content = JSON.stringify({
      version: 1,
      mcp: { servers: { local: { transport: 'stdio', command: 'node' } } }
    }, null, 2)
    try {
      await import('node:fs/promises').then(({ mkdir }) => mkdir(workspace))
      registerAppIpcHandlers(registerOptions({ onKunProjectConfigChanged }))

      const written = await handlers.get('kun:project-config:write')?.({}, {
        workspaceRoot: workspace,
        content
      }) as Record<string, unknown>

      expect(written).toMatchObject({
        status: 'valid',
        trust: 'untrusted',
        content,
        exists: true
      })
      expect(onKunProjectConfigChanged).toHaveBeenCalledWith(
        expect.stringContaining('/workspace/.kun/project.json'),
        content
      )
      await expect(handlers.get('kun:project-config:read')?.({}, { workspaceRoot: workspace }))
        .resolves.toMatchObject({ status: 'valid', trust: 'untrusted', content })
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('persists and revokes only the current validated project config digest', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'kun-project-trust-ipc-'))
    const workspace = join(tempRoot, 'workspace')
    let current = settings()
    const store = { load: vi.fn(async () => current) }
    const applySettingsPatch = vi.fn(async (patch: AppSettingsPatch) => {
      current = {
        ...current,
        agents: {
          kun: mergeKunRuntimeSettings(current.agents.kun, patch.agents?.kun)
        }
      }
      return current
    })
    try {
      await import('node:fs/promises').then(({ mkdir }) => mkdir(workspace))
      registerAppIpcHandlers(registerOptions({ store: store as never, applySettingsPatch }))
      await handlers.get('kun:project-config:write')?.({}, {
        workspaceRoot: workspace,
        content: JSON.stringify({
          version: 1,
          mcp: { servers: { local: { transport: 'stdio', command: 'node' } } }
        })
      })

      const reviewed = await handlers.get('kun:project-config:read')?.({}, {
        workspaceRoot: workspace
      }) as { digest: string }
      writeFileSync(join(workspace, '.kun', 'project.json'), JSON.stringify({
        version: 1,
        mcp: { servers: { raced: { transport: 'stdio', command: 'node' } } }
      }))
      await expect(handlers.get('kun:project-config:trust')?.({}, {
        workspaceRoot: workspace,
        trusted: true,
        expectedDigest: reviewed.digest
      })).rejects.toThrow(/changed after confirmation/)
      expect(current.agents.kun.projectConfig.grants).toEqual([])

      let currentReview = await handlers.get('kun:project-config:read')?.({}, {
        workspaceRoot: workspace
      }) as { digest: string }
      electronMock.showMessageBox.mockImplementationOnce(async () => {
        writeFileSync(join(workspace, '.kun', 'project.json'), JSON.stringify({
          version: 1,
          mcp: { servers: { duringConfirm: { transport: 'stdio', command: 'node' } } }
        }))
        return { response: 0 }
      })
      await expect(handlers.get('kun:project-config:trust')?.({}, {
        workspaceRoot: workspace,
        trusted: true,
        expectedDigest: currentReview.digest
      })).rejects.toThrow(/changed during confirmation/)
      expect(current.agents.kun.projectConfig.grants).toEqual([])

      currentReview = await handlers.get('kun:project-config:read')?.({}, {
        workspaceRoot: workspace
      }) as { digest: string }
      electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })
      await expect(handlers.get('kun:project-config:trust')?.({}, {
        workspaceRoot: workspace,
        trusted: true,
        expectedDigest: currentReview.digest
      })).resolves.toMatchObject({ status: 'valid', trust: 'untrusted' })
      expect(current.agents.kun.projectConfig.grants).toEqual([])

      electronMock.showMessageBox.mockResolvedValue({ response: 0 })
      await expect(handlers.get('kun:project-config:trust')?.({}, {
        workspaceRoot: workspace,
        trusted: true,
        expectedDigest: currentReview.digest
      })).resolves.toMatchObject({ status: 'valid', trust: 'trusted' })
      expect(electronMock.showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({
        title: 'Approve project MCP',
        detail: expect.stringContaining(`SHA-256: ${currentReview.digest}`),
        defaultId: 1,
        cancelId: 1
      }))
      expect(current.agents.kun.projectConfig.grants).toEqual([
        expect.objectContaining({ workspaceRoot: expect.stringContaining('/workspace') })
      ])

      writeFileSync(join(workspace, '.kun', 'project.json'), JSON.stringify({
        version: 1,
        mcp: { servers: { changed: { transport: 'stdio', command: 'node' } } }
      }))
      await expect(handlers.get('kun:project-config:read')?.({}, { workspaceRoot: workspace }))
        .resolves.toMatchObject({ status: 'valid', trust: 'stale' })

      await expect(handlers.get('kun:project-config:trust')?.({}, {
        workspaceRoot: workspace,
        trusted: false
      })).resolves.toMatchObject({ status: 'valid', trust: 'untrusted' })
      expect(current.agents.kun.projectConfig.grants).toEqual([])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects invalid project config payloads and unsafe content without callbacks', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'kun-project-invalid-ipc-'))
    const workspace = join(tempRoot, 'workspace')
    const onKunProjectConfigChanged = vi.fn()
    try {
      await import('node:fs/promises').then(({ mkdir }) => mkdir(workspace))
      registerAppIpcHandlers(registerOptions({ onKunProjectConfigChanged }))

      await expect(handlers.get('kun:project-config:read')?.({}, { workspaceRoot: 'relative' }))
        .rejects.toThrow(/absolute path/)
      await expect(handlers.get('kun:project-config:write')?.({}, {
        workspaceRoot: workspace,
        content: JSON.stringify({ version: 1, skills: { roots: ['../escape'] } })
      })).rejects.toThrow(/escapes the workspace/)
      expect(onKunProjectConfigChanged).not.toHaveBeenCalled()
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('uses the GUI-managed WeChat bridge for WeChat install handlers', async () => {
    const configuredSettings = settings()
    configuredSettings.claw.im.weixinBridgeUrl = 'http://127.0.0.1:18787/rpc'
    const store = { load: vi.fn(async () => configuredSettings) }
    const startWeixinInstallQrcode = vi.fn(async () => ({
      ok: false as const,
      message: 'expected test response'
    }))
    const pollWeixinInstall = vi.fn(async () => ({ done: false as const }))

    registerAppIpcHandlers(registerOptions({
      store: store as never,
      startWeixinInstallQrcode,
      pollWeixinInstall
    }))

    await expect(
      handlers.get('claw:im-install:qrcode')?.({}, { provider: 'weixin' })
    ).resolves.toMatchObject({ ok: false })
    await expect(
      handlers.get('claw:im-install:poll')?.({}, { provider: 'weixin', deviceCode: 'device-1' })
    ).resolves.toEqual({ done: false })

    expect(startWeixinInstallQrcode).toHaveBeenCalledWith()
    expect(pollWeixinInstall).toHaveBeenCalledWith('device-1')
  })

  it('routes schedule task IPC calls to the Schedule runtime', async () => {
    const scheduleRuntime = {
      status: vi.fn(async () => ({
        internalServerRunning: true,
        internalUrl: 'http://127.0.0.1:18788',
        runningTaskIds: ['task-1'],
        powerSaveBlockerActive: true
      })),
      runTask: vi.fn(async (taskId: string) => ({ ok: true as const, taskId, message: 'Started' })),
      createScheduledTaskFromText: vi.fn(async () => ({
        kind: 'created' as const,
        taskId: 'task-2',
        title: 'Reminder',
        scheduleAt: '2026-06-03T09:00:00.000+08:00',
        confirmationText: 'Scheduled.'
      }))
    }
    registerAppIpcHandlers(registerOptions({
      getScheduleRuntime: () => scheduleRuntime as never
    }))

    await expect(handlers.get('schedule:status')?.({})).resolves.toMatchObject({
      internalServerRunning: true,
      runningTaskIds: ['task-1'],
      powerSaveBlockerActive: true
    })
    await expect(handlers.get('schedule:task:run')?.({}, 'task-1')).resolves.toMatchObject({
      ok: true,
      taskId: 'task-1'
    })
    await expect(
      handlers.get('schedule:task:create-from-text')?.({}, {
        text: 'Remind me tomorrow.',
        workspaceRoot: '/tmp/schedule',
        clawChannelId: 'channel-1',
        modelHint: 'deepseek-v4-flash',
        mode: 'plan'
      })
    ).resolves.toMatchObject({
      kind: 'created',
      taskId: 'task-2'
    })

    expect(scheduleRuntime.runTask).toHaveBeenCalledWith('task-1')
    expect(scheduleRuntime.createScheduledTaskFromText).toHaveBeenCalledWith('Remind me tomorrow.', {
      workspaceRoot: '/tmp/schedule',
      clawChannelId: 'channel-1',
      modelHint: 'deepseek-v4-flash',
      mode: 'plan'
    })
  })

  it('routes desktop command IPC calls to the focused window and web contents', async () => {
    const webContents = {
      undo: vi.fn(),
      redo: vi.fn(),
      cut: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
      reload: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
      setZoomLevel: vi.fn(),
      toggleDevTools: vi.fn()
    }
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents,
      minimize: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      close: vi.fn()
    }

    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never
    }))

    const handler = handlers.get('desktop:command')
    await handler?.({ sender: webContents }, 'copy')
    await handler?.({ sender: webContents }, 'zoomIn')
    await handler?.({ sender: webContents }, 'toggleMaximize')
    await handler?.({ sender: webContents }, 'close')

    expect(webContents.copy).toHaveBeenCalledTimes(1)
    expect(webContents.setZoomLevel).toHaveBeenCalledWith(1)
    expect(mainWindow.maximize).toHaveBeenCalledTimes(1)
    expect(mainWindow.close).toHaveBeenCalledTimes(1)
  })

  it('creates a unique conversation workspace, suffixing on timestamp collision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-conv-'))
    try {
      registerAppIpcHandlers(registerOptions({
        store: { load: vi.fn(async () => ({ ...settings(), conversationWorkspaceRoot: root })) } as never
      }))

      const handler = handlers.get('conversation:create-workspace')
      expect(handler).toBeTypeOf('function')

      const first = await handler?.({}) as { ok: boolean; path: string }
      const second = await handler?.({}) as { ok: boolean; path: string }

      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      // 两次创建即使落在同一秒,目录路径也必须不同,否则会静默共用目录。
      expect(first.path).not.toBe(second.path)
      expect(existsSync(first.path)).toBe(true)
      expect(existsSync(second.path)).toBe(true)
      expect(first.path.startsWith(root)).toBe(true)
      expect(second.path.startsWith(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not create a missing custom conversation workspace root', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'kun-conv-missing-'))
    const root = join(parent, 'custom-root')
    try {
      registerAppIpcHandlers(registerOptions({
        store: { load: vi.fn(async () => ({ ...settings(), conversationWorkspaceRoot: root })) } as never
      }))

      const handler = handlers.get('conversation:create-workspace')
      const result = await handler?.({}) as { ok: boolean; path: string; error?: string }

      expect(result.ok).toBe(false)
      expect(result.path).toBe('')
      expect(existsSync(root)).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
