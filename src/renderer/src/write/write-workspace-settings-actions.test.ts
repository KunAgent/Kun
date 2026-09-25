import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultWriteSettings, normalizeAppSettings, type AppSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from './write-workspace-store'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function settingsFor(workspaceRoot: string): AppSettingsV1 {
  return normalizeAppSettings({
    write: {
      activeWorkspaceRoot: workspaceRoot,
      workspaces: [workspaceRoot]
    }
  } as AppSettingsV1)
}

afterEach(() => {
  vi.restoreAllMocks()
  useWriteWorkspaceStore.setState({
    workspaceRoot: '',
    workspaceRoots: [],
    inlineCompletion: defaultWriteSettings().inlineCompletion,
    settingsLoading: false,
    settingsError: null
  })
})

describe('write workspace settings actions', () => {
  it('keeps settingsLoading true until the active directory snapshot initializes', async () => {
    const initialized = deferred<void>()
    vi.spyOn(rendererRuntimeClient, 'getSettings')
      .mockResolvedValue(settingsFor('/workspace/default'))
    const initializeWorkspace = vi.fn(() => initialized.promise)
    useWriteWorkspaceStore.setState({ initializeWorkspace })

    const loading = useWriteWorkspaceStore.getState().loadWriteSettings()
    await vi.waitFor(() => expect(initializeWorkspace)
      .toHaveBeenCalledWith('/workspace/default', { force: false }))

    expect(useWriteWorkspaceStore.getState().settingsLoading).toBe(true)
    initialized.resolve()
    await loading
    expect(useWriteWorkspaceStore.getState().settingsLoading).toBe(false)
  })

  it('applies only the latest workspace selection when settings responses finish out of order', async () => {
    const first = deferred<AppSettingsV1>()
    const second = deferred<AppSettingsV1>()
    vi.spyOn(rendererRuntimeClient, 'setSettings')
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const initializeWorkspace = vi.fn(async () => undefined)
    useWriteWorkspaceStore.setState({
      workspaceRoots: ['/workspace/original'],
      initializeWorkspace
    })

    const selectingFirst = useWriteWorkspaceStore.getState().selectWriteWorkspace('/workspace/a')
    const selectingSecond = useWriteWorkspaceStore.getState().selectWriteWorkspace('/workspace/b')

    second.resolve(settingsFor('/workspace/b'))
    await selectingSecond
    first.resolve(settingsFor('/workspace/a'))
    await selectingFirst

    expect(initializeWorkspace).toHaveBeenCalledTimes(1)
    expect(initializeWorkspace).toHaveBeenCalledWith('/workspace/b')
    expect(useWriteWorkspaceStore.getState().workspaceRoots).toContain('/workspace/b')
    expect(useWriteWorkspaceStore.getState().workspaceRoots).not.toContain('/workspace/a')
  })
})

describe('loadWriteSettings concurrency and surface switch', () => {
  afterEach(() => {
    useWriteWorkspaceStore.getState().setWorkSurface('docs')
  })

  it('runs one follow-up load for calls made while a load is in flight', async () => {
    const first = deferred<AppSettingsV1>()
    const getSettings = vi.spyOn(rendererRuntimeClient, 'getSettings')
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(settingsFor('/workspace/second'))
    const initializeWorkspace = vi.fn(async () => undefined)
    useWriteWorkspaceStore.setState({ initializeWorkspace })

    const loading = useWriteWorkspaceStore.getState().loadWriteSettings()
    const queuedA = useWriteWorkspaceStore.getState().loadWriteSettings()
    const queuedB = useWriteWorkspaceStore.getState().loadWriteSettings()
    first.resolve(settingsFor('/workspace/first'))
    await Promise.all([loading, queuedA, queuedB])

    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(initializeWorkspace).toHaveBeenLastCalledWith('/workspace/second', { force: false })
  })

  it('stays on the docs surface and rolls the flag back when leaving is declined', async () => {
    const enabled = normalizeAppSettings({
      write: {
        activeWorkspaceRoot: '/workspace/docs',
        workspaces: ['/workspace/docs'],
        // Autosave off so leaving asks the user (declined below).
        autoSaveEnabled: false,
        paperMode: { enabled: true, libraries: ['/library'], activeLibrary: '/library' }
      }
    } as AppSettingsV1)
    vi.spyOn(rendererRuntimeClient, 'getSettings').mockResolvedValue(enabled)
    const setSettings = vi.spyOn(rendererRuntimeClient, 'setSettings')
      .mockResolvedValue(settingsFor('/workspace/docs'))
    vi.stubGlobal('window', { confirm: vi.fn(() => false) })
    const initializeWorkspace = vi.fn(async () => undefined)
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace/docs',
      autoSaveEnabled: false,
      documentsByPath: {
        '/workspace/docs/a.md': { kind: 'text', path: '/workspace/docs/a.md', saveStatus: 'dirty' }
      } as never,
      initializeWorkspace
    })

    await useWriteWorkspaceStore.getState().loadWriteSettings()

    expect(useWriteWorkspaceStore.getState().workSurface).toBe('docs')
    expect(initializeWorkspace).not.toHaveBeenCalled()
    expect(setSettings).toHaveBeenCalledWith({ write: { paperMode: { enabled: false } } })
    useWriteWorkspaceStore.setState({ documentsByPath: {} })
    vi.unstubAllGlobals()
  })
})

describe('setInlineCompletionEnabled', () => {
  it('keeps a toggle that completes while an older settings load is in flight', async () => {
    const settingsLoad = deferred<AppSettingsV1>()
    vi.spyOn(rendererRuntimeClient, 'getSettings').mockReturnValue(settingsLoad.promise)
    vi.spyOn(rendererRuntimeClient, 'setSettings').mockResolvedValue(undefined as never)
    useWriteWorkspaceStore.setState({ initializeWorkspace: vi.fn(async () => undefined) })

    const loading = useWriteWorkspaceStore.getState().loadWriteSettings()
    await vi.waitFor(() => expect(rendererRuntimeClient.getSettings).toHaveBeenCalled())
    const toggling = useWriteWorkspaceStore.getState().setInlineCompletionEnabled(false)
    await toggling
    settingsLoad.resolve(settingsFor('/workspace/default'))
    await loading

    expect(useWriteWorkspaceStore.getState().inlineCompletion.enabled).toBe(false)
  })

  it('keeps a pending toggle when a later settings load returns a stale snapshot', async () => {
    const toggleWrite = deferred<AppSettingsV1>()
    const settingsLoad = deferred<AppSettingsV1>()
    vi.spyOn(rendererRuntimeClient, 'setSettings').mockReturnValue(toggleWrite.promise)
    vi.spyOn(rendererRuntimeClient, 'getSettings').mockReturnValue(settingsLoad.promise)
    useWriteWorkspaceStore.setState({ initializeWorkspace: vi.fn(async () => undefined) })

    const toggling = useWriteWorkspaceStore.getState().setInlineCompletionEnabled(false)
    await vi.waitFor(() => expect(rendererRuntimeClient.setSettings).toHaveBeenCalled())
    const loading = useWriteWorkspaceStore.getState().loadWriteSettings()
    toggleWrite.resolve(settingsFor('/workspace/default'))
    await toggling
    settingsLoad.resolve(settingsFor('/workspace/default'))
    await loading

    expect(useWriteWorkspaceStore.getState().inlineCompletion.enabled).toBe(false)
  })

  it('updates immediately and persists only the focused Write setting', async () => {
    const setSettings = vi.spyOn(rendererRuntimeClient, 'setSettings')
      .mockResolvedValue(undefined as never)

    const updating = useWriteWorkspaceStore.getState().setInlineCompletionEnabled(false)

    expect(useWriteWorkspaceStore.getState().inlineCompletion.enabled).toBe(false)
    await updating
    expect(setSettings).toHaveBeenCalledWith({
      write: { inlineCompletion: { enabled: false } }
    })
  })

  it('rolls back the optimistic toggle when persistence fails', async () => {
    vi.spyOn(rendererRuntimeClient, 'setSettings')
      .mockRejectedValue(new Error('settings unavailable'))

    await useWriteWorkspaceStore.getState().setInlineCompletionEnabled(false)

    expect(useWriteWorkspaceStore.getState().inlineCompletion.enabled).toBe(true)
    expect(useWriteWorkspaceStore.getState().settingsError).toBe('settings unavailable')
  })

  it('serializes rapid toggles and ignores a stale failure', async () => {
    const firstWrite = deferred<AppSettingsV1>()
    const setSettings = vi.spyOn(rendererRuntimeClient, 'setSettings')
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(undefined as never)

    const disable = useWriteWorkspaceStore.getState().setInlineCompletionEnabled(false)
    const enable = useWriteWorkspaceStore.getState().setInlineCompletionEnabled(true)
    firstWrite.reject(new Error('stale failure'))
    await Promise.all([disable, enable])

    expect(setSettings.mock.calls).toEqual([
      [{ write: { inlineCompletion: { enabled: false } } }],
      [{ write: { inlineCompletion: { enabled: true } } }]
    ])
    expect(useWriteWorkspaceStore.getState().inlineCompletion.enabled).toBe(true)
    expect(useWriteWorkspaceStore.getState().settingsError).toBeNull()
  })

  it('rolls the latest failed toggle back to the last confirmed choice', async () => {
    const setSettings = vi.spyOn(rendererRuntimeClient, 'setSettings')
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('second write failed'))

    const disable = useWriteWorkspaceStore.getState().setInlineCompletionEnabled(false)
    const enable = useWriteWorkspaceStore.getState().setInlineCompletionEnabled(true)
    await Promise.all([disable, enable])

    expect(useWriteWorkspaceStore.getState().inlineCompletion.enabled).toBe(false)
    expect(useWriteWorkspaceStore.getState().settingsError).toBe('second write failed')
  })
})
