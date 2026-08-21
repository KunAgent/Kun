import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWriteDocumentSession, emptyWriteEditorLayout } from './write-editor-layout'
import { clearWriteWorkspaceSaveQueueForTests } from './write-save-coordinator'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { initialState } from './write-workspace-store-helpers'
import {
  clearWriteSpreadsheetEditorRegistrationsForTests,
  registerWriteSpreadsheetEditor
} from './write-spreadsheet-editor-coordinator'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function installDocuments(): void {
  const a = createWriteDocumentSession({
    path: '/work/a.md',
    kind: 'text',
    fileContent: 'draft a',
    persistedContent: 'saved a',
    saveStatus: 'dirty',
    documentEpoch: 1,
    contentRevision: 1
  })
  const b = createWriteDocumentSession({
    path: '/work/b.md',
    kind: 'text',
    fileContent: 'saved b',
    persistedContent: 'saved b',
    documentEpoch: 2
  })
  const layout = {
    ...emptyWriteEditorLayout(),
    groups: [{
      id: 'primary' as const,
      tabs: [
        { path: '/work/a.md', viewMode: 'live' as const },
        { path: '/work/b.md', viewMode: 'rich' as const }
      ],
      activePath: '/work/a.md'
    }]
  }
  useWriteWorkspaceStore.setState({
    ...initialState(),
    workspaceRoot: '/work',
    documentsByPath: { '/work/a.md': a, '/work/b.md': b },
    editorLayout: layout,
    activeFilePath: a.path,
    activeFileKind: a.kind,
    fileContent: a.fileContent,
    persistedContent: a.persistedContent,
    saveStatus: a.saveStatus,
    documentEpoch: a.documentEpoch,
    contentRevision: a.contentRevision
  })
}

function addSpreadsheet(): void {
  const spreadsheet = createWriteDocumentSession({
    path: '/work/book.xlsx',
    kind: 'office',
    officePreview: {
      ok: true,
      path: '/work/book.xlsx',
      name: 'book.xlsx',
      sourceFormat: 'xlsx',
      renderFormat: 'xlsx',
      viewer: 'spreadsheet',
      size: 100,
      mtimeMs: 1,
      sourceSha256: 'a'.repeat(64),
      data: new Uint8Array([1, 2, 3])
    }
  })
  useWriteWorkspaceStore.setState((state) => ({
    documentsByPath: { ...state.documentsByPath, [spreadsheet.path]: spreadsheet },
    editorLayout: {
      ...state.editorLayout,
      groups: state.editorLayout.groups.map((group) => ({
        ...group,
        tabs: [...group.tabs, { path: spreadsheet.path, viewMode: 'rich' as const }]
      }))
    }
  }))
}

beforeEach(() => {
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined },
    confirm: () => true,
    kunGui: { writeWorkspaceFile: vi.fn() }
  })
  installDocuments()
})

afterEach(() => {
  clearWriteWorkspaceSaveQueueForTests()
  clearWriteSpreadsheetEditorRegistrationsForTests()
  vi.unstubAllGlobals()
})

describe('write editor group actions', () => {
  it('does not apply a split ratio while the layout still has one group', () => {
    useWriteWorkspaceStore.getState().setSplitRatio(0.25)
    expect(useWriteWorkspaceStore.getState().editorLayout).toMatchObject({
      orientation: 'single',
      ratio: 0.5,
      groups: [{ id: 'primary' }]
    })
  })

  it('splits the active document into a preview occurrence', () => {
    useWriteWorkspaceStore.getState().splitEditorGroup('horizontal')
    const state = useWriteWorkspaceStore.getState()
    expect(state.editorLayout).toMatchObject({
      orientation: 'horizontal',
      focusedGroupId: 'secondary'
    })
    expect(state.editorLayout.groups[1]).toMatchObject({
      activePath: '/work/a.md',
      tabs: [{ path: '/work/a.md', viewMode: 'preview' }]
    })
    expect(Object.keys(state.documentsByPath)).toHaveLength(2)
  })

  it('shares content across two occurrences of the same path', () => {
    const state = useWriteWorkspaceStore.getState()
    state.splitEditorGroup('vertical')
    state.setDocumentContent('/work/a.md', 'new shared draft')
    expect(useWriteWorkspaceStore.getState().documentsByPath['/work/a.md']).toMatchObject({
      fileContent: 'new shared draft',
      saveStatus: 'dirty'
    })
  })

  it('updates only the saved session when focus changes during an in-flight save', async () => {
    const pending = deferred<{ ok: true; path: string; savedAt: string }>()
    const writeWorkspaceFile = vi.fn(() => pending.promise)
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined },
      confirm: () => true,
      kunGui: { writeWorkspaceFile }
    })
    const saving = useWriteWorkspaceStore.getState().saveDocument('/work', '/work/a.md')
    await vi.waitFor(() => expect(writeWorkspaceFile).toHaveBeenCalledOnce())
    useWriteWorkspaceStore.getState().activateTab('primary', '/work/b.md')
    pending.resolve({ ok: true, path: '/work/a.md', savedAt: '2026-08-12T00:00:00.000Z' })
    await expect(saving).resolves.toBe(true)
    const state = useWriteWorkspaceStore.getState()
    expect(state.activeFilePath).toBe('/work/b.md')
    expect(state.documentsByPath['/work/a.md'].saveStatus).toBe('saved')
    expect(state.documentsByPath['/work/b.md'].fileContent).toBe('saved b')
  })

  it('tracks reversible XLSX mutations in the shared document session', () => {
    addSpreadsheet()
    const state = useWriteWorkspaceStore.getState()
    state.setSpreadsheetMutations('/work/book.xlsx', [
      { kind: 'cell', sheetName: 'Data', address: 'A1', value: 'Local' }
    ])
    expect(useWriteWorkspaceStore.getState().documentsByPath['/work/book.xlsx']).toMatchObject({
      saveStatus: 'dirty',
      spreadsheetMutations: [{ kind: 'cell', sheetName: 'Data', address: 'A1', value: 'Local' }]
    })

    state.setSpreadsheetMutations('/work/book.xlsx', [])
    expect(useWriteWorkspaceStore.getState().documentsByPath['/work/book.xlsx']).toMatchObject({
      saveStatus: 'saved',
      spreadsheetMutations: []
    })
  })

  it('saves XLSX mutations with the source SHA and commits a new baseline revision', async () => {
    addSpreadsheet()
    const saveWorkspaceSpreadsheet = vi.fn(async () => ({
      ok: true as const,
      path: '/work/book.xlsx',
      sourceSha256: 'b'.repeat(64),
      size: 120,
      mtimeMs: 2,
      appliedMutations: 1
    }))
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined },
      confirm: () => true,
      kunGui: { writeWorkspaceFile: vi.fn(), saveWorkspaceSpreadsheet }
    })
    const state = useWriteWorkspaceStore.getState()
    state.setSpreadsheetMutations('/work/book.xlsx', [
      { kind: 'cell', sheetName: 'Data', address: 'A1', value: 42 }
    ])

    await expect(state.saveDocument('/work', '/work/book.xlsx')).resolves.toBe(true)
    expect(saveWorkspaceSpreadsheet).toHaveBeenCalledWith({
      path: '/work/book.xlsx',
      workspaceRoot: '/work',
      expectedSha256: 'a'.repeat(64),
      mutations: [{ kind: 'cell', sheetName: 'Data', address: 'A1', value: 42 }]
    })
    expect(useWriteWorkspaceStore.getState().documentsByPath['/work/book.xlsx']).toMatchObject({
      saveStatus: 'saved',
      spreadsheetMutations: [],
      spreadsheetSourceSha256: 'b'.repeat(64),
      spreadsheetCommitRevision: 1
    })
  })

  it('commits the active Univer cell before sending the exact save mutations', async () => {
    addSpreadsheet()
    const order: string[] = []
    registerWriteSpreadsheetEditor('/work/book.xlsx', {
      isFocused: () => true,
      setSaving: (saving) => order.push(saving ? 'lock' : 'unlock'),
      prepareSave: async () => {
        order.push('end-editing')
        return {
          token: 'snapshot-final',
          mutations: [{ kind: 'cell', sheetName: 'Data', address: 'A1', value: 'final cell value' }]
        }
      },
      commitSave: () => {
        order.push('commit-baseline')
        return { mutations: [] }
      }
    })
    const saveWorkspaceSpreadsheet = vi.fn(async () => {
      order.push('main-save')
      return {
        ok: true as const,
        path: '/work/book.xlsx', sourceSha256: 'b'.repeat(64), size: 120, mtimeMs: 2, appliedMutations: 1
      }
    })
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined },
      confirm: () => true,
      kunGui: { writeWorkspaceFile: vi.fn(), saveWorkspaceSpreadsheet }
    })
    useWriteWorkspaceStore.getState().setSpreadsheetMutations('/work/book.xlsx', [
      { kind: 'cell', sheetName: 'Data', address: 'A1', value: 'stale value' }
    ])

    await expect(useWriteWorkspaceStore.getState().saveDocument('/work', '/work/book.xlsx'))
      .resolves.toBe(true)
    expect(saveWorkspaceSpreadsheet).toHaveBeenCalledWith(expect.objectContaining({
      mutations: [{ kind: 'cell', sheetName: 'Data', address: 'A1', value: 'final cell value' }]
    }))
    expect(order).toEqual(['lock', 'end-editing', 'main-save', 'commit-baseline', 'unlock'])
    expect(useWriteWorkspaceStore.getState().documentsByPath['/work/book.xlsx']).toMatchObject({
      spreadsheetMutations: [], saveStatus: 'saved', spreadsheetSourceSha256: 'b'.repeat(64)
    })
  })

  it('keeps XLSX mutations dirty when saving fails', async () => {
    addSpreadsheet()
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined },
      confirm: () => true,
      kunGui: {
        writeWorkspaceFile: vi.fn(),
        saveWorkspaceSpreadsheet: vi.fn(async () => ({
          ok: false as const,
          code: 'source_changed' as const,
          message: 'Reload first.'
        }))
      }
    })
    const state = useWriteWorkspaceStore.getState()
    state.setSpreadsheetMutations('/work/book.xlsx', [
      { kind: 'cell', sheetName: 'Data', address: 'A1', value: 42 }
    ])
    await expect(state.saveDocument('/work', '/work/book.xlsx')).resolves.toBe(false)
    expect(useWriteWorkspaceStore.getState().documentsByPath['/work/book.xlsx']).toMatchObject({
      saveStatus: 'error',
      spreadsheetMutations: expect.arrayContaining([expect.objectContaining({ address: 'A1' })]),
      fileError: 'Reload first.'
    })
  })

  it('includes dirty XLSX sessions in save-all', async () => {
    addSpreadsheet()
    const writeWorkspaceFile = vi.fn(async () => ({
      ok: true as const, path: '/work/a.md', savedAt: '2026-08-20T00:00:00.000Z'
    }))
    const saveWorkspaceSpreadsheet = vi.fn(async () => ({
      ok: true as const,
      path: '/work/book.xlsx', sourceSha256: 'b'.repeat(64), size: 120, mtimeMs: 2, appliedMutations: 1
    }))
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined },
      confirm: () => true,
      kunGui: { writeWorkspaceFile, saveWorkspaceSpreadsheet }
    })
    useWriteWorkspaceStore.getState().setSpreadsheetMutations('/work/book.xlsx', [
      { kind: 'cell', sheetName: 'Data', address: 'A1', value: 42 }
    ])
    await expect(useWriteWorkspaceStore.getState().saveAllDocuments('/work')).resolves.toBe(true)
    expect(writeWorkspaceFile).toHaveBeenCalledOnce()
    expect(saveWorkspaceSpreadsheet).toHaveBeenCalledOnce()
  })

  it('saves a dirty XLSX before releasing its last tab', async () => {
    addSpreadsheet()
    const saveWorkspaceSpreadsheet = vi.fn(async () => ({
      ok: true as const,
      path: '/work/book.xlsx', sourceSha256: 'b'.repeat(64), size: 120, mtimeMs: 2, appliedMutations: 1
    }))
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined },
      confirm: () => true,
      kunGui: { writeWorkspaceFile: vi.fn(), saveWorkspaceSpreadsheet }
    })
    const state = useWriteWorkspaceStore.getState()
    state.setSpreadsheetMutations('/work/book.xlsx', [
      { kind: 'cell', sheetName: 'Data', address: 'A1', value: 42 }
    ])
    await expect(state.closeTab('primary', '/work/book.xlsx')).resolves.toBe(true)
    expect(saveWorkspaceSpreadsheet).toHaveBeenCalledOnce()
    expect(useWriteWorkspaceStore.getState().documentsByPath['/work/book.xlsx']).toBeUndefined()
  })

  it('converts XLS to a sibling XLSX and opens the editable copy', async () => {
    const xls = createWriteDocumentSession({
      path: '/work/legacy.xls',
      kind: 'office',
      officePreview: {
        ok: true,
        path: '/work/legacy.xls',
        name: 'legacy.xls',
        sourceFormat: 'xls',
        renderFormat: 'xls',
        viewer: 'spreadsheet',
        size: 100,
        mtimeMs: 1,
        sourceSha256: 'c'.repeat(64),
        data: new Uint8Array([1])
      }
    })
    const refreshWorkspace = vi.fn(async () => undefined)
    const openFile = vi.fn(async () => undefined)
    const convertWorkspaceSpreadsheet = vi.fn(async () => ({
      ok: true as const,
      path: '/work/legacy.xlsx',
      name: 'legacy.xlsx',
      sourceSha256: 'd'.repeat(64),
      size: 120,
      mtimeMs: 2
    }))
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined },
      confirm: () => true,
      kunGui: { writeWorkspaceFile: vi.fn(), convertWorkspaceSpreadsheet }
    })
    useWriteWorkspaceStore.setState((state) => ({
      documentsByPath: { ...state.documentsByPath, [xls.path]: xls },
      refreshWorkspace,
      openFile
    }))

    await expect(useWriteWorkspaceStore.getState().convertSpreadsheet('/work', xls.path))
      .resolves.toBe('/work/legacy.xlsx')
    expect(convertWorkspaceSpreadsheet).toHaveBeenCalledWith({
      path: xls.path,
      workspaceRoot: '/work',
      expectedSha256: 'c'.repeat(64)
    })
    expect(refreshWorkspace).toHaveBeenCalledWith('/work')
    expect(openFile).toHaveBeenCalledWith('/work', '/work/legacy.xlsx')
    expect(useWriteWorkspaceStore.getState().documentsByPath[xls.path].officePreview?.sourceFormat).toBe('xls')
  })

  it('activates and closes a whiteboard tab without reading or deleting a file session', async () => {
    const board = {
      id: 'board-1',
      title: 'Review board',
      workspaceRoot: '/work',
      threadId: null,
      phase: 'blank' as const,
      revision: 0,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z'
    }
    useWriteWorkspaceStore.setState((state) => ({
      whiteboards: { [board.id]: board },
      editorLayout: {
        ...state.editorLayout,
        groups: [{
          ...state.editorLayout.groups[0],
          tabs: [
            ...state.editorLayout.groups[0].tabs,
            { kind: 'whiteboard', boardId: board.id, viewMode: 'rich' }
          ]
        }]
      }
    }))

    useWriteWorkspaceStore.getState().activateTab('primary', 'whiteboard:board-1')
    let state = useWriteWorkspaceStore.getState()
    expect(state.activeWhiteboardId).toBe('board-1')
    expect(state.activeFilePath).toBeNull()
    expect(Object.keys(state.documentsByPath)).toEqual(['/work/a.md', '/work/b.md'])

    await expect(state.closeTab('primary', 'whiteboard:board-1')).resolves.toBe(true)
    state = useWriteWorkspaceStore.getState()
    expect(state.activeWhiteboardId).toBeNull()
    expect(state.activeFilePath).toBe('/work/b.md')
    expect(state.whiteboards['board-1']).toBe(board)
    expect(Object.keys(state.documentsByPath)).toEqual(['/work/a.md', '/work/b.md'])
  })

  it('moves a typed whiteboard item between groups without creating a pseudo document', () => {
    useWriteWorkspaceStore.setState((state) => ({
      editorLayout: {
        ...state.editorLayout,
        orientation: 'horizontal',
        groups: [
          {
            id: 'primary',
            activePath: 'whiteboard:board-1',
            tabs: [{ kind: 'whiteboard', boardId: 'board-1', viewMode: 'rich' }]
          },
          {
            id: 'secondary',
            activePath: '/work/b.md',
            tabs: [{ path: '/work/b.md', viewMode: 'preview' }]
          }
        ]
      }
    }))

    useWriteWorkspaceStore.getState().moveTab(
      'whiteboard:board-1',
      'primary',
      'secondary',
      0
    )
    const state = useWriteWorkspaceStore.getState()
    expect(state.editorLayout.focusedGroupId).toBe('secondary')
    expect(state.editorLayout.groups[0]).toMatchObject({ tabs: [], activePath: null })
    expect(state.editorLayout.groups[1]).toMatchObject({
      activePath: 'whiteboard:board-1',
      tabs: [
        { kind: 'whiteboard', boardId: 'board-1' },
        { path: '/work/b.md' }
      ]
    })
    expect(state.activeWhiteboardId).toBe('board-1')
    expect(state.documentsByPath['whiteboard:board-1']).toBeUndefined()
  })
})
