import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesignSettings, type AppSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useDesignWorkspaceStore } from './design-workspace-store'
import {
  flushPendingDocumentsIndexes,
  persistDocumentsIndex
} from './design-document-persistence'
import { flushDesignPersistenceQueue } from './design-persistence-coordinator'
import type { DesignArtifact, DesignDocument } from './design-types'

const createdAt = '2026-06-20T00:00:00.000Z'

type WriteWorkspaceFileRequest = {
  path: string
  workspaceRoot?: string
  content: string
}

function artifact(id: string, kind: DesignArtifact['kind']): DesignArtifact {
  const relativePath =
    kind === 'canvas' ? `.kun-design/doc/${id}/canvas.json` : `.kun-design/doc/${id}/v1.html`
  return {
    id,
    kind,
    title: id,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${id}-v1`, relativePath, createdAt, summary: '' }]
  }
}

function settingsWithDesign(
  design: Partial<ReturnType<typeof defaultDesignSettings>> = {}
): AppSettingsV1 {
  return {
    design: { ...defaultDesignSettings(), ...design }
  } as AppSettingsV1
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function stubLocalStorage() {
  const storage = new Map<string, string>()
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key)
    })
  }
  vi.stubGlobal('localStorage', localStorage)
  return { storage, localStorage }
}

describe('design workspace store', () => {
  const writeWorkspaceFile = vi.fn(async (_request: WriteWorkspaceFileRequest) => ({ ok: true as const }))

  beforeEach(() => {
    writeWorkspaceFile.mockClear()
    vi.stubGlobal('window', {
      kunGui: {
        writeWorkspaceFile,
        deleteWorkspaceEntry: vi.fn(async () => ({
          ok: true as const,
          path: '/workspace/.kun-design/deleted',
          deletedAt: '2026-07-01T00:00:00.000Z'
        }))
      }
    })
    const canvas = artifact('canvas', 'canvas')
    const screen = artifact('screen', 'html')
    const doc: DesignDocument = {
      id: 'doc',
      title: 'Doc',
      createdAt,
      updatedAt: createdAt,
      order: 0,
      artifacts: [canvas, screen],
      activeArtifactId: canvas.id
    }
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      documents: [doc],
      workspaceFolders: [],
      activeDocumentId: 'doc',
      drawingCreationOpen: false,
      drawingCreationReturnDocumentId: null,
      drawingCreationDocumentId: null,
      drawingCreationSubmitting: false,
      drawingCreationFolderId: null,
      drawingHistoryMutation: null,
      artifacts: [canvas, screen],
      activeArtifactId: canvas.id,
      designIntentMode: 'modify',
      designContext: { designTarget: 'web' },
      fileError: null
    })
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })


  it('createDocument adds a new active 设计稿 with an empty projection', () => {
    const id = useDesignWorkspaceStore.getState().createDocument('Second')
    const state = useDesignWorkspaceStore.getState()
    expect(state.documents).toHaveLength(2)
    expect(state.activeDocumentId).toBe(id)
    expect(state.documents.find((d) => d.id === id)?.title).toBe('Second')
    expect(state.artifacts).toEqual([])
    expect(state.activeArtifactId).toBeNull()
  })

  it('creates an Excalidraw drawing and refuses engine switches after HTML exists', () => {
    const id = useDesignWorkspaceStore.getState().createDocument('Sketch', { engine: 'excalidraw' })
    expect(useDesignWorkspaceStore.getState().documents.find((document) => document.id === id)?.engine)
      .toBe('excalidraw')
    expect(useDesignWorkspaceStore.getState().setDocumentEngine(id, 'kun')).toBe(true)
    expect(useDesignWorkspaceStore.getState().documents.find((document) => document.id === id)?.engine)
      .toBeUndefined()
    expect(useDesignWorkspaceStore.getState().setDocumentEngine('doc', 'excalidraw')).toBe(false)
  })

  it('marks explicit drawing renames so legacy-title backfill cannot overwrite them', () => {
    useDesignWorkspaceStore.getState().renameDocument('doc', '我的设计')
    expect(useDesignWorkspaceStore.getState().documents[0]).toMatchObject({
      title: '我的设计',
      titleOrigin: 'user'
    })
  })

  it('allows only one in-flight submission from the drawing launcher', () => {
    const state = useDesignWorkspaceStore.getState()
    state.beginDrawingCreation()

    expect(useDesignWorkspaceStore.getState().beginDrawingSubmission()).toBe(true)
    expect(useDesignWorkspaceStore.getState().beginDrawingSubmission()).toBe(false)
    expect(useDesignWorkspaceStore.getState().drawingCreationSubmitting).toBe(true)

    const provisionalId = useDesignWorkspaceStore
      .getState()
      .createDocument('Provisional', { transient: true })
    useDesignWorkspaceStore.getState().beginDrawingCreation()
    expect(useDesignWorkspaceStore.getState().activeDocumentId).toBe(provisionalId)
    expect(useDesignWorkspaceStore.getState().drawingCreationSubmitting).toBe(true)

    useDesignWorkspaceStore.getState().endDrawingSubmission()
    expect(useDesignWorkspaceStore.getState().beginDrawingSubmission()).toBe(true)

    useDesignWorkspaceStore.getState().cancelDrawingCreation()
    expect(useDesignWorkspaceStore.getState().drawingCreationSubmitting).toBe(false)
    expect(useDesignWorkspaceStore.getState().activeDocumentId).toBe('doc')
    expect(useDesignWorkspaceStore.getState().drawingCreationDocumentId).toBe(provisionalId)

    useDesignWorkspaceStore.getState().beginDrawingCreation()
    expect(useDesignWorkspaceStore.getState().activeDocumentId).toBe(provisionalId)
  })

  it('serializes destructive history operations per drawing', () => {
    const state = useDesignWorkspaceStore.getState()
    expect(state.beginDrawingHistoryMutation('/workspace/', 'doc', 'clear')).toBe(true)
    expect(useDesignWorkspaceStore.getState().beginDrawingHistoryMutation(
      '/workspace',
      'doc',
      'delete'
    )).toBe(false)
    expect(useDesignWorkspaceStore.getState().drawingHistoryMutation).toEqual({
      workspaceRoot: '/workspace',
      documentId: 'doc',
      kind: 'clear'
    })
    useDesignWorkspaceStore.getState().endDrawingHistoryMutation('/different', 'doc')
    expect(useDesignWorkspaceStore.getState().drawingHistoryMutation).not.toBeNull()
    useDesignWorkspaceStore.getState().endDrawingHistoryMutation('/workspace', 'doc')
    expect(useDesignWorkspaceStore.getState().drawingHistoryMutation).toBeNull()
  })

  it('keeps a provisional drawing out of the durable index until commit', async () => {
    useDesignWorkspaceStore.getState().beginDrawingCreation()
    useDesignWorkspaceStore.getState().renameDocument('doc', 'Renamed while drafting')
    await flushDesignPersistenceQueue('/workspace')
    const launcherIndexWrite = writeWorkspaceFile.mock.calls
      .map(([request]) => request)
      .reverse()
      .find((request) => request.path === '.kun-design/documents.json')
    expect(JSON.parse(launcherIndexWrite?.content ?? '{}')).toMatchObject({
      activeDocumentId: 'doc',
      documents: [{ id: 'doc', title: 'Renamed while drafting' }]
    })

    writeWorkspaceFile.mockClear()
    expect(useDesignWorkspaceStore.getState().beginDrawingSubmission()).toBe(true)
    const provisionalId = useDesignWorkspaceStore
      .getState()
      .createDocument('Travel dashboard', { transient: true })

    await flushPendingDocumentsIndexes('/workspace')
    await flushDesignPersistenceQueue('/workspace')
    const pendingIndexWrite = writeWorkspaceFile.mock.calls
      .map(([request]) => request)
      .reverse()
      .find((request) => request.path === '.kun-design/documents.json')
    expect(JSON.parse(pendingIndexWrite?.content ?? '{}')).toMatchObject({
      activeDocumentId: 'doc',
      documents: [{ id: 'doc' }]
    })

    writeWorkspaceFile.mockClear()
    useDesignWorkspaceStore.getState().finishDrawingCreation(provisionalId)
    await flushDesignPersistenceQueue('/workspace')
    const committedIndexWrite = writeWorkspaceFile.mock.calls
      .map(([request]) => request)
      .reverse()
      .find((request) => request.path === '.kun-design/documents.json')
    expect(JSON.parse(committedIndexWrite?.content ?? '{}')).toMatchObject({
      activeDocumentId: provisionalId,
      documents: [{ id: 'doc' }, { id: provisionalId, title: 'Travel dashboard' }]
    })
  })

  it('uses the generated ID as the default new 设计稿 title', () => {
    const id = useDesignWorkspaceStore.getState().createDocument()

    expect(useDesignWorkspaceStore.getState().documents.find((doc) => doc.id === id)?.title).toBe(id)
  })

  it('creates the physical ID directory for a new 设计稿', async () => {
    const createWorkspaceDirectory = vi.fn(async (request: { path: string; workspaceRoot: string }) => ({
      ok: true as const,
      path: request.path,
      createdAt
    }))
    vi.stubGlobal('window', {
      kunGui: { writeWorkspaceFile, createWorkspaceDirectory }
    })

    const id = useDesignWorkspaceStore.getState().createDocument('Second')
    await vi.waitFor(() => {
      expect(createWorkspaceDirectory).toHaveBeenCalledTimes(2)
    })

    expect(createWorkspaceDirectory).toHaveBeenCalledWith({ path: '.kun-design', workspaceRoot: '/workspace' })
    expect(createWorkspaceDirectory).toHaveBeenCalledWith({ path: `.kun-design/${id}`, workspaceRoot: '/workspace' })
  })

  it('opens the canvas assistant by default unless the user collapsed it', async () => {
    const { storage, localStorage } = stubLocalStorage()
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile }, localStorage })

    vi.resetModules()
    const { useDesignWorkspaceStore: freshStore } = await import('./design-workspace-store')

    expect(freshStore.getState().canvasAssistantOpen).toBe(true)

    freshStore.getState().setCanvasAssistantOpen(false)
    expect(storage.get('kun.design.canvasAssistantOpen.v1')).toBe('0')

    vi.resetModules()
    const { useDesignWorkspaceStore: collapsedStore } = await import('./design-workspace-store')

    expect(collapsedStore.getState().canvasAssistantOpen).toBe(false)
  })

  it('toggles the canvas assistant open state and persists the collapsed mirror key', () => {
    const { storage, localStorage } = stubLocalStorage()
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile }, localStorage })
    useDesignWorkspaceStore.setState({ canvasAssistantOpen: true, aiRailCollapsed: false })

    useDesignWorkspaceStore.getState().toggleCanvasAssistantOpen()

    expect(useDesignWorkspaceStore.getState().canvasAssistantOpen).toBe(false)
    expect(useDesignWorkspaceStore.getState().aiRailCollapsed).toBe(true)
    expect(storage.get('kun.design.canvasAssistantOpen.v1')).toBe('0')
    expect(storage.get('kun.design.aiRailCollapsed.v1')).toBe('1')

    useDesignWorkspaceStore.getState().toggleCanvasAssistantOpen()

    expect(useDesignWorkspaceStore.getState().canvasAssistantOpen).toBe(true)
    expect(useDesignWorkspaceStore.getState().aiRailCollapsed).toBe(false)
    expect(storage.get('kun.design.canvasAssistantOpen.v1')).toBe('1')
    expect(storage.get('kun.design.aiRailCollapsed.v1')).toBe('0')
  })

  it('new 画布 nest under the active 设计稿 directory', () => {
    const id = useDesignWorkspaceStore.getState().createDocument('Second')
    const { artifactId, relativePath } = useDesignWorkspaceStore.getState().prepareHtmlTurn('A landing page')
    expect(relativePath).toBe(`.kun-design/${id}/${artifactId}/v1.html`)
    expect(useDesignWorkspaceStore.getState().artifacts.map((a) => a.id)).toContain(artifactId)
  })

  it('switchActiveDocument re-projects to the target 设计稿', () => {
    const second = useDesignWorkspaceStore.getState().createDocument('Second')
    useDesignWorkspaceStore.getState().switchActiveDocument('doc')
    expect(useDesignWorkspaceStore.getState().artifacts.map((a) => a.id).sort()).toEqual(['canvas', 'screen'])
    useDesignWorkspaceStore.getState().switchActiveDocument(second)
    expect(useDesignWorkspaceStore.getState().artifacts).toEqual([])
  })

  it('keeps a user-created empty 设计稿 when rehydration reads a stale index', async () => {
    const second = useDesignWorkspaceStore.getState().createDocument('Second')
    const documentsIndex = JSON.stringify({
      version: 1,
      activeDocumentId: 'doc',
      documents: [
        {
          id: 'doc',
          title: 'Doc',
          order: 0,
          createdAt,
          updatedAt: createdAt,
          activeArtifactId: 'canvas'
        }
      ]
    })
    const readWorkspaceFile = vi.fn((request: { path: string }) => {
      if (request.path === '.kun-design/documents.json') {
        return Promise.resolve({ ok: true as const, content: documentsIndex })
      }
      return Promise.resolve({ ok: false as const, error: 'missing' })
    })
    const listWorkspaceDirectory = vi.fn(async (request: { path: string }) => {
      if (request.path === '.kun-design') {
        return {
          ok: true as const,
          entries: [{ name: 'doc', type: 'directory' as const }]
        }
      }
      return { ok: true as const, entries: [] as Array<{ name: string; type: 'file' | 'directory' }> }
    })
    vi.stubGlobal('window', {
      kunGui: { writeWorkspaceFile, readWorkspaceFile, listWorkspaceDirectory }
    })

    await useDesignWorkspaceStore.getState().rehydrateArtifacts()

    const state = useDesignWorkspaceStore.getState()
    expect(state.documents.map((doc) => doc.id)).toContain(second)
    expect(state.documents.find((doc) => doc.id === second)?.artifacts).toEqual([])
    expect(state.activeDocumentId).toBe(second)
  })

  it('removeDocument drops it and falls back to a remaining 设计稿', async () => {
    const second = useDesignWorkspaceStore.getState().createDocument('Second')
    await expect(useDesignWorkspaceStore.getState().removeDocument(second)).resolves.toBe(true)
    const state = useDesignWorkspaceStore.getState()
    expect(state.documents.map((d) => d.id)).toEqual(['doc'])
    expect(state.activeDocumentId).toBe('doc')
    expect(state.artifacts.map((a) => a.id).sort()).toEqual(['canvas', 'screen'])
  })

  it('keeps a legacy untitled drawing eligible for backfill after a blank rename', () => {
    useDesignWorkspaceStore.setState((state) => ({
      documents: state.documents.map((document) =>
        document.id === 'doc'
          ? { ...document, title: document.id, titleOrigin: undefined }
          : document
      )
    }))

    useDesignWorkspaceStore.getState().renameDocument('doc', '   ')

    expect(useDesignWorkspaceStore.getState().documents[0]).toMatchObject({
      id: 'doc',
      title: 'doc'
    })
    expect(useDesignWorkspaceStore.getState().documents[0].titleOrigin).toBeUndefined()
  })

  it('keeps a drawing in memory when its directory cannot be deleted', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        writeWorkspaceFile,
        deleteWorkspaceEntry: vi.fn(async () => ({
          ok: false as const,
          message: 'EACCES: permission denied'
        }))
      }
    })

    await expect(useDesignWorkspaceStore.getState().removeDocument('doc')).resolves.toBe(false)

    expect(useDesignWorkspaceStore.getState().documents.map((document) => document.id))
      .toContain('doc')
  })

  it('persists an explicit empty index after deleting the last drawing', async () => {
    await expect(useDesignWorkspaceStore.getState().removeDocument('doc')).resolves.toBe(true)
    await flushDesignPersistenceQueue('/workspace')

    expect(useDesignWorkspaceStore.getState()).toMatchObject({
      documents: [],
      activeDocumentId: null,
      artifacts: [],
      activeArtifactId: null
    })
    const indexWrite = writeWorkspaceFile.mock.calls
      .map(([request]) => request)
      .reverse()
      .find((request) => request.path === '.kun-design/documents.json')
    expect(JSON.parse(indexWrite?.content ?? '{}')).toEqual({
      version: 1,
      activeDocumentId: null,
      documents: []
    })
  })

  it('overwrites a stale index write queued while drawing deletion is in flight', async () => {
    const deletion = deferred<{
      ok: true
      path: string
      deletedAt: string
    }>()
    const deleteWorkspaceEntry = vi.fn(() => deletion.promise)
    vi.stubGlobal('window', {
      kunGui: { writeWorkspaceFile, deleteWorkspaceEntry }
    })

    const removal = useDesignWorkspaceStore.getState().removeDocument('doc')
    await vi.waitFor(() => expect(deleteWorkspaceEntry).toHaveBeenCalledTimes(1))

    const staleState = useDesignWorkspaceStore.getState()
    persistDocumentsIndex(
      staleState.workspaceRoot,
      staleState.documents,
      staleState.activeDocumentId
    )
    deletion.resolve({
      ok: true,
      path: '/workspace/.kun-design/doc',
      deletedAt: '2026-07-01T00:00:00.000Z'
    })

    await expect(removal).resolves.toBe(true)
    await flushPendingDocumentsIndexes('/workspace')
    await flushDesignPersistenceQueue('/workspace')

    const indexWrites = writeWorkspaceFile.mock.calls
      .map(([request]) => request)
      .filter((request) => request.path === '.kun-design/documents.json')
    expect(JSON.parse(indexWrites.at(-1)?.content ?? '{}')).toEqual({
      version: 1,
      activeDocumentId: null,
      documents: []
    })
  })

  it('keeps settings unloaded until existing design documents are rehydrated', async () => {
    const indexRead = deferred<{ ok: true; content: string }>()
    const documentsIndex = JSON.stringify({
      version: 1,
      activeDocumentId: 'existing-doc',
      documents: [
        {
          id: 'existing-doc',
          title: 'Existing design',
          order: 0,
          createdAt,
          updatedAt: createdAt,
          activeArtifactId: null
        }
      ]
    })
    const readWorkspaceFile = vi.fn((request: { path: string }) => {
      if (request.path === '.kun-design/documents.json') return indexRead.promise
      return Promise.resolve({ ok: false as const, error: 'missing' })
    })
    const listWorkspaceDirectory = vi.fn(async () => ({
      ok: true as const,
      entries: [] as Array<{ name: string; type: 'file' | 'directory' }>
    }))
    vi.spyOn(rendererRuntimeClient, 'getSettings').mockResolvedValue(
      settingsWithDesign({ defaultWorkspaceRoot: '/workspace' })
    )
    vi.stubGlobal('window', {
      kunGui: { writeWorkspaceFile, readWorkspaceFile, listWorkspaceDirectory }
    })
    useDesignWorkspaceStore.setState({
      workspaceRoot: '',
      documents: [],
      activeDocumentId: null,
      artifacts: [],
      activeArtifactId: null,
      settingsLoaded: true,
      designSystemHash: '',
      fileError: null
    })

    const loading = useDesignWorkspaceStore.getState().loadDesignSettings()
    await Promise.resolve()
    await Promise.resolve()

    expect(useDesignWorkspaceStore.getState().settingsLoaded).toBe(false)

    indexRead.resolve({ ok: true, content: documentsIndex })
    await loading

    const state = useDesignWorkspaceStore.getState()
    expect(state.settingsLoaded).toBe(true)
    expect(state.activeDocumentId).toBe('existing-doc')
    expect(state.documents.map((doc) => ({ id: doc.id, title: doc.title }))).toEqual([
      { id: 'existing-doc', title: 'Existing design' }
    ])
  })

  it('keeps a fresh workspace empty instead of auto-creating a drawing', async () => {
    const readWorkspaceFile = vi.fn(async () => ({ ok: false as const, error: 'missing' }))
    const listWorkspaceDirectory = vi.fn(async () => ({
      ok: true as const,
      entries: [] as Array<{ name: string; type: 'file' | 'directory' }>
    }))
    vi.spyOn(rendererRuntimeClient, 'getSettings').mockResolvedValue(
      settingsWithDesign({ defaultWorkspaceRoot: '/workspace' })
    )
    vi.stubGlobal('window', {
      kunGui: { writeWorkspaceFile, readWorkspaceFile, listWorkspaceDirectory }
    })
    useDesignWorkspaceStore.setState({
      workspaceRoot: '',
      documents: [],
      activeDocumentId: null,
      artifacts: [],
      activeArtifactId: null,
      settingsLoaded: true,
      designSystemHash: '',
      fileError: null
    })

    await useDesignWorkspaceStore.getState().loadDesignSettings()

    expect(useDesignWorkspaceStore.getState()).toMatchObject({
      settingsLoaded: true,
      documents: [],
      activeDocumentId: null,
      artifacts: [],
      activeArtifactId: null
    })
    expect(writeWorkspaceFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: '.kun-design/documents.json' })
    )
  })

  it('moves drawings between logical folders and promotes direct drawings when deleting a folder', () => {
    const store = useDesignWorkspaceStore.getState()
    const parentId = store.createWorkspaceFolder('Product')
    const childId = store.createWorkspaceFolder('Mobile', parentId)
    expect(parentId).toBeTruthy()
    expect(childId).toBeTruthy()

    store.moveDocument('doc', childId)
    expect(useDesignWorkspaceStore.getState().documents[0]).toMatchObject({
      id: 'doc',
      folderId: childId
    })

    useDesignWorkspaceStore.getState().removeWorkspaceFolder(childId ?? '')
    expect(useDesignWorkspaceStore.getState()).toMatchObject({
      workspaceFolders: [{ id: parentId, name: 'Product', parentId: null }],
      documents: [{ id: 'doc', folderId: parentId }]
    })
  })
})
