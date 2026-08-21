import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWriteFileActions } from './write-workspace-file-actions'
import type { WriteWorkspaceGet, WriteWorkspaceSet } from './write-workspace-store-types'
import {
  activeWriteThreadForWorkspace,
  emptyWriteThreadRegistry,
  markWriteThread,
  readWriteThreadRegistry,
  saveWriteThreadRegistry
} from './write-thread-registry'
import type { NormalizedThread } from '../agent/types'
import { createWriteDocumentSession, persistWriteEditorLayout } from './write-editor-layout'
import {
  makeWriteFileActionBaseState,
  MemoryStorage
} from './write-workspace-file-actions-test-support'

function writeThread(id: string, workspace: string): NormalizedThread {
  return {
    id,
    title: 'Write Assistant',
    updatedAt: '2026-07-11T00:00:00.000Z',
    model: 'auto',
    mode: 'agent',
    workspace
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function createHarness(): {
  actions: ReturnType<typeof createWriteFileActions>
  get: WriteWorkspaceGet
  set: WriteWorkspaceSet
} {
  let state = makeWriteFileActionBaseState()
  const set: WriteWorkspaceSet = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
  }
  const get: WriteWorkspaceGet = () => state
  const actions = createWriteFileActions({
    set,
    get,
    cancelExternalSyncAnimation: vi.fn()
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
  it('opens Office files as shared read-only sessions in the requested group', async () => {
    const result = {
      ok: true as const,
      path: '/tmp/write/deck.pptx',
      name: 'deck.pptx',
      sourceFormat: 'pptx' as const,
      renderFormat: 'pptx' as const,
      viewer: 'presentation' as const,
      size: 500,
      mtimeMs: 1,
      sourceSha256: 'a'.repeat(64),
      data: new Uint8Array([1, 2, 3])
    }
    const readWorkspaceOfficePreview = vi.fn(async () => result)
    installDsGui({ readWorkspaceOfficePreview })
    const { actions, get, set } = createHarness()
    set({ workspaceRoot: '/tmp/write' })

    await actions.openFile('/tmp/write', result.path)

    expect(readWorkspaceOfficePreview).toHaveBeenCalledWith({
      path: result.path,
      workspaceRoot: '/tmp/write'
    })
    expect(get()).toMatchObject({
      activeFilePath: result.path,
      activeFileKind: 'office',
      saveStatus: 'saved'
    })
    expect(get().documentsByPath[result.path]).toMatchObject({
      kind: 'office',
      officePreview: result,
      officeSemanticText: ''
    })
  })

  it('keeps normal multi-file navigation in one editor group', async () => {
    installDsGui({
      readWorkspaceFile: vi.fn(async ({ path }: { path: string }) => ({
        ok: true as const,
        path,
        content: path,
        size: path.length,
        truncated: false as const
      }))
    })
    const { actions, get, set } = createHarness()
    set({ workspaceRoot: '/tmp/write' })

    await actions.openFile('/tmp/write', '/tmp/write/a.md')
    await actions.openFile('/tmp/write', '/tmp/write/b.md')

    expect(get().editorLayout).toMatchObject({
      orientation: 'single',
      groups: [{
        id: 'primary',
        activePath: '/tmp/write/b.md',
        tabs: [{ path: '/tmp/write/a.md' }, { path: '/tmp/write/b.md' }]
      }]
    })
  })

  it('collapses a restored split when its secondary file no longer exists', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        listWorkspaceDirectory: vi.fn(async () => ({ ok: true as const, root: '/tmp/write', entries: [] })),
        readWorkspaceFile: vi.fn(async ({ path }: { path: string }) => path.endsWith('/a.md')
          ? { ok: true as const, path, content: 'a', size: 1, truncated: false as const }
          : { ok: false as const, message: 'missing' })
      }
    })
    persistWriteEditorLayout('/tmp/write', {
      version: 1,
      orientation: 'horizontal',
      ratio: 0.5,
      focusedGroupId: 'secondary',
      groups: [
        { id: 'primary', activePath: '/tmp/write/a.md', tabs: [{ path: '/tmp/write/a.md', viewMode: 'live' }] },
        { id: 'secondary', activePath: '/tmp/write/missing.md', tabs: [{ path: '/tmp/write/missing.md', viewMode: 'preview' }] }
      ]
    })
    const { actions, get } = createHarness()

    await actions.initializeWorkspace('/tmp/write')

    expect(get().editorLayout).toMatchObject({
      orientation: 'single',
      focusedGroupId: 'primary',
      groups: [{ id: 'primary', activePath: '/tmp/write/a.md' }]
    })
  })

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

  it('keeps the latest directory listing when responses finish out of order', async () => {
    const first = deferred<{
      ok: true
      root: string
      entries: Array<{ name: string; path: string; type: 'file'; ext: string }>
    }>()
    const second = deferred<{
      ok: true
      root: string
      entries: Array<{ name: string; path: string; type: 'file'; ext: string }>
    }>()
    installDsGui({
      listWorkspaceDirectory: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise)
    })
    const { actions, get, set } = createHarness()
    set({ workspaceRoot: '/tmp/write' })

    const olderLoad = actions.loadDirectory('/tmp/write', '/tmp/write')
    const latestLoad = actions.loadDirectory('/tmp/write', '/tmp/write')
    second.resolve({
      ok: true,
      root: '/tmp/write',
      entries: [{ name: 'latest.md', path: '/tmp/write/latest.md', type: 'file', ext: '.md' }]
    })
    await latestLoad
    first.resolve({
      ok: true,
      root: '/tmp/write',
      entries: [{ name: 'stale.md', path: '/tmp/write/stale.md', type: 'file', ext: '.md' }]
    })
    await olderLoad

    expect(get().entriesByDir['/tmp/write']?.map((entry) => entry.name)).toEqual(['latest.md'])
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

  it('keeps a dirty document session while opening another tab with auto-save disabled', async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/write/next.md',
      content: 'next content',
      size: 12,
      truncated: false
    }))
    const confirm = vi.fn(() => false)
    vi.stubGlobal('window', {
      kunGui: { readWorkspaceFile },
      confirm
    })
    const { actions, get, set } = createHarness()
    const flushSave = vi.fn(async () => true)
    set({
      autoSaveEnabled: false,
      workspaceRoot: '/tmp/write',
      activeFilePath: '/tmp/write/draft.md',
      activeFileKind: 'text',
      fileContent: 'unsaved draft',
      persistedContent: 'saved draft',
      saveStatus: 'dirty',
      documentsByPath: {
        '/tmp/write/draft.md': createWriteDocumentSession({
          path: '/tmp/write/draft.md',
          kind: 'text',
          fileContent: 'unsaved draft',
          persistedContent: 'saved draft',
          saveStatus: 'dirty'
        })
      },
      editorLayout: {
        version: 1,
        orientation: 'single',
        ratio: 0.5,
        focusedGroupId: 'primary',
        groups: [{ id: 'primary', tabs: [{ path: '/tmp/write/draft.md', viewMode: 'live' }], activePath: '/tmp/write/draft.md' }]
      },
      flushSave
    })

    await actions.openFile('/tmp/write', '/tmp/write/next.md')

    expect(confirm).not.toHaveBeenCalled()
    expect(flushSave).not.toHaveBeenCalled()
    expect(readWorkspaceFile).toHaveBeenCalled()
    expect(get()).toMatchObject({
      activeFilePath: '/tmp/write/next.md',
      fileContent: 'next content'
    })
    expect(get().documentsByPath['/tmp/write/draft.md']).toMatchObject({
      fileContent: 'unsaved draft',
      saveStatus: 'dirty'
    })
  })

  it('starts a background save while opening another tab with auto-save enabled', async () => {
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
    const saveDocument = vi.fn(async () => true)
    set({
      autoSaveEnabled: true,
      workspaceRoot: '/tmp/write',
      activeFilePath: '/tmp/write/draft.md',
      activeFileKind: 'text',
      fileContent: 'unsaved draft',
      persistedContent: 'saved draft',
      saveStatus: 'dirty',
      documentsByPath: {
        '/tmp/write/draft.md': createWriteDocumentSession({
          path: '/tmp/write/draft.md',
          kind: 'text',
          fileContent: 'unsaved draft',
          persistedContent: 'saved draft',
          saveStatus: 'dirty'
        })
      },
      editorLayout: {
        version: 1,
        orientation: 'single',
        ratio: 0.5,
        focusedGroupId: 'primary',
        groups: [{ id: 'primary', tabs: [{ path: '/tmp/write/draft.md', viewMode: 'live' }], activePath: '/tmp/write/draft.md' }]
      },
      saveDocument
    })

    await actions.openFile('/tmp/write', '/tmp/write/next.md')

    expect(confirm).not.toHaveBeenCalled()
    expect(saveDocument).toHaveBeenCalledWith('/tmp/write', '/tmp/write/draft.md')
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
    const workspace = '/Users/zxy/write'
    const storage = new MemoryStorage()
    saveWriteThreadRegistry(markWriteThread(
      workspace,
      'thread-draft',
      emptyWriteThreadRegistry(),
      `${workspace}/draft.md`
    ), storage)
    const renameWorkspaceEntry = vi.fn(async () => ({
      ok: true as const,
      path: `${workspace}/final.md`,
      previousPath: `${workspace}/draft.md`,
      renamedAt: '2026-06-21T00:00:00.000Z'
    }))
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        renameWorkspaceEntry,
        listWorkspaceDirectory: vi.fn(async () => ({
          ok: true as const,
          root: workspace,
          entries: [{
            name: 'final.md',
            path: `${workspace}/final.md`,
            type: 'file' as const,
            ext: '.md'
          }]
        }))
      }
    })
    const { actions } = createHarness()

    const result = await actions.renameEntry(workspace, `${workspace}/draft.md`, 'final')

    expect(result).toBe(`${workspace}/final.md`)
    expect(renameWorkspaceEntry).toHaveBeenCalledWith({
      workspaceRoot: workspace,
      path: `${workspace}/draft.md`,
      newName: 'final.md'
    })
    expect(activeWriteThreadForWorkspace(
      workspace,
      [writeThread('thread-draft', workspace)],
      readWriteThreadRegistry(storage),
      `${workspace}/final.md`
    )?.id).toBe('thread-draft')
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

  it('removes deleted file conversation mappings without deleting thread history', async () => {
    const workspace = '/Users/zxy/write'
    const storage = new MemoryStorage()
    saveWriteThreadRegistry(markWriteThread(
      workspace,
      'thread-draft',
      emptyWriteThreadRegistry(),
      `${workspace}/drafts/chapter.md`
    ), storage)
    vi.stubGlobal('window', {
      localStorage: storage,
      kunGui: {
        deleteWorkspaceEntry: vi.fn(async () => ({
          ok: true as const,
          path: `${workspace}/drafts`,
          deletedAt: '2026-07-11T00:00:00.000Z'
        })),
        listWorkspaceDirectory: vi.fn(async () => ({
          ok: true as const,
          root: workspace,
          entries: []
        }))
      }
    })
    const { actions } = createHarness()

    await expect(actions.deleteEntry(workspace, `${workspace}/drafts`)).resolves.toBe(true)

    const registry = readWriteThreadRegistry(storage)
    expect(activeWriteThreadForWorkspace(
      workspace,
      [writeThread('thread-draft', workspace)],
      registry,
      `${workspace}/drafts/chapter.md`
    )).toBeNull()
    expect(registry.workspaces[workspace].threadIds).toContain('thread-draft')
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

  it('keeps the latest file when earlier and later opens resolve out of order', async () => {
    const first = deferred<{
      ok: true
      path: string
      content: string
      size: number
      truncated: false
    }>()
    const second = deferred<{
      ok: true
      path: string
      content: string
      size: number
      truncated: false
    }>()
    const readWorkspaceFile = vi.fn(({ path }: { path: string }) =>
      path.endsWith('/a.md') ? first.promise : second.promise
    )
    installDsGui({ readWorkspaceFile })
    const { actions, get, set } = createHarness()
    set({ workspaceRoot: '/tmp/write' })

    const openA = actions.openFile('/tmp/write', '/tmp/write/a.md')
    const openB = actions.openFile('/tmp/write', '/tmp/write/b.md')
    second.resolve({
      ok: true,
      path: '/tmp/write/b.md',
      content: 'content B',
      size: 9,
      truncated: false
    })
    await openB
    first.resolve({
      ok: true,
      path: '/tmp/write/a.md',
      content: 'content A',
      size: 9,
      truncated: false
    })
    await openA

    expect(get()).toMatchObject({
      activeFilePath: '/tmp/write/b.md',
      fileContent: 'content B',
      persistedContent: 'content B',
      saveStatus: 'saved'
    })
  })

  it('allows independent editor groups to finish concurrent file loads', async () => {
    const first = deferred<{
      ok: true
      path: string
      content: string
      size: number
      truncated: false
    }>()
    const second = deferred<{
      ok: true
      path: string
      content: string
      size: number
      truncated: false
    }>()
    installDsGui({
      readWorkspaceFile: vi.fn(({ path }: { path: string }) =>
        path.endsWith('/a.md') ? first.promise : second.promise
      )
    })
    const { actions, get, set } = createHarness()
    set({
      workspaceRoot: '/tmp/write',
      editorLayout: {
        version: 1,
        orientation: 'horizontal',
        ratio: 0.5,
        focusedGroupId: 'primary',
        groups: [
          { id: 'primary', tabs: [], activePath: null },
          { id: 'secondary', tabs: [], activePath: null }
        ]
      }
    })

    const openA = actions.openFile('/tmp/write', '/tmp/write/a.md', { groupId: 'primary' })
    const openB = actions.openFile('/tmp/write', '/tmp/write/b.md', { groupId: 'secondary' })
    second.resolve({ ok: true, path: '/tmp/write/b.md', content: 'content B', size: 9, truncated: false })
    await openB
    first.resolve({ ok: true, path: '/tmp/write/a.md', content: 'content A', size: 9, truncated: false })
    await openA

    expect(get().documentsByPath).toMatchObject({
      '/tmp/write/a.md': { fileContent: 'content A' },
      '/tmp/write/b.md': { fileContent: 'content B' }
    })
    expect(get().editorLayout.groups).toEqual([
      expect.objectContaining({ id: 'primary', activePath: '/tmp/write/a.md' }),
      expect.objectContaining({ id: 'secondary', activePath: '/tmp/write/b.md' })
    ])
  })
})
