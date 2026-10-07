import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '@shared/app-settings'
import { mergeWriteSettings } from '@shared/app-settings-write'
import type { PaperWorkspaceEnsureResult } from '@shared/paper/paper-workspace-types'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import type { PaperImportResult, PaperListUnitsResult, PaperUnitReadResult } from '@shared/paper/paper-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { importPaper, listPaperUnits, preprocessPaper, refreshPaperUnit } from '../write/paper/paper-actions'
import { openPaperUnit } from '../write/paper/paper-open-layout'
import { usePaperStore } from '../write/paper/paper-store'
import { openLibraryEntry } from './paper-library-actions'
import { usePaperModeStore } from './paper-mode-store'
import { EMPTY_LIBRARY_SLICE, usePaperLibraryIndexStore } from './paper-library-index'
import { resetPaperWorkspaceContent, usePaperWorkspaceBootstrapStore } from './paper-workspace-bootstrap'

const DEFAULT = '/profile/paper-workspaces/default'
const initialWork = useWriteWorkspaceStore.getState()
const initialPaper = usePaperModeStore.getState()
let settings: AppSettingsV1
let initializeWorkspace: ReturnType<typeof vi.fn<(root: string) => Promise<void>>>
let ensure: ReturnType<typeof vi.fn>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function configured(root: string): AppSettingsV1 {
  return normalizeAppSettings({ write: {
    defaultWorkspaceRoot: '/docs', activeWorkspaceRoot: '/docs', workspaces: ['/docs'], autoSaveEnabled: false,
    paperMode: { enabled: true, libraries: [root], activeLibrary: root }
  } } as AppSettingsV1)
}

function admitted(root: string): PaperWorkspaceEnsureResult {
  return { ok: true, workspaceRoot: root, defaultWorkspaceRoot: DEFAULT,
    created: false, libraries: [root], activeLibrary: root }
}

function entry(title: string): PaperLibraryEntry {
  return {
    unitDir: 'papers/shared',
    meta: { version: 2, slug: 'shared', title, authors: [], importedAt: '2026-01-01', status: 'unread' },
    hasPdf: false, hasNotes: true, interpretationCount: 0, group: ''
  }
}

function projectLibrary(root: string, paper: PaperLibraryEntry): void {
  resetPaperWorkspaceContent()
  useWriteWorkspaceStore.setState({ workspaceRoot: root, rootDirectory: root, paperMode: configured(root).write.paperMode })
  usePaperModeStore.getState().setEntriesResult({
    entries: [paper], counts: { total: 1, unread: 1, reading: 0, read: 0, missingPdf: 1 }, tags: [], groups: []
  })
}

beforeEach(() => {
  settings = configured('/a')
  useWriteWorkspaceStore.setState({ ...initialWork, workSurface: 'docs', workspaceRoot: '', rootDirectory: '', documentsByPath: {} }, true)
  usePaperModeStore.setState(initialPaper, true)
  usePaperStore.getState().reset()
  usePaperLibraryIndexStore.setState({ byRoot: {}, invalidations: {} })
  usePaperWorkspaceBootstrapStore.setState({ status: 'idle', error: null, defaultWorkspaceRoot: '' })
  initializeWorkspace = vi.fn(async (root: string) => {
    useWriteWorkspaceStore.setState({ workspaceRoot: root, rootDirectory: root, treeError: null })
  })
  useWriteWorkspaceStore.setState({ initializeWorkspace, openFile: vi.fn(async () => undefined) })
  vi.spyOn(rendererRuntimeClient, 'getSettings').mockImplementation(async () => settings)
  vi.spyOn(rendererRuntimeClient, 'setSettings').mockImplementation(async (patch) => {
    settings = { ...settings, write: mergeWriteSettings(settings.write, patch.write) }
    return settings
  })
  ensure = vi.fn(async () => admitted(settings.write.paperMode.activeLibrary))
  vi.stubGlobal('window', { confirm: vi.fn(() => false), kunGui: {
    paperWorkspaceEnsure: ensure,
    paperLocalStateWrite: vi.fn(async () => ({ ok: true }))
  } })
})

afterEach(() => {
  useWriteWorkspaceStore.getState().setWorkSurface('docs')
  useWriteWorkspaceStore.setState(initialWork, true)
  usePaperModeStore.setState(initialPaper, true)
  usePaperStore.getState().reset()
  usePaperLibraryIndexStore.setState({ byRoot: {}, invalidations: {} })
  usePaperWorkspaceBootstrapStore.setState({ status: 'idle', error: null, defaultWorkspaceRoot: '' })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('paper workspace admission races', () => {
  it('requires fresh B admission when settings change after the A ensure response', async () => {
    const admitB = deferred<PaperWorkspaceEnsureResult>()
    ensure.mockImplementationOnce(async () => {
      settings = configured('/b')
      return admitted('/a')
    }).mockImplementationOnce(() => admitB.promise)
    const loading = useWriteWorkspaceStore.getState().loadWriteSettings()
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(2))
    expect(initializeWorkspace).not.toHaveBeenCalled()
    expect(usePaperWorkspaceBootstrapStore.getState().status).toBe('loading')
    admitB.resolve(admitted('/b'))
    await loading
    expect(initializeWorkspace).toHaveBeenCalledTimes(1)
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/b')
    expect(usePaperWorkspaceBootstrapStore.getState().status).toBe('ready')
  })

  it('does not apply an obsolete A error to a newly selected B root', async () => {
    ensure.mockImplementationOnce(async () => {
      settings = configured('/b')
      return { ok: false, code: 'missing-root', message: 'A was removed', workspaceRoot: '/a', defaultWorkspaceRoot: DEFAULT }
    })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(ensure).toHaveBeenCalledTimes(2)
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/b')
    expect(usePaperWorkspaceBootstrapStore.getState()).toMatchObject({ status: 'ready', error: null })
  })

  it('does not carry A readiness into B while B directory initialization is still pending', async () => {
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    const initializedB = deferred<void>()
    initializeWorkspace.mockImplementation(async (root: string) => {
      useWriteWorkspaceStore.setState({ workspaceRoot: root, rootDirectory: '', treeError: null })
      await initializedB.promise
      useWriteWorkspaceStore.setState({ rootDirectory: root })
    })
    ensure.mockImplementationOnce(async () => {
      settings = configured('/b')
      return admitted('/a')
    })
    const loading = useWriteWorkspaceStore.getState().loadWriteSettings()
    await vi.waitFor(() => expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/b'))
    const statusWhileInitializing = usePaperWorkspaceBootstrapStore.getState().status
    initializedB.resolve()
    await loading
    expect(statusWhileInitializing).toBe('loading')
    expect(usePaperWorkspaceBootstrapStore.getState().status).toBe('ready')
  })

  it('does not mark a workspace ready if it disappears between ensure and directory initialization', async () => {
    initializeWorkspace.mockImplementation(async (root: string) => {
      useWriteWorkspaceStore.setState({ workspaceRoot: root, rootDirectory: '', treeError: 'Folder disappeared' })
    })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(ensure).toHaveBeenCalledOnce()
    expect(usePaperWorkspaceBootstrapStore.getState()).toMatchObject({ status: 'error', error: 'Folder disappeared' })
    expect(settings.write.paperMode.activeLibrary).toBe('/a')
  })

  it('fails closed if directory initialization returns without any root snapshot or explicit error', async () => {
    initializeWorkspace.mockImplementation(async (root: string) => {
      useWriteWorkspaceStore.setState({ workspaceRoot: root, rootDirectory: '', treeError: null })
    })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(usePaperWorkspaceBootstrapStore.getState().status).toBe('error')
    expect(usePaperWorkspaceBootstrapStore.getState().error).toContain('could not be opened')
  })

  it('retains dirty buffers and the unavailable error when same-root navigation is canceled', async () => {
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    const dirty = { kind: 'text', path: '/a/NOTES.md', saveStatus: 'dirty', content: 'unsaved work' }
    useWriteWorkspaceStore.setState({ documentsByPath: { '/a/NOTES.md': dirty } as never })
    initializeWorkspace.mockClear()
    ensure.mockResolvedValue({ ok: false, code: 'missing-root', message: 'Restore the folder', workspaceRoot: '/a', defaultWorkspaceRoot: DEFAULT })
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(initializeWorkspace).not.toHaveBeenCalled()
    expect(useWriteWorkspaceStore.getState().documentsByPath['/a/NOTES.md']).toBe(dirty)
    expect(useWriteWorkspaceStore.getState().workspaceRoot).toBe('/a')
    expect(usePaperWorkspaceBootstrapStore.getState()).toMatchObject({ status: 'error', error: 'Restore the folder' })
  })

  it('shows a recoverable initial-entry IPC error instead of remaining in loading', async () => {
    expect(useWriteWorkspaceStore.getState().paperMode.enabled).toBe(false)
    ensure.mockRejectedValue(new Error('The desktop bridge disconnected'))
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(usePaperWorkspaceBootstrapStore.getState()).toMatchObject({
      status: 'error', error: 'The desktop bridge disconnected'
    })
    expect(useWriteWorkspaceStore.getState().settingsLoading).toBe(false)
  })

  it('invalidates previously cached inactive roots when the papers directory setting changes', async () => {
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    usePaperLibraryIndexStore.setState({
      byRoot: { '/inactive': { ...EMPTY_LIBRARY_SLICE, status: 'ready', generation: 0 } },
      invalidations: {}
    })
    settings = { ...settings, write: mergeWriteSettings(settings.write, { paperReading: { papersDir: 'references' } }) }
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(usePaperLibraryIndexStore.getState().invalidations['/inactive']).toBeGreaterThan(0)
  })
})

describe('late paper results remain scoped to their originating workspace', () => {
  it.each(['success', 'error'])('ignores an old A list %s after switching to B', async (outcome) => {
    const listing = deferred<PaperListUnitsResult>()
    window.kunGui.paperListUnits = vi.fn(() => listing.promise)
    projectLibrary('/a', entry('Paper A'))
    const pending = listPaperUnits('/a', 'papers')
    const paperB = entry('Paper B')
    projectLibrary('/b', paperB)
    listing.resolve(outcome === 'success'
      ? { ok: true, units: [{ unitDir: 'papers/shared', meta: entry('Paper A').meta }] }
      : { ok: false, code: 'io', message: 'A is unavailable' })
    await pending
    expect(usePaperStore.getState().unitsByDir['papers/shared'].title).toBe('Paper B')
    expect(usePaperStore.getState().unitsError).toBeNull()
    expect(usePaperModeStore.getState().entries).toEqual([paperB])
  })

  it('ignores an old A metadata read after switching to B with the same unit-relative path', async () => {
    const read = deferred<PaperUnitReadResult>()
    window.kunGui.paperReadUnit = vi.fn(() => read.promise)
    projectLibrary('/a', entry('Paper A'))
    const pending = refreshPaperUnit('/a', 'papers/shared')
    projectLibrary('/b', entry('Paper B'))
    read.resolve({ ok: true, unitDir: 'papers/shared', meta: entry('Paper A').meta, figures: null })
    await pending
    expect(usePaperStore.getState().unitsByDir['papers/shared'].title).toBe('Paper B')
  })

  it('ignores a late A auto-mark response without changing B metadata or counters', async () => {
    const marked = deferred<Awaited<ReturnType<typeof window.kunGui.paperUpdateMeta>>>()
    window.kunGui.paperUpdateMeta = vi.fn(() => marked.promise)
    const paperA = entry('Paper A')
    projectLibrary('/a', paperA)
    await openLibraryEntry(paperA, '/a')
    expect(window.kunGui.paperUpdateMeta).toHaveBeenCalledWith({
      workspaceRoot: '/a', unitDir: 'papers/shared', patch: { status: 'reading' }
    })
    const paperB = entry('Paper B')
    projectLibrary('/b', paperB)
    const before = usePaperModeStore.getState().counts
    marked.resolve({ ok: true, meta: { ...paperA.meta, status: 'reading' } })
    await marked.promise
    await Promise.resolve()
    expect(usePaperModeStore.getState().entries).toEqual([paperB])
    expect(usePaperModeStore.getState().counts).toEqual(before)
    expect(usePaperStore.getState().unitsByDir['papers/shared'].title).toBe('Paper B')
  })

  it('finishes an old A import without opening it or injecting its metadata into B', async () => {
    const imported = deferred<PaperImportResult>()
    window.kunGui.paperImport = vi.fn(() => imported.promise)
    projectLibrary('/a', entry('Paper A'))
    const onImported = vi.fn()
    const pending = importPaper({ workspaceRoot: '/a', input: '1234.5678',
      settings: settings.write.paperReading, t: (key) => key, onImported })
    projectLibrary('/b', entry('Paper B'))
    imported.resolve({ ok: true, unitDir: 'papers/shared', meta: entry('New paper A').meta, reused: false })
    expect(await pending).toBe(true)
    expect(useWriteWorkspaceStore.getState().openFile).not.toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
    expect(usePaperStore.getState().unitsByDir['papers/shared'].title).toBe('Paper B')
  })

  it('ignores a preprocessing metadata read if B becomes active while that read is pending', async () => {
    const read = deferred<PaperUnitReadResult>()
    window.kunGui.paperPreprocess = vi.fn(async () => ({
      ok: true, textStatus: 'ok', figuresStatus: 'ok', figureCount: 1
    } as const))
    window.kunGui.paperReadUnit = vi.fn(() => read.promise)
    useWriteWorkspaceStore.setState({ refreshWorkspace: vi.fn(async () => undefined) })
    projectLibrary('/a', entry('Paper A'))
    const pending = preprocessPaper({ workspaceRoot: '/a', unitDir: 'papers/shared',
      settings: settings.write.paperReading, t: (key) => key })
    await vi.waitFor(() => expect(window.kunGui.paperReadUnit).toHaveBeenCalled())
    projectLibrary('/b', entry('Paper B'))
    read.resolve({ ok: true, unitDir: 'papers/shared', meta: entry('Updated paper A').meta, figures: null })
    expect(await pending).toBe(true)
    expect(usePaperStore.getState().unitsByDir['papers/shared'].title).toBe('Paper B')
  })

  it('does not split or focus B after a pending A PDF open resolves', async () => {
    const opened = deferred<void>()
    const openFile = vi.fn(() => opened.promise)
    const splitEditorGroup = vi.fn()
    const focusEditorGroup = vi.fn()
    useWriteWorkspaceStore.setState({ openFile, splitEditorGroup, focusEditorGroup })
    projectLibrary('/a', entry('Paper A'))
    const pending = openPaperUnit({ workspaceRoot: '/a', unitDir: 'papers/shared', meta: { pdfFile: 'paper.pdf' } })
    expect(openFile).toHaveBeenCalledOnce()
    projectLibrary('/b', entry('Paper B'))
    opened.resolve()
    await pending
    expect(splitEditorGroup).not.toHaveBeenCalled()
    expect(focusEditorGroup).not.toHaveBeenCalled()
    expect(openFile).toHaveBeenCalledOnce()
  })
})
