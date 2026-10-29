/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { normalizeAppSettings, type AppSettingsV1 } from '@shared/app-settings'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { usePaperSpaceStore, paperSpaceItemKey, patchPaperSpaceItem } from './paper-space-store'
import { ensurePaperSpace, openPaperSpace, openPaperSpaceItem, paperSpaceReadingSettings, refreshPaperSpace } from './paper-space'

const chat = vi.hoisted(() => ({ setState: vi.fn() }))
const readSettings = vi.hoisted(() => vi.fn())
vi.mock('../agent/runtime-client', () => ({ rendererRuntimeClient: { getSettings: readSettings } }))
vi.mock('../store/chat-store', () => ({ useChatStore: chat }))
vi.mock('./paper-notes-draft', () => ({ preparePaperNotesForNavigation: vi.fn(async () => true) }))

function entry(title: string): PaperLibraryEntry {
  return { unitDir: 'papers/same', meta: { version: 2, slug: 'same', title, authors: [], importedAt: '2026-01-01T00:00:00Z' },
    group: '', hasPdf: false, hasNotes: true, interpretationCount: 0 }
}
const listing = (entries: PaperLibraryEntry[]) => ({ ok: true as const, entries, counts: { total: entries.length, unread: entries.length, reading: 0, read: 0, missingPdf: entries.length }, tags: [], groups: [] })
const ensure = vi.fn(async () => ({ ok: true, workspaceRoot: '/fixed', libraries: ['/fixed', '/legacy'], defaultWorkspaceRoot: '/fixed' }))
const list = vi.fn()

function registration({ libraries = ['/fixed', '/legacy'], workspaces = ['/work'], papersDir = 'papers', autoMarkReading = false } = {}) {
  return normalizeAppSettings({ write: { workspaces, defaultWorkspaceRoot: workspaces[0] ?? '/fixed', activeWorkspaceRoot: workspaces[0] ?? '/fixed', paperMode: { libraries, activeLibrary: '/fixed', autoMarkReading }, paperReading: { papersDir } } } as AppSettingsV1)
}

beforeEach(() => {
  vi.clearAllMocks()
  readSettings.mockReset().mockResolvedValue(registration())
  usePaperSpaceStore.setState(usePaperSpaceStore.getInitialState(), true)
  useWriteWorkspaceStore.setState({ workspaceRoot: '/work', workspaceRoots: ['/work'],
    paperMode: { ...useWriteWorkspaceStore.getState().paperMode, libraries: ['/fixed', '/legacy'], autoMarkReading: false } })
  Object.assign(window, { kunGui: { paperWorkspaceEnsure: ensure, paperLibraryList: list, paperLocalStateWrite: vi.fn(async () => ({ ok: true })) } })
  list.mockImplementation(async ({ workspaceRoot }: { workspaceRoot: string }) => listing(workspaceRoot === '/work' ? [] : [entry(workspaceRoot)]))
})
afterEach(() => { delete (window as unknown as { kunGui?: unknown }).kunGui })

describe('the global paper space', () => {
  it('bootstraps once without passing Work as a root and stays fixed across Work switches', async () => {
    expect(await ensurePaperSpace()).toBe('/fixed')
    useWriteWorkspaceStore.setState({ workspaceRoot: '/unrelated', workspaceRoots: ['/unrelated'] })
    expect(await ensurePaperSpace()).toBe('/fixed')
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(ensure).toHaveBeenCalledWith()
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/unrelated')
  })

  it('flattens legacy units without conflating the same unitDir across roots', async () => {
    await refreshPaperSpace()
    const state = usePaperSpaceStore.getState()
    expect(state.items).toHaveLength(2)
    expect(new Set(state.items.map((item) => item.key)).size).toBe(2)
    patchPaperSpaceItem('/legacy', 'papers/same', { hasNotes: false })
    expect(usePaperSpaceStore.getState().entriesByRoot['/fixed'][0].hasNotes).toBe(true)
    expect(usePaperSpaceStore.getState().entriesByRoot['/legacy'][0].hasNotes).toBe(false)
    await openPaperSpaceItem(state.items.find((item) => item.libraryRoot === '/legacy')!)
    expect(usePaperSpaceStore.getState().readerKey).toBe(paperSpaceItemKey('/legacy', 'papers/same'))
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/work')
    expect(window.kunGui.paperLocalStateWrite).toHaveBeenCalledWith(expect.objectContaining({ libraryRoot: '/legacy' }))
  })

  it('preserves an existing source index on a per-root read failure', async () => {
    await refreshPaperSpace()
    list.mockImplementation(async ({ workspaceRoot }: { workspaceRoot: string }) => workspaceRoot === '/legacy'
      ? { ok: false, code: 'io', message: 'permission denied' } : listing([]))
    await refreshPaperSpace()
    expect(usePaperSpaceStore.getState().items.map((item) => item.entry.meta.title)).toEqual(['/legacy'])
    expect(usePaperSpaceStore.getState().errorsByRoot).toEqual({ '/legacy': 'permission denied' })
  })

  it('loads registered legacy sources and paper settings without ever mounting Work on a cold start', async () => {
    const initialize = vi.fn()
    const load = vi.fn()
    useWriteWorkspaceStore.setState({ workspaceRoot: '', workspaceRoots: [], initializeWorkspace: initialize, loadWriteSettings: load,
      paperMode: { ...useWriteWorkspaceStore.getState().paperMode, autoMarkReading: true } })
    readSettings.mockResolvedValue(registration({ libraries: ['/fixed'], workspaces: ['/registered-old'], papersDir: 'archived-papers', autoMarkReading: false }))
    const update = vi.fn()
    Object.assign(window.kunGui, { paperUpdateMeta: update })
    await openPaperSpace()
    await refreshPaperSpace()
    expect(usePaperSpaceStore.getState().sourceRoots).toEqual(['/fixed', '/registered-old'])
    expect(list).toHaveBeenCalledWith({ workspaceRoot: '/registered-old', papersDir: 'archived-papers' })
    expect(paperSpaceReadingSettings().papersDir).toBe('archived-papers')
    await openPaperSpaceItem(usePaperSpaceStore.getState().items[0])
    expect(update).not.toHaveBeenCalled()
    expect(initialize).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
    expect(useWriteWorkspaceStore.getState()).toMatchObject({ workspaceRoot: '', workspaceRoots: [] })
  })

  it('removes unregistered sources from the displayed index without touching their files', async () => {
    await refreshPaperSpace()
    readSettings.mockResolvedValue(registration({ libraries: ['/fixed'], workspaces: [] }))
    await refreshPaperSpace()
    expect(usePaperSpaceStore.getState().sourceRoots).toEqual(['/fixed'])
    expect(usePaperSpaceStore.getState().entriesByRoot['/legacy']).toBeUndefined()
    expect(window.kunGui.paperLocalStateWrite).not.toHaveBeenCalled()
  })

  it('keeps the previous index and exposes a retryable error when source registration cannot be read', async () => {
    await refreshPaperSpace()
    const entries = usePaperSpaceStore.getState().entriesByRoot
    readSettings.mockRejectedValueOnce(new Error('settings offline'))
    await refreshPaperSpace()
    expect(usePaperSpaceStore.getState()).toMatchObject({ workspaceRoot: '/fixed', status: 'error', error: 'settings offline', entriesByRoot: entries })
    await refreshPaperSpace()
    expect(usePaperSpaceStore.getState()).toMatchObject({ status: 'ready', error: null })
  })

  it('can retry after the bridge was synchronously unavailable', async () => {
    const gui = window.kunGui
    Object.assign(window, { kunGui: {} })
    await expect(ensurePaperSpace()).rejects.toThrow('unavailable')
    Object.assign(window, { kunGui: gui })
    await expect(ensurePaperSpace()).resolves.toBe('/fixed')
  })

  it('does not let an obsolete refresh replace the newer index', async () => {
    readSettings.mockResolvedValue(registration({ libraries: ['/fixed'], workspaces: [] }))
    useWriteWorkspaceStore.setState({ workspaceRoots: [], paperMode: { ...useWriteWorkspaceStore.getState().paperMode, libraries: ['/fixed'] } })
    ensure.mockResolvedValueOnce({ ok: true, workspaceRoot: '/fixed', libraries: ['/fixed'], defaultWorkspaceRoot: '/fixed' })
    let settle!: (result: ReturnType<typeof listing>) => void
    list.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
    const first = refreshPaperSpace()
    await vi.waitFor(() => expect(settle).toBeTypeOf('function'))
    list.mockResolvedValue(listing([entry('newer')]))
    await refreshPaperSpace()
    settle(listing([entry('obsolete')]))
    await first
    expect(usePaperSpaceStore.getState().items[0].entry.meta.title).toBe('newer')
  })

  it('leaves cache and root unchanged after a bootstrap error, with no replacement space', async () => {
    usePaperSpaceStore.setState({ workspaceRoot: '/missing', entriesByRoot: { '/missing': [entry('cached')] } })
    ensure.mockResolvedValueOnce({ ok: false, message: 'missing root' } as never)
    await expect(ensurePaperSpace()).rejects.toThrow('missing root')
    expect(usePaperSpaceStore.getState()).toMatchObject({ workspaceRoot: '/missing', status: 'error', entriesByRoot: { '/missing': [entry('cached')] } })
  })

  it('opens the global route without selecting or initializing Work', async () => {
    const select = vi.fn()
    useWriteWorkspaceStore.setState({ selectWriteWorkspace: select })
    await openPaperSpace('discover:search')
    expect(chat.setState).toHaveBeenCalledWith({ route: 'papers' })
    expect(select).not.toHaveBeenCalled()
    expect(usePaperSpaceStore.getState().view).toBe('discover:search')
  })
})
