import { win32, posix } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { captureWriteDocumentContext, writeDocumentContextMatches } from './write-document-context'
import { writeSaveQueueKey } from './write-save-coordinator'
import {
  compactWorkspaceRoots, normalizePath, normalizeWriteSettings, pathsEqual,
  writeDirnameFromPath, writeJoinPath, writeRelativeToWorkspace
} from './write-workspace-store-helpers'

const windowsPaths = [
  { input: 'C:\\', expected: 'C:/' },
  { input: 'D:\\', expected: 'D:/' },
  { input: 'C:\\Work\\notes\\', expected: 'C:/Work/notes' },
  { input: '\\\\server\\share\\', expected: '//server/share' },
  { input: '\\\\server\\share\\notes\\', expected: '//server/share/notes' },
  { input: '\\\\?\\C:\\', expected: '//?/C:/' },
  { input: '\\\\?\\D:\\Work\\', expected: '//?/D:/Work' },
  { input: '\\\\?\\UNC\\server\\share\\', expected: '//?/UNC/server/share' },
  { input: '\\\\?\\Volume{abc-123}\\', expected: '//?/Volume{abc-123}/' }
]
const workspaceRoots = [windowsPaths[0], windowsPaths[1], windowsPaths[3], windowsPaths[5], windowsPaths[7],
  { input: '/', expected: '/' }]

beforeEach(() => {
  useWriteWorkspaceStore.setState(useWriteWorkspaceStore.getInitialState(), true)
})
afterEach(() => {
  useWriteWorkspaceStore.setState(useWriteWorkspaceStore.getInitialState(), true)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Work absolute path helpers', () => {
  it.each(windowsPaths)('keeps $input absolute with unchanged Win32 resolution', ({ input, expected }) => {
    expect(normalizePath(input)).toBe(expected)
    expect(normalizePath(expected)).toBe(expected)
    expect(win32.isAbsolute(normalizePath(input))).toBe(true)
    expect(win32.resolve(normalizePath(input), 'notes.md')).toBe(win32.resolve(input, 'notes.md'))
  })

  it.each(['C', 'D'])('resolves %s drive roots independently of the drive current directory', (drive) => {
    const normalized = normalizePath(`${drive}:\\`)
    expect(win32.resolve(normalized)).toBe(`${drive}:\\`)
    expect(win32.resolve(normalized, 'notes.md')).toBe(`${drive}:\\notes.md`)
    expect(pathsEqual(normalized, `${drive}:`)).toBe(false)
  })

  it.each([
    ['', ''], ['/', '/'], ['///', '/'], ['/work/notes///', '/work/notes'],
    ['relative/notes/', 'relative/notes'], ['C:', 'C:']
  ])('normalizes %j without changing its root kind', (input, expected) => {
    expect(normalizePath(input)).toBe(expected)
  })

  it('keeps root identity in captured save contexts and queue keys', () => {
    for (const { input, expected } of workspaceRoots) {
      const state = { workspaceRoot: input, activeFilePath: writeJoinPath(input, 'notes.md'), documentEpoch: 1 }
      const context = captureWriteDocumentContext(state)
      expect(context?.workspaceRoot).toBe(expected)
      expect(writeDocumentContextMatches(state, context!)).toBe(true)
      expect(writeSaveQueueKey(input, state.activeFilePath)).toBe(writeSaveQueueKey(expected, state.activeFilePath))
      const invalidRoot = expected === '/' ? '' : expected.endsWith(':/') ? expected.slice(0, -1) : '/other'
      expect(writeDocumentContextMatches({ ...state, workspaceRoot: invalidRoot }, context!)).toBe(false)
      expect(writeSaveQueueKey(invalidRoot, state.activeFilePath)).not.toBe(writeSaveQueueKey(expected, state.activeFilePath))
    }
  })

  it('retains POSIX root semantics rather than resolving against the current directory', () => {
    expect(posix.resolve(normalizePath('/'), 'notes.md')).toBe('/notes.md')
    expect(compactWorkspaceRoots(['/', 'C:\\', 'C:/', 'D:\\', '/work/'])).toEqual(['/', 'C:/', 'D:/', '/work'])
  })

  it.each(workspaceRoots)('joins and relativizes files beneath $input without doubled separators', ({ input, expected }) => {
    const path = `${expected}${expected.endsWith('/') ? '' : '/'}folder/notes.md`
    expect(writeJoinPath(input, 'folder/notes.md')).toBe(path)
    expect(writeRelativeToWorkspace(input, path)).toBe('folder/notes.md')
    expect(writeDirnameFromPath(writeJoinPath(input, 'notes.md'))).toBe(expected)
    expect(writeDirnameFromPath(input)).toBe(expected)
    const settings = normalizeWriteSettings({ defaultWorkspaceRoot: input, activeWorkspaceRoot: input, workspaces: [input] })
    expect(settings.defaultWorkspaceRoot).toBe(expected)
    expect(settings.activeWorkspaceRoot).toBe(expected)
    expect(settings.workspaces).toEqual([expected])
  })
})

function installDirectoryBridge() {
  const listWorkspaceDirectory = vi.fn(async ({ workspaceRoot }: { workspaceRoot: string }) => ({
    ok: true as const, root: workspaceRoot, entries: []
  }))
  const values = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) }
  }, kunGui: { listWorkspaceDirectory } })
  useWriteWorkspaceStore.setState({ ensureWhiteboards: vi.fn(async () => true) })
  return listWorkspaceDirectory
}

function rootSettings(root: string): AppSettingsV1 {
  return normalizeAppSettings({ write: {
    defaultWorkspaceRoot: root, activeWorkspaceRoot: root, workspaces: [root]
  } } as AppSettingsV1)
}

describe('Work root settings and real store initialization', () => {
  it.each(workspaceRoots)('keeps $input absolute in a real store save payload', async ({ input, expected }) => {
    installDirectoryBridge()
    await useWriteWorkspaceStore.getState().initializeWorkspace(input)
    const path = writeJoinPath(expected, 'notes.md')
    const write = vi.fn(async () => ({ ok: true as const, path, savedAt: '2026-11-08T00:00:00Z' }))
    Object.assign(window.kunGui, { writeWorkspaceFile: write })
    useWriteWorkspaceStore.setState({ activeFilePath: path, activeFileKind: 'text', fileContent: 'draft',
      persistedContent: '', contentRevision: 1, saveStatus: 'dirty' })
    await expect(useWriteWorkspaceStore.getState().flushSave(expected)).resolves.toBe(true)
    expect(write).toHaveBeenCalledExactlyOnceWith({ workspaceRoot: expected, path, content: 'draft' })
    expect(useWriteWorkspaceStore.getState()).toMatchObject({ persistedContent: 'draft', saveStatus: 'saved' })
  })

  it.each(workspaceRoots)('passes $input intact through initializeWorkspace to directory IPC', async ({ input, expected }) => {
    const list = installDirectoryBridge()
    await useWriteWorkspaceStore.getState().initializeWorkspace(input)
    expect(list).toHaveBeenCalledExactlyOnceWith({ workspaceRoot: expected, path: undefined })
    expect(useWriteWorkspaceStore.getState()).toMatchObject({ workspaceRoot: expected, rootDirectory: expected, treeError: null })
  })

  it.each(workspaceRoots)('persists $input and initializes the returned root without drive-relative conversion', async ({ input, expected }) => {
    const list = installDirectoryBridge()
    const save = vi.spyOn(rendererRuntimeClient, 'setSettings').mockResolvedValue(rootSettings(expected))
    await useWriteWorkspaceStore.getState().selectWriteWorkspace(input)
    expect(save).toHaveBeenCalledExactlyOnceWith({ write: { activeWorkspaceRoot: expected, workspaces: [expected] } })
    expect(list).toHaveBeenCalledWith({ workspaceRoot: expected, path: undefined })
    expect(useWriteWorkspaceStore.getState()).toMatchObject({ workspaceRoot: expected, settingsError: null })
  })

  it.each(workspaceRoots)('loads persisted $input through the real initialization action', async ({ input, expected }) => {
    const list = installDirectoryBridge()
    vi.spyOn(rendererRuntimeClient, 'getSettings').mockResolvedValue(rootSettings(input))
    await useWriteWorkspaceStore.getState().loadWriteSettings()
    expect(list).toHaveBeenCalledWith({ workspaceRoot: expected, path: undefined })
    expect(useWriteWorkspaceStore.getState()).toMatchObject({ workspaceRoot: expected, settingsLoading: false, settingsError: null })
  })
})
