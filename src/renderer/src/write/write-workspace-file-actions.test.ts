import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultWriteSettings } from '@shared/app-settings'
import { createWriteFileActions } from './write-workspace-file-actions'
import { initialState } from './write-workspace-store-helpers'
import type { WriteWorkspaceGet, WriteWorkspaceSet, WriteWorkspaceState } from './write-workspace-store-types'

function makeBaseState(): WriteWorkspaceState {
  return {
    defaultWorkspaceRoot: '',
    workspaceRoots: [],
    autoSaveEnabled: true,
    autoSaveDelayMs: defaultWriteSettings().autoSaveDelayMs,
    inlineCompletion: defaultWriteSettings().inlineCompletion,
    inlineCompletionApiReady: false,
    selectionAssist: defaultWriteSettings().selectionAssist,
    agentPresets: defaultWriteSettings().agentPresets,
    imageGenReady: false,
    prototypeReady: false,
    settingsLoading: false,
    settingsError: null,
    ...initialState(),
    previewMode: 'live',
    assistantOpen: true,
    assistantModel: 'auto',
    assistantProviderId: '',
    assistantAgentPresetId: '',
    loadWriteSettings: async () => undefined,
    selectWriteWorkspace: async () => undefined,
    addWriteWorkspace: async () => undefined,
    removeWriteWorkspace: async () => undefined,
    initializeWorkspace: async () => undefined,
    loadDirectory: async () => null,
    toggleDirectory: async () => undefined,
    refreshWorkspace: async () => undefined,
    openFile: async () => undefined,
    setFileContent: () => undefined,
    syncActiveFileFromDisk: async () => false,
    syncActiveImageFromDisk: async () => false,
    flushSave: async () => true,
    prepareActiveFileForAssistant: async () => true,
    createFile: async () => null,
    createDirectory: async () => null,
    renameEntry: async () => null,
    deleteEntry: async () => false,
    setFileError: () => undefined,
    setPreviewMode: () => undefined,
    setAssistantOpen: () => undefined,
    setAssistantModel: () => undefined,
    setAssistantAgentPresetId: () => undefined,
    setReviewActive: () => undefined,
    clearPendingAgentReview: () => undefined,
    setSelection: () => undefined,
    recordRecentEdits: () => undefined,
    quoteCurrentSelection: () => undefined,
    removeQuotedSelection: () => undefined,
    clearQuotedSelections: () => undefined,
    resetWorkspace: () => undefined
  }
}

function createHarness(): {
  actions: ReturnType<typeof createWriteFileActions>
  get: WriteWorkspaceGet
  set: WriteWorkspaceSet
} {
  let state = makeBaseState()
  const set: WriteWorkspaceSet = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
  }
  const get: WriteWorkspaceGet = () => state
  const actions = createWriteFileActions({
    set,
    get,
    cancelExternalSyncAnimation: vi.fn(),
    setLastSavedContent: vi.fn()
  })
  state = { ...state, ...actions }
  return { actions, get, set }
}

function installDsGui(overrides: Partial<Window['kunGui']>): void {
  vi.stubGlobal('window', {
    kunGui: overrides
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('write workspace file actions', () => {
  it('refreshes an initialized workspace without resetting the active draft', async () => {
    const listWorkspaceDirectory = vi.fn(async () => ({
      ok: true as const,
      root: '/tmp/write',
      entries: [{
        name: 'new.md',
        path: '/tmp/write/new.md',
        type: 'file' as const,
        ext: '.md'
      }]
    }))
    installDsGui({ listWorkspaceDirectory })
    const { actions, get, set } = createHarness()
    set({
      workspaceRoot: '/tmp/write',
      rootDirectory: '/tmp/write',
      expandedDirs: new Set(['/tmp/write']),
      activeFilePath: '/tmp/write/draft.md',
      fileContent: 'unsaved draft',
      saveStatus: 'dirty'
    })

    await actions.initializeWorkspace('/tmp/write')

    expect(listWorkspaceDirectory).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/write',
      path: '/tmp/write'
    })
    expect(get().entriesByDir['/tmp/write']).toEqual([
      expect.objectContaining({ name: 'new.md' })
    ])
    expect(get()).toMatchObject({
      activeFilePath: '/tmp/write/draft.md',
      fileContent: 'unsaved draft',
      saveStatus: 'dirty'
    })
  })

  it('clears loading state and records list errors when directory IPC throws', async () => {
    installDsGui({
      listWorkspaceDirectory: vi.fn(async () => {
        throw new Error('bridge down')
      })
    })
    const { actions, get } = createHarness()

    const result = await actions.loadDirectory('/tmp/write')

    expect(result).toBeNull()
    expect(get().loadingDirs).toEqual({})
    expect(get().treeError).toBe('bridge down')
  })

  it('returns null and reports file errors when create file IPC throws', async () => {
    installDsGui({
      createWorkspaceFile: vi.fn(async () => {
        throw new Error('create failed')
      })
    })
    const { actions, get } = createHarness()

    const result = await actions.createFile('/tmp/write', 'draft.md')

    expect(result).toBeNull()
    expect(get().fileError).toBe('create failed')
  })

  it('returns null and reports file errors when rename IPC throws', async () => {
    installDsGui({
      renameWorkspaceEntry: vi.fn(async () => {
        throw new Error('rename failed')
      })
    })
    const { actions, get } = createHarness()

    const result = await actions.renameEntry('/tmp/write', '/tmp/write/draft.md', 'final.md')

    expect(result).toBeNull()
    expect(get().fileError).toBe('rename failed')
  })

  it('keeps dirty content when auto-save is disabled and file navigation is cancelled', async () => {
    const readWorkspaceFile = vi.fn()
    const confirm = vi.fn(() => false)
    vi.stubGlobal('window', {
      kunGui: { readWorkspaceFile },
      confirm
    })
    const { actions, get, set } = createHarness()
    const flushSave = vi.fn(async () => true)
    set({
      autoSaveEnabled: false,
      activeFilePath: '/tmp/write/draft.md',
      activeFileKind: 'text',
      fileContent: 'unsaved draft',
      saveStatus: 'dirty',
      flushSave
    })

    await actions.openFile('/tmp/write', '/tmp/write/next.md')

    expect(confirm).toHaveBeenCalled()
    expect(flushSave).not.toHaveBeenCalled()
    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(get()).toMatchObject({
      activeFilePath: '/tmp/write/draft.md',
      fileContent: 'unsaved draft',
      saveStatus: 'dirty'
    })
  })

  it('opens another text file without saving dirty content when auto-save is disabled and discard is confirmed', async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/write/next.md',
      content: 'next content',
      size: 12,
      truncated: false
    }))
    const confirm = vi.fn(() => true)
    vi.stubGlobal('window', {
      kunGui: { readWorkspaceFile },
      confirm
    })
    const { actions, get, set } = createHarness()
    const flushSave = vi.fn(async () => true)
    set({
      autoSaveEnabled: false,
      activeFilePath: '/tmp/write/draft.md',
      activeFileKind: 'text',
      fileContent: 'unsaved draft',
      saveStatus: 'dirty',
      flushSave
    })

    await actions.openFile('/tmp/write', '/tmp/write/next.md')

    expect(confirm).toHaveBeenCalled()
    expect(flushSave).not.toHaveBeenCalled()
    expect(readWorkspaceFile).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/write',
      path: '/tmp/write/next.md'
    })
    expect(get()).toMatchObject({
      activeFilePath: '/tmp/write/next.md',
      fileContent: 'next content',
      saveStatus: 'saved'
    })
  })

  it('keeps markdown files visible when renaming without an extension', async () => {
    const renameWorkspaceEntry = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/write/final.md',
      previousPath: '/tmp/write/draft.md',
      renamedAt: '2026-06-21T00:00:00.000Z'
    }))
    installDsGui({
      renameWorkspaceEntry,
      listWorkspaceDirectory: vi.fn(async () => ({
        ok: true as const,
        root: '/tmp/write',
        entries: [{
          name: 'final.md',
          path: '/tmp/write/final.md',
          type: 'file' as const,
          ext: '.md'
        }]
      }))
    })
    const { actions } = createHarness()

    const result = await actions.renameEntry('/tmp/write', '/tmp/write/draft.md', 'final')

    expect(result).toBe('/tmp/write/final.md')
    expect(renameWorkspaceEntry).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/write',
      path: '/tmp/write/draft.md',
      newName: 'final.md'
    })
  })

  it('returns false and reports file errors when delete IPC throws', async () => {
    installDsGui({
      deleteWorkspaceEntry: vi.fn(async () => {
        throw new Error('delete failed')
      })
    })
    const { actions, get } = createHarness()

    const result = await actions.deleteEntry('/tmp/write', '/tmp/write/draft.md')

    expect(result).toBe(false)
    expect(get().fileError).toBe('delete failed')
  })

  it('opens PDF files through the read-only PDF preview state', async () => {
    const readWorkspacePdf = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/write/papers/study.pdf',
      dataBase64: 'JVBERi0xLjQKJSVFT0Y=',
      mimeType: 'application/pdf' as const,
      size: 14,
      mtimeMs: 1234
    }))
    installDsGui({
      readWorkspacePdf
    })
    const { actions, get } = createHarness()

    await actions.openFile('/tmp/write', '/tmp/write/papers/study.pdf')

    expect(readWorkspacePdf).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/write',
      path: '/tmp/write/papers/study.pdf'
    })
    expect(get().activeFileKind).toBe('pdf')
    expect(get().activeFilePath).toBe('/tmp/write/papers/study.pdf')
    expect(get().pdfDataBase64).toBe('JVBERi0xLjQKJSVFT0Y=')
    expect(get().pdfMimeType).toBe('application/pdf')
    expect(get().fileSize).toBe(14)
    expect(get().pdfMtimeMs).toBe(1234)
    expect(get().fileContent).toBe('')
    expect(get().imageDataUrl).toBe('')
  })
})
