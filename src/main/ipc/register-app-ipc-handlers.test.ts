import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  type AppSettingsPatch,
  type AppSettingsV1
} from '../../shared/app-settings'
import { registerAppIpcHandlers } from './register-app-ipc-handlers'
import {
  ApprovalConsentVerifier,
  KUN_APPROVAL_CONSENT_HEADER
} from '../../../kun/src/server/approval-consent.js'

const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()
const electronMock = vi.hoisted(() => ({ showMessageBox: vi.fn() }))
const uiPluginMock = vi.hoisted(() => ({
  ensureBundledUiPlugins: vi.fn(async () => undefined),
  loadBundledShuimoYijingRuntime: vi.fn(),
  loadUiPluginFigures: vi.fn(),
  resolveBundledUiPluginHostEffect: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    quit: vi.fn()
  },
  dialog: { showMessageBox: electronMock.showMessageBox },
  shell: {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../services/ui-plugin-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/ui-plugin-service')>()),
  loadUiPluginFigures: uiPluginMock.loadUiPluginFigures
}))

vi.mock('../ui-plugin-bundled', () => ({
  ensureBundledUiPlugins: uiPluginMock.ensureBundledUiPlugins,
  loadBundledShuimoYijingRuntime: uiPluginMock.loadBundledShuimoYijingRuntime
}))

vi.mock('../services/shuimo-yijing-host-effect', () => ({
  resolveBundledUiPluginHostEffect: uiPluginMock.resolveBundledUiPluginHostEffect
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
    uiPluginMock.ensureBundledUiPlugins.mockClear()
    uiPluginMock.loadBundledShuimoYijingRuntime.mockReset()
    uiPluginMock.loadUiPluginFigures.mockReset()
    uiPluginMock.resolveBundledUiPluginHostEffect.mockReset()
  })

  it('loads the trusted bundled runtime before enriching the reserved plugin id', async () => {
    const effect = {
      kind: 'shuimo-yijing' as const,
      hexagram: {
        ordinal: 10,
        glyph: '䷉',
        name: '履',
        statement: '履虎尾不咥人亨',
        statementCommentary: '本义',
        movingLine: 4,
        movingLineLabel: '九四',
        movingLineText: '履虎尾愔愔終吉',
        movingLineCommentary: '本义爻注'
      }
    }
    uiPluginMock.loadUiPluginFigures.mockImplementation(async (_home: string, id: string) => ({
      ok: true,
      manifest: { id, name: id === 'shuimo-yijing' ? 'Impostor' : id, version: '9.9.9', figures: {} },
      figures: {}
    }))
    const trustedRuntime = {
      ok: true as const,
      manifest: {
        id: 'shuimo-yijing',
        name: 'Water Ink Yijing',
        version: '1.0.0',
        figures: { swim: 'img/shuimo-yijing-kun.png' }
      },
      figures: { swim: 'data:image/png;base64,trusted' }
    }
    uiPluginMock.loadBundledShuimoYijingRuntime.mockResolvedValue(trustedRuntime)
    uiPluginMock.resolveBundledUiPluginHostEffect.mockImplementation((id: string) =>
      id === 'shuimo-yijing' ? effect : undefined
    )
    registerAppIpcHandlers(registerOptions())

    const handler = handlers.get('ui-plugin:load')
    await expect(handler?.({}, { id: 'starlight' })).resolves.toEqual({
      ok: true,
      manifest: { id: 'starlight', name: 'starlight', version: '9.9.9', figures: {} },
      figures: {}
    })
    await expect(handler?.({}, { id: 'shuimo-yijing' })).resolves.toEqual({
      ...trustedRuntime,
      hostEffect: effect
    })
    expect(uiPluginMock.loadBundledShuimoYijingRuntime).toHaveBeenCalledTimes(1)
  })

  it('returns a generic UI plugin load failure unchanged without resolving an effect', async () => {
    const failure = { ok: false as const, error: 'plugin unavailable' }
    uiPluginMock.loadUiPluginFigures.mockResolvedValue(failure)
    registerAppIpcHandlers(registerOptions())

    const result = await handlers.get('ui-plugin:load')?.({}, { id: 'shuimo-yijing' })

    expect(result).toBe(failure)
    expect(result).toEqual({ ok: false, error: 'plugin unavailable' })
    expect(uiPluginMock.resolveBundledUiPluginHostEffect).not.toHaveBeenCalled()
  })

  it('keeps generic load success when trusted effect resolution fails and logs no private context', async () => {
    const loaded = {
      ok: true as const,
      manifest: {
        id: 'shuimo-yijing',
        name: 'shuimo-yijing',
        version: '1.0.0',
        figures: {}
      },
      figures: {}
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    uiPluginMock.loadUiPluginFigures.mockResolvedValue(loaded)
    uiPluginMock.loadBundledShuimoYijingRuntime.mockResolvedValue(loaded)
    uiPluginMock.resolveBundledUiPluginHostEffect.mockImplementation(() => {
      throw new Error('launch 2026-07-16T08:09:10.000Z at C:\\Users\\private\\.kun')
    })
    registerAppIpcHandlers(registerOptions())

    try {
      await expect(
        handlers.get('ui-plugin:load')?.({}, { id: 'shuimo-yijing' })
      ).resolves.toBe(loaded)
      expect(warn).toHaveBeenCalledWith('[ui-plugin] shuimo yijing host effect unavailable')
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/2026-07-16|Users|\.kun/)
    } finally {
      warn.mockRestore()
    }
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
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
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
})
