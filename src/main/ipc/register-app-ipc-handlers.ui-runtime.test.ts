import {
  cleanupAppIpcHandlerTestState,
  getAppIpcElectronMock,
  getTelegramMocks,
  getUiPluginMocks,
  handlers,
  registerOptions,
  resetAppIpcHandlerTestState,
  settings
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
  registerAppIpcHandlers
} from './register-app-ipc-handlers'

vi.mock('../main-window', () => ({
  trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html'
}))

const electronMock = getAppIpcElectronMock()
const telegramMocks = getTelegramMocks()
const uiPluginMocks = getUiPluginMocks()

describe('registerAppIpcHandlers UI plugins and runtime', () => {
  beforeEach(resetAppIpcHandlerTestState)
  afterEach(cleanupAppIpcHandlerTestState)

  it('rejects every UI plugin bridge outside the trusted top-level workbench frame', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    registerAppIpcHandlers(registerOptions({ getMainWindow: () => mainWindow as never }))
    const untrustedEvent = {
      sender: contents,
      senderFrame: { processId: 10, routingId: 21, url: 'http://127.0.0.1:5173/index.html' }
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
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
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
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
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
            proxy: { enabled: true, url: 'socks5://127.0.0.1:1080' },
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

  it('passes Telegram proxy settings through the token verification IPC boundary', async () => {
    registerAppIpcHandlers(registerOptions())
    const payload = {
      botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
      allowedChatIds: '123456789',
      proxy: { enabled: true, url: 'socks5://user:pass@127.0.0.1:1080' }
    }

    await expect(handlers.get('claw:im-install:telegram-token')?.({}, payload)).resolves.toMatchObject({
      ok: true,
      botUsername: 'kun_test_bot'
    })
    expect(telegramMocks.verifyTelegramBotToken).toHaveBeenCalledWith(payload.botToken, payload.proxy)
  })

  it('rejects oversized Telegram proxy URLs before token verification', async () => {
    registerAppIpcHandlers(registerOptions())

    await expect(handlers.get('claw:im-install:telegram-token')?.({}, {
      botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
      proxy: { enabled: true, url: `socks5://${'a'.repeat(5_000)}` }
    })).rejects.toThrow(/Invalid payload for claw:im-install:telegram-token/)
    expect(telegramMocks.verifyTelegramBotToken).not.toHaveBeenCalled()
  })

  it('restarts the managed runtime through the restart IPC handler', async () => {
    const restartRuntime = vi.fn(async () => undefined)
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }

    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      restartRuntime
    }))

    await expect(handlers.get('runtime:restart')?.({
      sender: contents,
      senderFrame: mainFrame
    })).resolves.toBeUndefined()
    expect(restartRuntime).toHaveBeenCalledTimes(1)
  })

  it('restarts all current-user Kun serves only after trusted confirmation', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const restartKunServe = vi.fn(async () => undefined)
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      restartKunServe
    }))
    const handler = handlers.get('runtime:restart-serve')

    await expect(handler?.({
      sender: contents,
      senderFrame: { processId: 10, routingId: 21, url: 'http://127.0.0.1:5173/index.html' }
    })).rejects.toThrow(/trusted workbench frame/)

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await expect(handler?.({ sender: contents, senderFrame: mainFrame })).resolves.toEqual({
      accepted: false
    })
    expect(restartKunServe).not.toHaveBeenCalled()

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 })
    await expect(handler?.({ sender: contents, senderFrame: mainFrame })).resolves.toEqual({
      accepted: true
    })
    expect(restartKunServe).toHaveBeenCalledOnce()
    expect(electronMock.showMessageBox).toHaveBeenLastCalledWith(
      mainWindow,
      expect.objectContaining({
        type: 'warning',
        title: 'Restart all Kun services',
        message: 'Stop all Kun service processes owned by the current user and start a new service?',
        buttons: ['Restart all services', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        detail: expect.stringMatching(
          /old ports or data directories[\s\S]*Running Agent tasks, tool calls, background work, and pending approvals may be interrupted[\s\S]*Workspace changes already in progress will remain and may be incomplete[\s\S]*Saved sessions and conversations, memory, archives, settings, logs, and workspace files will not be deleted[\s\S]*No automatic backup is created[\s\S]*desktop app and Kun Service Manager are not cleared/u
        )
      })
    )
  })

  it('explains the complete restart scope in Chinese before invoking restart', async () => {
    electronMock.appLocale = 'zh-CN'
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const restartKunServe = vi.fn(async () => undefined)
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      restartKunServe
    }))
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })

    await expect(handlers.get('runtime:restart-serve')?.({
      sender: contents,
      senderFrame: mainFrame
    })).resolves.toEqual({ accepted: false })

    expect(restartKunServe).not.toHaveBeenCalled()
    expect(electronMock.showMessageBox).toHaveBeenCalledWith(
      mainWindow,
      expect.objectContaining({
        type: 'warning',
        title: '重启所有 Kun 服务',
        message: '停止当前用户的所有 Kun 服务进程并启动新服务？',
        buttons: ['重启所有服务', '取消'],
        defaultId: 1,
        cancelId: 1,
        detail: expect.stringMatching(
          /旧端口、旧数据目录[\s\S]*Agent 任务、工具调用、后台任务和待审批操作可能中断[\s\S]*工作区修改会原样保留，可能处于未完成状态[\s\S]*会话和对话记录、记忆、归档、设置、日志及工作区文件不会被删除[\s\S]*不会自动创建备份[\s\S]*桌面应用和 Kun Service Manager 不会被清理/u
        )
      })
    )
  })

  it.each([
    {
      locale: 'en-US',
      title: 'Kun restart failed',
      message: 'Kun could not stop every service and finish restarting.',
      detail: 'Some services may already have stopped. Saved data was not deleted; check the logs and retry.',
      error: 'Restart failed. Check the logs and retry.'
    },
    {
      locale: 'zh-CN',
      title: 'Kun 重启失败',
      message: '未能停止全部 Kun 服务并完成重启。',
      detail: '部分服务可能已经停止。已保存的数据未被删除；请查看日志后重试。',
      error: '重启失败，请查看日志后重试。'
    }
  ])('reports partial service shutdown without implying data deletion in $locale', async ({
    locale,
    title,
    message,
    detail,
    error
  }) => {
    electronMock.appLocale = locale
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const restartKunServe = vi.fn(async () => {
      throw new Error('cleanup failed')
    })
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      restartKunServe
    }))
    electronMock.showMessageBox
      .mockResolvedValueOnce({ response: 0 })
      .mockResolvedValueOnce({ response: 0 })

    await expect(handlers.get('runtime:restart-serve')?.({
      sender: contents,
      senderFrame: mainFrame
    })).resolves.toEqual({ accepted: true, error })

    expect(restartKunServe).toHaveBeenCalledOnce()
    expect(electronMock.showMessageBox).toHaveBeenNthCalledWith(
      2,
      mainWindow,
      expect.objectContaining({ type: 'error', title, message, detail })
    )
  })

  it('restarts Kun after an already-downloaded Claude SDK is provisioned through IPC', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'kun-agent-sdk-ipc-'))
    const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'
    const binaryPath = join(userDataDir, 'agent-sdk', binaryName)
    const restartKunServe = vi.fn(async () => undefined)
    electronMock.userDataPath = userDataDir
    mkdirSync(join(userDataDir, 'agent-sdk'), { recursive: true })
    writeFileSync(binaryPath, 'claude binary')

    try {
      registerAppIpcHandlers(registerOptions({ restartKunServe }))

      await expect(handlers.get('claude-subscription:sdk-install')?.({})).resolves.toMatchObject({
        status: 'restarting'
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(restartKunServe).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  it('returns the current Runtime settings synchronization status', async () => {
    registerAppIpcHandlers(registerOptions({
      getRuntimeSettingsSyncStatus: () => ({
        state: 'failed',
        generation: 7,
        message: 'hot apply failed',
        at: '2026-07-22T08:00:00.000Z'
      })
    }))

    expect(handlers.get('runtime:settings-sync-status:get')?.({})).toEqual({
      state: 'failed',
      generation: 7,
      message: 'hot apply failed',
      at: '2026-07-22T08:00:00.000Z'
    })
  })

})
