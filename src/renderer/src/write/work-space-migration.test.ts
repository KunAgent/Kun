import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '@shared/app-settings'
import { mergeWriteSettings } from '@shared/app-settings-write'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { legacyPaperLibraryMigration, withoutPaperLibrary } from './work-space-migration'

const LIBRARY = '/papers/lab'
const OTHER = '/papers/old'
const initialWork = useWriteWorkspaceStore.getState()
let settings: AppSettingsV1
let setSettings: ReturnType<typeof vi.spyOn>

function configured(paperMode: { enabled: boolean; libraries: string[]; activeLibrary: string }): AppSettingsV1 {
  return normalizeAppSettings({ write: {
    defaultWorkspaceRoot: '/docs', activeWorkspaceRoot: '/docs', workspaces: ['/docs'], autoSaveEnabled: false,
    paperMode
  } } as AppSettingsV1)
}

describe('legacyPaperLibraryMigration', () => {
  it('folds libraries into the spaces and reopens the library left on the paper surface', () => {
    expect(legacyPaperLibraryMigration({
      workspaces: ['/docs'],
      paperMode: { ...configured({ enabled: true, libraries: [LIBRARY, OTHER], activeLibrary: LIBRARY }).write.paperMode }
    })).toEqual({ workspaces: ['/docs', LIBRARY, OTHER], activeWorkspaceRoot: LIBRARY, paperMode: { enabled: false } })
  })

  it('adds a registered library as a space without moving a desktop that was on documents', () => {
    expect(legacyPaperLibraryMigration({
      workspaces: ['/docs'],
      paperMode: { ...configured({ enabled: false, libraries: [LIBRARY], activeLibrary: LIBRARY }).write.paperMode }
    })).toEqual({ workspaces: ['/docs', LIBRARY], paperMode: { enabled: false } })
  })

  it('changes nothing once every library is a space', () => {
    expect(legacyPaperLibraryMigration({
      workspaces: ['/docs', LIBRARY],
      paperMode: { ...configured({ enabled: false, libraries: [LIBRARY], activeLibrary: LIBRARY }).write.paperMode }
    })).toBeNull()
  })

  it('forgets a removed space as a library so it stays removed', () => {
    expect(withoutPaperLibrary({ libraries: [LIBRARY, OTHER], activeLibrary: LIBRARY }, LIBRARY))
      .toEqual({ libraries: [OTHER], activeLibrary: '' })
    expect(withoutPaperLibrary({ libraries: [OTHER], activeLibrary: OTHER }, '/docs')).toBeNull()
  })
})

describe('desktop Work settings load', () => {
  beforeEach(() => {
    const initializeWorkspace = vi.fn(async (root: string) => {
      useWriteWorkspaceStore.setState({ workspaceRoot: root, rootDirectory: root, treeError: null })
    })
    useWriteWorkspaceStore.setState({ ...initialWork, workspaceRoot: '', documentsByPath: {} }, true)
    useWriteWorkspaceStore.setState({ initializeWorkspace, saveAllDocuments: vi.fn(async () => true) })
    vi.spyOn(rendererRuntimeClient, 'getSettings').mockImplementation(async () => settings)
    setSettings = vi.spyOn(rendererRuntimeClient, 'setSettings').mockImplementation(async (patch) => {
      settings = { ...settings, write: mergeWriteSettings(settings.write, patch.write) }
      return settings
    })
    vi.stubGlobal('window', { kunGui: {} })
  })

  afterEach(() => {
    useWriteWorkspaceStore.getState().setWorkSurface('docs')
    useWriteWorkspaceStore.setState(initialWork, true)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens a desktop left on the paper surface on that library, as a space', async () => {
    settings = configured({ enabled: true, libraries: [LIBRARY], activeLibrary: LIBRARY })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    const state = useWriteWorkspaceStore.getState()
    expect(state.workSurface).toBe('docs')
    expect(state.workspaceRoot).toBe(LIBRARY)
    expect(state.workspaceRoots).toEqual(['/docs', LIBRARY])
    expect(settings.write.paperMode.enabled).toBe(false)
    // The phone still reads its library list.
    expect(settings.write.paperMode.libraries).toEqual([LIBRARY])

    setSettings.mockClear()
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('never writes settings for a desktop that has no libraries', async () => {
    settings = configured({ enabled: false, libraries: [], activeLibrary: '' })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(setSettings).not.toHaveBeenCalled()
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/docs')
  })

  it('keeps a removed former library out of the spaces on the next load', async () => {
    settings = configured({ enabled: false, libraries: [LIBRARY], activeLibrary: LIBRARY })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(useWriteWorkspaceStore.getState().workspaceRoots).toContain(LIBRARY)
    await useWriteWorkspaceStore.getState().removeWriteWorkspace(LIBRARY)
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(useWriteWorkspaceStore.getState().workspaceRoots).toEqual(['/docs'])
    expect(settings.write.paperMode.libraries).toEqual([])
  })
})
