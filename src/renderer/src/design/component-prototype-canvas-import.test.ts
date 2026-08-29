import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentPrototypeMetadata } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useDesignWorkspaceStore } from './design-workspace-store'
import { importComponentPrototypeToDesignCanvas } from './component-prototype-canvas-import'
import { importConversationHtmlToDesignCanvas } from './conversation-html-canvas-import'

const prototype: ComponentPrototypeMetadata = {
  version: 1,
  status: 'completed',
  artifactId: 'component_date_picker',
  title: 'Date range picker',
  relativePath: '.kun-design/component-prototypes/date-picker/prototype.html',
  viewport: { width: 760, height: 520 },
  producer: 'component-designer',
  profile: 'component-designer'
}

const PROTOTYPE_HTML = '<!doctype html><html><body><button>Pick a date</button></body></html>'

type ReadRequest = { path: string; workspaceRoot?: string }
type WriteRequest = { path: string; workspaceRoot?: string; content: string }

function resetDesignStore(): void {
  useDesignWorkspaceStore.setState({
    workspaceRoot: '',
    documents: [],
    workspaceFolders: [],
    activeDocumentId: null,
    drawingCreationOpen: false,
    drawingCreationReturnDocumentId: null,
    drawingCreationDocumentId: null,
    drawingCreationSubmitting: false,
    drawingCreationFolderId: null,
    drawingHistoryMutation: null,
    artifacts: [],
    activeArtifactId: null,
    designIntentMode: 'generate',
    designContext: { designTarget: 'web' },
    fileError: null,
    settingsLoaded: false,
    pagesRun: null,
    parallelPageStates: {}
  })
}

describe('importComponentPrototypeToDesignCanvas', () => {
  const readWorkspaceFile = vi.fn()
  const listWorkspaceDirectory = vi.fn()
  const writeWorkspaceFile = vi.fn()

  beforeEach(() => {
    readWorkspaceFile.mockReset().mockImplementation(async ({ path }: ReadRequest) => {
      if (path === prototype.relativePath) return { ok: true as const, content: PROTOTYPE_HTML }
      return { ok: false as const, message: 'missing' }
    })
    listWorkspaceDirectory.mockReset().mockResolvedValue({ ok: true as const, entries: [] })
    writeWorkspaceFile.mockReset().mockResolvedValue({ ok: true as const })
    vi.spyOn(rendererRuntimeClient, 'getSettings').mockResolvedValue({
      design: { workspaces: [] }
    } as never)
    vi.stubGlobal('window', {
      kunGui: {
        readWorkspaceFile,
        listWorkspaceDirectory,
        writeWorkspaceFile,
        createWorkspaceDirectory: vi.fn(async () => ({ ok: true as const })),
        deleteWorkspaceEntry: vi.fn(async () => ({
          ok: true as const,
          path: '',
          deletedAt: new Date().toISOString()
        }))
      }
    })
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    })
    resetDesignStore()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('re-validates the source path and status before touching the workspace', async () => {
    await expect(importComponentPrototypeToDesignCanvas({
      workspaceRoot: '/workspace',
      prototype: { ...prototype, relativePath: '.kun-design/component-prototypes/../secret/prototype.html' }
    })).resolves.toBeNull()
    await expect(importComponentPrototypeToDesignCanvas({
      workspaceRoot: '/workspace',
      prototype: { ...prototype, relativePath: '.kun-design/other/screen.html' }
    })).resolves.toBeNull()
    await expect(importComponentPrototypeToDesignCanvas({
      workspaceRoot: '/workspace',
      prototype: { ...prototype, status: 'running' }
    })).resolves.toBeNull()
    await expect(importComponentPrototypeToDesignCanvas({
      workspaceRoot: '   ',
      prototype
    })).resolves.toBeNull()
    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(useDesignWorkspaceStore.getState().documents).toHaveLength(0)
  })

  it('imports a completed prototype as a real HTML artifact with viewport sizing', async () => {
    const result = await importComponentPrototypeToDesignCanvas({ workspaceRoot: '/workspace', prototype })

    expect(result).not.toBeNull()
    expect(result!.reused).toBe(false)
    expect(result!.relativePath).toMatch(/^\.kun-design\/[^/]+\/[^/]+\/v1\.html$/)
    expect(result!.documentId).toBeTruthy()
    expect(result!.artifactId).toBeTruthy()
    expect(readWorkspaceFile).toHaveBeenCalledWith({
      path: prototype.relativePath,
      workspaceRoot: '/workspace'
    })
    const htmlWrite = writeWorkspaceFile.mock.calls.find(([request]) => request.path === result!.relativePath)
    expect(htmlWrite).toBeTruthy()
    expect(htmlWrite![0].content).toBe(PROTOTYPE_HTML)

    const state = useDesignWorkspaceStore.getState()
    expect(state.activeDocumentId).toBe(result!.documentId)
    expect(state.activeArtifactId).toBe(result!.artifactId)
    const artifact = state.artifacts.find((item) => item.id === result!.artifactId)
    expect(artifact?.kind).toBe('html')
    expect(artifact?.title).toBe(prototype.title)
    expect(artifact?.importedFromPath).toBe(prototype.relativePath)
    expect(artifact?.node).toMatchObject({
      width: 760,
      height: 520,
      sizeMode: 'manual',
      viewMode: 'preview'
    })
  })

  it('reuses the already-imported artifact instead of duplicating it', async () => {
    const first = await importComponentPrototypeToDesignCanvas({ workspaceRoot: '/workspace', prototype })
    expect(first).not.toBeNull()
    const firstState = useDesignWorkspaceStore.getState()
    expect(firstState.artifacts).toHaveLength(1)

    writeWorkspaceFile.mockClear()
    const second = await importComponentPrototypeToDesignCanvas({ workspaceRoot: '/workspace', prototype })

    expect(second?.artifactId).toBe(first!.artifactId)
    expect(second?.documentId).toBe(first!.documentId)
    expect(second?.reused).toBe(true)
    const state = useDesignWorkspaceStore.getState()
    expect(state.artifacts).toHaveLength(1)
    expect(state.activeArtifactId).toBe(first!.artifactId)
    expect(writeWorkspaceFile.mock.calls.filter(([request]) => request.path.endsWith('/v1.html')))
      .toHaveLength(0)
  })

  it('leaves the workspace untouched when the prototype file cannot be read', async () => {
    readWorkspaceFile.mockResolvedValue({ ok: false as const, message: 'not found' })
    const result = await importComponentPrototypeToDesignCanvas({ workspaceRoot: '/workspace', prototype })

    expect(result).toBeNull()
    const state = useDesignWorkspaceStore.getState()
    expect(state.documents).toHaveLength(0)
    expect(state.artifacts).toHaveLength(0)
    expect(writeWorkspaceFile.mock.calls.filter(([request]) => request.path.endsWith('/v1.html')))
      .toHaveLength(0)
  })

  it('imports diagram HTML durably and deduplicates by source path', async () => {
    const source = {
      status: 'completed',
      title: 'System diagram',
      relativePath: '.kun-design/diagram-prototypes/system/diagram.html',
      viewport: { width: 960, height: 640 }
    }
    readWorkspaceFile.mockImplementation(async ({ path }: ReadRequest) => (
      path === source.relativePath
        ? { ok: true as const, content: PROTOTYPE_HTML }
        : { ok: false as const, message: 'missing' }
    ))
    const options = {
      workspaceRoot: '/workspace',
      source,
      allowedPath: /^\.kun-design\/diagram-prototypes\/[^/]+\/diagram\.html$/i
    }

    const first = await importConversationHtmlToDesignCanvas(options)
    const second = await importConversationHtmlToDesignCanvas(options)

    expect(first).toMatchObject({ reused: false })
    expect(second).toMatchObject({ artifactId: first!.artifactId, reused: true })
    expect(useDesignWorkspaceStore.getState().artifacts).toHaveLength(1)
    expect(useDesignWorkspaceStore.getState().artifacts[0]).toMatchObject({
      title: 'System diagram',
      importedFromPath: source.relativePath,
      node: { width: 960, height: 640, sizeMode: 'manual' }
    })
  })

  it('leaves workspace state unchanged when generic HTML cannot be read', async () => {
    const before = useDesignWorkspaceStore.getState()
    const result = await importConversationHtmlToDesignCanvas({
      workspaceRoot: '/workspace',
      source: {
        status: 'completed',
        title: 'Missing',
        relativePath: '.kun-design/diagram-prototypes/missing/diagram.html',
        viewport: { width: 800, height: 600 }
      },
      allowedPath: /^\.kun-design\/diagram-prototypes\/[^/]+\/diagram\.html$/i
    })

    expect(result).toBeNull()
    expect(useDesignWorkspaceStore.getState().workspaceRoot).toBe(before.workspaceRoot)
    expect(useDesignWorkspaceStore.getState().documents).toEqual(before.documents)
  })

  it('leaves the workspace untouched when writing the imported HTML fails', async () => {
    writeWorkspaceFile.mockResolvedValue({ ok: false as const, message: 'denied' })
    const result = await importComponentPrototypeToDesignCanvas({ workspaceRoot: '/workspace', prototype })

    expect(result).toBeNull()
    const state = useDesignWorkspaceStore.getState()
    expect(state.artifacts).toHaveLength(0)
    expect(state.activeArtifactId).toBeNull()
  })
})
