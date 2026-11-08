import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSpreadsheetSaveResult } from '@shared/workspace-spreadsheet'
import { clearWriteWorkspaceSaveQueueForTests } from './write-save-coordinator'
import {
  clearWriteSpreadsheetEditorRegistrationsForTests,
  registerWriteSpreadsheetEditor,
  type PreparedSpreadsheetSave
} from './write-spreadsheet-editor-coordinator'
import { useWriteWorkspaceStore } from './write-workspace-store'

const ROOT = '/work'
const FILE = '/work/book.xlsx'
const store = (): ReturnType<typeof useWriteWorkspaceStore.getState> => useWriteWorkspaceStore.getState()
const mutations = (value: string): PreparedSpreadsheetSave['mutations'] => [
  { kind: 'cell', sheetName: 'Data', address: 'A1', value }
]
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function saved(): WorkspaceSpreadsheetSaveResult {
  return { ok: true, path: FILE, sourceSha256: 'b'.repeat(64), size: 120, mtimeMs: 2, appliedMutations: 1 }
}
function register(prepareSave = vi.fn(async (): Promise<PreparedSpreadsheetSave> => ({
  token: 'old-token', mutations: mutations('old edit')
}))): {
  unregister: () => void
  prepareSave: typeof prepareSave
  commitSave: ReturnType<typeof vi.fn>
  setSaving: ReturnType<typeof vi.fn>
} {
  const commitSave = vi.fn(() => ({ mutations: [] }))
  const setSaving = vi.fn()
  const unregister = registerWriteSpreadsheetEditor(FILE, {
    isFocused: () => true, prepareSave, commitSave, setSaving
  })
  return { unregister, prepareSave, commitSave, setSaving }
}

let saveWorkspaceSpreadsheet: ReturnType<typeof vi.fn>
beforeEach(async () => {
  store().resetWorkspace()
  clearWriteSpreadsheetEditorRegistrationsForTests()
  saveWorkspaceSpreadsheet = vi.fn(async () => saved())
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined },
    confirm: vi.fn(() => true),
    kunGui: {
      saveWorkspaceSpreadsheet,
      readWorkspaceOfficePreview: vi.fn(async () => ({
        ok: true, path: FILE, name: 'book.xlsx', sourceFormat: 'xlsx', renderFormat: 'xlsx',
        viewer: 'spreadsheet', size: 100, mtimeMs: 1, sourceSha256: 'a'.repeat(64), data: new Uint8Array([1])
      }))
    }
  })
  useWriteWorkspaceStore.setState({ workspaceRoot: ROOT, autoSaveEnabled: false })
  await store().openFile(ROOT, FILE)
  store().setSpreadsheetMutations(FILE, mutations('old edit'))
})
afterEach(() => {
  store().resetWorkspace()
  clearWriteSpreadsheetEditorRegistrationsForTests()
  clearWriteWorkspaceSaveQueueForTests()
  vi.unstubAllGlobals()
})

async function reopen(): Promise<void> {
  const epoch = store().documentsByPath[FILE].documentEpoch
  expect(await store().closeTab('primary', FILE, true)).toBe(true)
  await store().openFile(ROOT, FILE)
  expect(store().documentsByPath[FILE].documentEpoch).not.toBe(epoch)
  store().setSpreadsheetMutations(FILE, mutations('replacement edit'))
}

describe('XLSX save instance identity', () => {
  it.each(['success', 'source_changed', 'rejection'] as const)(
    'leaves a reopened dirty instance untouched after late disk %s', async (outcome) => {
      const disk = deferred<WorkspaceSpreadsheetSaveResult>()
      saveWorkspaceSpreadsheet.mockImplementationOnce(() => disk.promise)
      const oldEditor = register()
      const saving = store().saveDocument(ROOT, FILE)
      await vi.waitFor(() => expect(saveWorkspaceSpreadsheet).toHaveBeenCalledOnce())
      const oldRevision = store().documentsByPath[FILE].contentRevision
      oldEditor.unregister()
      await reopen()
      const newEditor = register()
      const replacement = store().documentsByPath[FILE]
      // The revisions deliberately collide: only instance identity can protect these mutations.
      expect(replacement.contentRevision).toBe(oldRevision)
      if (outcome === 'rejection') disk.reject(new Error('old disk failed'))
      else disk.resolve(outcome === 'success' ? saved() : {
        ok: false, code: 'source_changed', message: 'old source changed'
      })
      await saving
      expect(store().documentsByPath[FILE]).toEqual(replacement)
      expect(store().saveStatus).toBe('dirty')
      expect(oldEditor.commitSave).not.toHaveBeenCalled()
      expect(newEditor.commitSave).not.toHaveBeenCalled()
      expect(newEditor.setSaving).not.toHaveBeenCalled()
      expect(saveWorkspaceSpreadsheet).toHaveBeenCalledOnce()
    }
  )

  it.each(['success', 'rejection'] as const)(
    'does not write or alter a reopened instance after late prepare %s', async (outcome) => {
      const preparation = deferred<PreparedSpreadsheetSave>()
      const oldEditor = register(vi.fn(() => preparation.promise))
      const saving = store().saveDocument(ROOT, FILE)
      await vi.waitFor(() => expect(oldEditor.prepareSave).toHaveBeenCalledOnce())
      oldEditor.unregister()
      await reopen()
      const newEditor = register()
      const replacement = store().documentsByPath[FILE]
      if (outcome === 'rejection') preparation.reject(new Error('old preparation failed'))
      else preparation.resolve({ token: 'old-token', mutations: mutations('old edit') })
      await saving
      expect(saveWorkspaceSpreadsheet).not.toHaveBeenCalled()
      expect(store().documentsByPath[FILE]).toEqual(replacement)
      expect(newEditor.commitSave).not.toHaveBeenCalled()
      expect(newEditor.setSaving).not.toHaveBeenCalled()
    }
  )

  it('checks identity again before disk I/O if marking saving replaces the session', async () => {
    const unsubscribe = useWriteWorkspaceStore.subscribe((state) => {
      const document = state.documentsByPath[FILE]
      if (document?.saveStatus !== 'saving') return
      useWriteWorkspaceStore.setState({
        documentsByPath: { [FILE]: {
          ...document, documentEpoch: document.documentEpoch + 1,
          spreadsheetMutations: mutations('replacement edit'), saveStatus: 'dirty'
        } },
        documentEpoch: document.documentEpoch + 1, saveStatus: 'dirty'
      })
    })
    try {
      expect(await store().saveDocument(ROOT, FILE)).toBe(true)
      expect(saveWorkspaceSpreadsheet).not.toHaveBeenCalled()
      expect(store().documentsByPath[FILE]).toMatchObject({
        spreadsheetMutations: mutations('replacement edit'), saveStatus: 'dirty',
        spreadsheetSourceSha256: 'a'.repeat(64), spreadsheetCommitRevision: 0
      })
    } finally {
      unsubscribe()
    }
  })

  it.each(['prepare', 'disk'] as const)('ignores a late %s result when workspace changes but path and epoch match', async (phase) => {
    const preparation = deferred<PreparedSpreadsheetSave>()
    const disk = deferred<WorkspaceSpreadsheetSaveResult>()
    const editor = phase === 'prepare' ? register(vi.fn(() => preparation.promise)) : register()
    if (phase === 'disk') saveWorkspaceSpreadsheet.mockImplementationOnce(() => disk.promise)
    const saving = store().saveDocument(ROOT, FILE)
    await vi.waitFor(() => expect(phase === 'prepare' ? editor.prepareSave : saveWorkspaceSpreadsheet).toHaveBeenCalledOnce())
    const document = store().documentsByPath[FILE]
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/other-workspace', saveStatus: 'dirty', fileError: 'new workspace error',
      documentsByPath: { [FILE]: { ...document, saveStatus: 'dirty', fileError: 'new workspace error' } }
    })
    const replacement = store().documentsByPath[FILE]
    if (phase === 'prepare') preparation.resolve({ token: 'old-token', mutations: mutations('old edit') })
    else disk.resolve(saved())
    await saving
    expect(saveWorkspaceSpreadsheet).toHaveBeenCalledTimes(phase === 'prepare' ? 0 : 1)
    expect(store().documentsByPath[FILE]).toEqual(replacement)
    expect(editor.commitSave).not.toHaveBeenCalled()
    expect(editor.setSaving).toHaveBeenLastCalledWith(false)
  })

  it('waits for a saving XLSX before closing with autosave disabled without locking the queue', async () => {
    const disk = deferred<WorkspaceSpreadsheetSaveResult>()
    saveWorkspaceSpreadsheet.mockImplementationOnce(() => disk.promise)
    const saving = store().saveDocument(ROOT, FILE)
    await vi.waitFor(() => expect(saveWorkspaceSpreadsheet).toHaveBeenCalledOnce())
    let closed = false
    const closing = store().closeTab('primary', FILE).then((result) => { closed = true; return result })
    await Promise.resolve()
    expect(closed).toBe(false)
    expect(store().documentsByPath[FILE]).toBeDefined()
    expect(window.confirm).not.toHaveBeenCalled()
    disk.resolve(saved())
    expect(await saving).toBe(true)
    expect(await closing).toBe(true)
    expect(saveWorkspaceSpreadsheet).toHaveBeenCalledOnce()
    expect(store().documentsByPath[FILE]).toBeUndefined()
  })

  it('does not save or remove a replacement tab while the original close waits for its save', async () => {
    const disk = deferred<WorkspaceSpreadsheetSaveResult>()
    saveWorkspaceSpreadsheet.mockImplementationOnce(() => disk.promise)
    const saving = store().saveDocument(ROOT, FILE)
    await vi.waitFor(() => expect(saveWorkspaceSpreadsheet).toHaveBeenCalledOnce())
    const closing = store().closeTab('primary', FILE)
    await reopen()
    const replacement = store().documentsByPath[FILE]
    disk.resolve(saved())
    await saving
    expect(await closing).toBe(true)
    expect(saveWorkspaceSpreadsheet).toHaveBeenCalledOnce()
    expect(store().documentsByPath[FILE]).toEqual(replacement)
    expect(store().activeFilePath).toBe(FILE)
  })
})
