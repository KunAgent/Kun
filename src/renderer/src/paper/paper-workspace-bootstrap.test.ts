import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '@shared/app-settings'
import { mergeWriteSettings } from '@shared/app-settings-write'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { usePaperModeStore } from './paper-mode-store'
import { usePaperStore } from '../write/paper/paper-store'
import { usePaperWorkspaceBootstrapStore } from './paper-workspace-bootstrap'
import { registerPaperLibrary, removePaperLibrary, switchPaperLibrary } from './paper-mode-actions'

const DEFAULT = '/profile/paper-workspaces/default'
const initialWork = useWriteWorkspaceStore.getState()
const initialPaper = usePaperModeStore.getState()
let settings: AppSettingsV1
let creationCount: number
let ensure: ReturnType<typeof vi.fn>
let setSettings: ReturnType<typeof vi.spyOn>
let initializeWorkspace: ReturnType<typeof vi.fn<(root: string) => Promise<void>>>

function configured(root = ''): AppSettingsV1 {
  return normalizeAppSettings({ write: {
    defaultWorkspaceRoot: '/docs', activeWorkspaceRoot: '/docs', workspaces: ['/docs'], autoSaveEnabled: false,
    paperMode: { enabled: true, libraries: root ? [root] : [], activeLibrary: root }
  } } as AppSettingsV1)
}

beforeEach(() => {
  settings = configured()
  creationCount = 0
  useWriteWorkspaceStore.setState({ ...initialWork, workSurface: 'docs', workspaceRoot: '', documentsByPath: {} }, true)
  usePaperModeStore.setState(initialPaper, true)
  usePaperWorkspaceBootstrapStore.setState({ status: 'idle', error: null, defaultWorkspaceRoot: '' })
  initializeWorkspace = vi.fn(async (root: string) => {
    useWriteWorkspaceStore.setState({ workspaceRoot: root, rootDirectory: root, treeError: null })
  })
  useWriteWorkspaceStore.setState({ initializeWorkspace, saveAllDocuments: vi.fn(async () => true) })
  vi.spyOn(rendererRuntimeClient, 'getSettings').mockImplementation(async () => settings)
  setSettings = vi.spyOn(rendererRuntimeClient, 'setSettings').mockImplementation(async (patch) => {
    settings = { ...settings, write: mergeWriteSettings(settings.write, patch.write) }
    return settings
  })
  ensure = vi.fn(async () => {
    const paper = settings.write.paperMode
    const root = paper.activeLibrary || paper.libraries[0] || DEFAULT
    const created = !paper.activeLibrary && !paper.libraries.length
    if (created) creationCount += 1
    settings = { ...settings, write: mergeWriteSettings(settings.write, { paperMode: {
      libraries: [...new Set([root, ...paper.libraries])], activeLibrary: root
    } }) }
    return { ok: true, created, workspaceRoot: root, defaultWorkspaceRoot: DEFAULT,
      activeLibrary: root, libraries: settings.write.paperMode.libraries }
  })
  vi.stubGlobal('window', { confirm: vi.fn(() => false), kunGui: {
    paperWorkspaceEnsure: ensure,
    listWorkspaceDirectory: vi.fn(async ({ workspaceRoot }) => ({ ok: true, root: workspaceRoot, entries: [] }))
  } })
})

afterEach(() => {
  useWriteWorkspaceStore.getState().setWorkSurface('docs')
  useWriteWorkspaceStore.setState(initialWork, true)
  usePaperModeStore.setState(initialPaper, true)
  usePaperWorkspaceBootstrapStore.setState({ status: 'idle', error: null, defaultWorkspaceRoot: '' })
  usePaperStore.getState().reset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('desktop paper workspace bootstrap', () => {
  it('admits the default on first entry and preserves the same root on reload and restart', async () => {
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe(DEFAULT)
    expect(useWriteWorkspaceStore.getState().workSurface).toBe('papers')
    expect(usePaperWorkspaceBootstrapStore.getState()).toMatchObject({ status: 'ready', defaultWorkspaceRoot: DEFAULT })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    useWriteWorkspaceStore.setState({ workspaceRoot: '', paperMode: initialWork.paperMode })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(settings.write.paperMode.libraries).toEqual([DEFAULT])
    expect(creationCount).toBe(1)
    expect(settings.write.workspaces).toEqual(['/docs'])
  })

  it('keeps a legacy chosen root and never copies document workspaces into papers', async () => {
    settings = configured('/legacy/library')
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/legacy/library')
    expect(creationCount).toBe(0)
    expect(settings.write.paperMode.libraries).toEqual(['/legacy/library'])
  })

  it('never creates a host default while loading mobile document settings', async () => {
    await useWriteWorkspaceStore.getState().loadWriteSettings({ mobile: true })
    expect(ensure).not.toHaveBeenCalled()
    expect(useWriteWorkspaceStore.getState().workSurface).toBe('docs')
  })

  it('shows recoverable failure and discards stale paper identities when the selected root is unavailable', async () => {
    settings = configured('/missing')
    usePaperModeStore.setState({ selection: new Set(['papers/old']), infoUnitDir: 'papers/old', importDialogOpen: true })
    ensure.mockResolvedValue({ ok: false, code: 'permission-denied', message: 'Access denied', workspaceRoot: '/missing', defaultWorkspaceRoot: DEFAULT })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(usePaperWorkspaceBootstrapStore.getState()).toMatchObject({ status: 'error', error: 'Access denied' })
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('')
    expect(settings.write.paperMode.activeLibrary).toBe('/missing')
    expect(usePaperModeStore.getState().selection.size).toBe(0)
    expect(usePaperModeStore.getState().importDialogOpen).toBe(false)
  })

  it('retries initialization after permission recovery without replacing the selected root', async () => {
    settings = configured('/chosen')
    ensure.mockRejectedValueOnce(new Error('Permission denied'))
    useWriteWorkspaceStore.setState({ paperMode: settings.write.paperMode })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(usePaperWorkspaceBootstrapStore.getState().status).toBe('error')
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/chosen')
    expect(usePaperWorkspaceBootstrapStore.getState().status).toBe('ready')
    expect(creationCount).toBe(0)
  })
})

describe('paper library transitions', () => {
  async function mount(): Promise<void> {
    settings = configured('/a')
    await useWriteWorkspaceStore.getState().loadWriteSettings()
  }

  it('switches roots and clears selection, metadata, filters and research scope together', async () => {
    await mount()
    usePaperModeStore.setState({ selection: new Set(['papers/shared']), infoUnitDir: 'papers/shared', infoDrawerOpen: true })
    usePaperModeStore.getState().setFilter({ group: 'old-group' })
    useWriteWorkspaceStore.getState().setPaperResearch({ sessionId: 'old-session' })
    expect(await switchPaperLibrary('/b')).toEqual({ ok: true })
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/b')
    expect(usePaperModeStore.getState()).toMatchObject({ infoUnitDir: null, infoDrawerOpen: false, filter: { group: '' } })
    expect(usePaperModeStore.getState().selection.size).toBe(0)
    expect(useWriteWorkspaceStore.getState().paperResearch.sessionId).toBeNull()
  })

  it('keeps dirty content and the prior selection if the user cancels leaving', async () => {
    await mount()
    const dirty = { kind: 'text', path: '/a/notes.md', saveStatus: 'dirty', content: 'keep this' }
    useWriteWorkspaceStore.setState({ documentsByPath: { '/a/notes.md': dirty } as never })
    expect(await switchPaperLibrary('/b')).toEqual({ ok: false, message: 'switch-canceled' })
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/a')
    expect(settings.write.paperMode.activeLibrary).toBe('/a')
    expect(settings.write.paperMode.libraries).toEqual(['/a'])
    expect(useWriteWorkspaceStore.getState().documentsByPath['/a/notes.md']).toBe(dirty)
  })

  it('rejects a missing or denied selected folder before changing settings', async () => {
    await mount()
    const writes = setSettings.mock.calls.length
    vi.mocked(window.kunGui.listWorkspaceDirectory).mockResolvedValue({ ok: false, message: 'Folder not found', code: 'not-found' } as never)
    expect(await switchPaperLibrary('/gone')).toEqual({ ok: false, message: 'Folder not found' })
    expect(setSettings.mock.calls.length).toBe(writes)
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/a')
  })

  it('serializes simultaneous additions and repeated switches without losing registered roots', async () => {
    await mount()
    await Promise.all([registerPaperLibrary('/b'), registerPaperLibrary('/c'), registerPaperLibrary('/b')])
    expect(settings.write.paperMode.libraries).toEqual(['/a', '/b', '/c'])
    await Promise.all([switchPaperLibrary('/b'), switchPaperLibrary('/c')])
    expect(settings.write.paperMode.activeLibrary).toBe('/c')
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/c')
    expect(new Set(settings.write.paperMode.libraries).size).toBe(3)
  })

  it('removes registration only and restores another library as active', async () => {
    await mount()
    await registerPaperLibrary('/b')
    expect(await removePaperLibrary('/a')).toEqual({ ok: true })
    expect(settings.write.paperMode.libraries).toEqual(['/b'])
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/b')
    expect(Object.keys(window.kunGui)).not.toContain('deleteWorkspaceEntry')
  })
})
