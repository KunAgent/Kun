import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from './runtime-client'

function settings(apiKey: string): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        apiKey
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
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
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

function deferredValue<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('rendererRuntimeClient', () => {
  it('returns the same in-flight settings promise to concurrent callers', async () => {
    const pending = deferredValue<AppSettingsV1>()
    const getSettings = vi.fn(() => pending.promise)
    vi.stubGlobal('window', { kunGui: { getSettings } })

    const first = rendererRuntimeClient.getSettings()
    const second = rendererRuntimeClient.getSettings()

    expect(second).toBe(first)
    expect(getSettings).toHaveBeenCalledTimes(1)
    pending.resolve(settings('sk-shared'))
    await expect(first).resolves.toMatchObject({ agents: { kun: { apiKey: 'sk-shared' } } })
  })

  it('retries settings after a shared in-flight read rejects', async () => {
    const pending = deferredValue<AppSettingsV1>()
    const getSettings = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(settings('sk-retried'))
    vi.stubGlobal('window', { kunGui: { getSettings } })

    const first = rendererRuntimeClient.getSettings()
    const shared = rendererRuntimeClient.getSettings()
    pending.reject(new Error('settings unavailable'))

    await expect(first).rejects.toThrow('settings unavailable')
    await expect(shared).rejects.toThrow('settings unavailable')
    await expect(rendererRuntimeClient.getSettings()).resolves.toMatchObject({
      agents: { kun: { apiKey: 'sk-retried' } }
    })
    expect(getSettings).toHaveBeenCalledTimes(2)
  })

  it('does not let an older request clear or overwrite a forced refresh', async () => {
    const first = deferredValue<AppSettingsV1>()
    const second = deferredValue<AppSettingsV1>()
    const getSettings = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    vi.stubGlobal('window', { kunGui: { getSettings } })

    const older = rendererRuntimeClient.getSettings()
    const newer = rendererRuntimeClient.getSettings({ forceRefresh: true })
    first.resolve(settings('sk-old'))
    await expect(older).resolves.toMatchObject({ agents: { kun: { apiKey: 'sk-old' } } })

    expect(rendererRuntimeClient.getSettings()).toBe(newer)
    second.resolve(settings('sk-new'))
    await expect(newer).resolves.toMatchObject({ agents: { kun: { apiKey: 'sk-new' } } })
    await expect(rendererRuntimeClient.getSettings()).resolves.toMatchObject({
      agents: { kun: { apiKey: 'sk-new' } }
    })
    expect(getSettings).toHaveBeenCalledTimes(2)
  })

  it('caches settings reads until invalidated', async () => {
    const getSettings = vi.fn(async () => settings('sk-1'))
    vi.stubGlobal('window', {
      kunGui: {
        getSettings,
        setSettings: vi.fn(),
        runtimeRequest: vi.fn(),
        restartRuntime: vi.fn(),
        startSse: vi.fn(),
        stopSse: vi.fn(),
        onSseOpen: vi.fn(),
        onSseEvent: vi.fn(),
        onSseEnd: vi.fn(),
        onSseError: vi.fn()
      }
    })

    const first = await rendererRuntimeClient.getSettings()
    const second = await rendererRuntimeClient.getSettings()

    expect(first.agents.kun.apiKey).toBe('sk-1')
    expect(second.agents.kun.apiKey).toBe('sk-1')
    expect(getSettings).toHaveBeenCalledTimes(1)
  })

  it('refreshes the cache after setSettings', async () => {
    const getSettings = vi.fn(async () => settings('sk-1'))
    const setSettings = vi.fn(async () => settings('sk-2'))
    vi.stubGlobal('window', {
      kunGui: {
        getSettings,
        setSettings,
        runtimeRequest: vi.fn(),
        restartRuntime: vi.fn(),
        startSse: vi.fn(),
        stopSse: vi.fn(),
        onSseOpen: vi.fn(),
        onSseEvent: vi.fn(),
        onSseEnd: vi.fn(),
        onSseError: vi.fn()
      }
    })

    await rendererRuntimeClient.getSettings()
    const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '/tmp/next' })
    const cached = await rendererRuntimeClient.getSettings()

    expect(next.agents.kun.apiKey).toBe('sk-2')
    expect(cached.agents.kun.apiKey).toBe('sk-2')
    expect(getSettings).toHaveBeenCalledTimes(1)
    expect(setSettings).toHaveBeenCalledTimes(1)
  })

  it('invalidates cached settings after encrypted credentials are reset', async () => {
    const getSettings = vi.fn()
      .mockResolvedValueOnce(settings(''))
      .mockResolvedValueOnce(settings('sk-after-reset'))
    const resetUnreadableCredentials = vi.fn(async () => ({
      reset: true as const,
      backupPath: '/tmp/credential-recovery',
      movedItems: ['secret.key']
    }))
    vi.stubGlobal('window', {
      kunGui: {
        getSettings,
        setSettings: vi.fn(),
        resetUnreadableCredentials,
        runtimeRequest: vi.fn(),
        restartRuntime: vi.fn(),
        startSse: vi.fn(),
        stopSse: vi.fn(),
        onSseOpen: vi.fn(),
        onSseEvent: vi.fn(),
        onSseEnd: vi.fn(),
        onSseError: vi.fn()
      }
    })

    await rendererRuntimeClient.getSettings()
    await expect(rendererRuntimeClient.resetUnreadableCredentials()).resolves.toMatchObject({ reset: true })
    const refreshed = await rendererRuntimeClient.getSettings()

    expect(refreshed.agents.kun.apiKey).toBe('sk-after-reset')
    expect(getSettings).toHaveBeenCalledTimes(2)
  })

  it('forwards explicit runtime restarts through the preload bridge', async () => {
    const restartRuntime = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(),
        setSettings: vi.fn(),
        runtimeRequest: vi.fn(),
        restartRuntime,
        startSse: vi.fn(),
        stopSse: vi.fn(),
        onSseOpen: vi.fn(),
        onSseEvent: vi.fn(),
        onSseEnd: vi.fn(),
        onSseError: vi.fn()
      }
    })

    await expect(rendererRuntimeClient.restartRuntime()).resolves.toBeUndefined()
    expect(restartRuntime).toHaveBeenCalledTimes(1)
  })

  it('cancels a request in Main when its renderer signal aborts', async () => {
    const response = { ok: false, status: 0, body: '{}' }
    let finish!: (value: typeof response) => void
    const runtimeRequest = vi.fn(() => new Promise<typeof response>((resolve) => { finish = resolve }))
    const cancelRuntimeRequest = vi.fn(async () => {
      finish(response)
      return true
    })
    vi.stubGlobal('window', {
      kunGui: { runtimeRequest, cancelRuntimeRequest }
    })
    const controller = new AbortController()
    const pending = rendererRuntimeClient.runtimeRequest('/v1/threads/thread/state', 'GET', undefined, {
      signal: controller.signal,
      priority: 'foreground'
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelRuntimeRequest).toHaveBeenCalledOnce()
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thread/state',
      'GET',
      undefined,
      expect.objectContaining({
        requestId: expect.stringMatching(/^renderer-/),
        priority: 'foreground'
      })
    )
  })
})
