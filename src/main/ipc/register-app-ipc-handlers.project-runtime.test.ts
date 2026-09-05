import {
  cleanupAppIpcHandlerTestState,
  getAppIpcElectronMock,
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
  existsSync,
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
  mergeKunRuntimeSettings,
  type AppSettingsPatch
} from '../../shared/app-settings'
import {
  registerAppIpcHandlers
} from './register-app-ipc-handlers'

vi.mock('../main-window', () => ({
  trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html'
}))

const electronMock = getAppIpcElectronMock()

describe('registerAppIpcHandlers project config and runtime routing', () => {
  beforeEach(resetAppIpcHandlerTestState)
  afterEach(cleanupAppIpcHandlerTestState)

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
      const canonicalWorkspace = realpathSync.native(workspace)
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
        join(canonicalWorkspace, '.kun', 'project.json'),
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
      const canonicalWorkspace = realpathSync.native(workspace)
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
        expect.objectContaining({ workspaceRoot: canonicalWorkspace })
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

  it('creates a missing custom conversation workspace root when creating a conversation', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'kun-conv-missing-'))
    const root = join(parent, 'custom-root', 'nested-root')
    try {
      registerAppIpcHandlers(registerOptions({
        store: { load: vi.fn(async () => ({ ...settings(), conversationWorkspaceRoot: root })) } as never
      }))

      const handler = handlers.get('conversation:create-workspace')
      const result = await handler?.({}) as { ok: boolean; path: string; error?: string }

      expect(result.ok).toBe(true)
      expect(result.path.startsWith(root)).toBe(true)
      expect(existsSync(root)).toBe(true)
      expect(existsSync(result.path)).toBe(true)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
