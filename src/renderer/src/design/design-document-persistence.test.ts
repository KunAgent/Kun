import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  documentsIndexPath,
  ensureDocumentDir,
  flushPendingDocumentsIndexes,
  parseDocumentsIndex,
  persistDocumentsIndex,
  readDesignDocumentsIndex,
  removePersistedDesignDocument,
  serializeDocumentsIndex
} from './design-document-persistence'
import { flushDesignPersistenceQueue } from './design-persistence-coordinator'
import type { DesignDocument } from './design-types'

function document(id: string): DesignDocument {
  return {
    id,
    title: id,
    order: 0,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    activeArtifactId: null,
    artifacts: []
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(async () => {
  await flushPendingDocumentsIndexes()
  await flushDesignPersistenceQueue()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('design documents index persistence', () => {
  it('treats an explicitly empty drawing index as valid durable state', () => {
    expect(parseDocumentsIndex(JSON.stringify({
      version: 1,
      activeDocumentId: null,
      documents: []
    }))).toEqual({
      version: 1,
      activeDocumentId: null,
      folders: [],
      documents: []
    })
  })

  it('persists Excalidraw engine and defaults missing/invalid values to Kun', () => {
    const serialized = serializeDocumentsIndex([
      { ...document('sketch'), engine: 'excalidraw' },
      document('legacy')
    ], 'sketch')
    expect(serialized).toContain('"engine": "excalidraw"')
    expect(serialized).not.toMatch(/"id": "legacy"[\s\S]*"engine"/)
    const parsed = parseDocumentsIndex(serialized)
    expect(parsed?.documents.find((item) => item.id === 'sketch')?.engine).toBe('excalidraw')
    expect(parsed?.documents.find((item) => item.id === 'legacy')?.engine).toBeUndefined()
    expect(parseDocumentsIndex(JSON.stringify({
      version: 2,
      activeDocumentId: 'bad',
      documents: [{ ...document('bad'), engine: 'unknown' }]
    }))?.documents[0]?.engine).toBeUndefined()
  })

  it('keeps legacy drawings in the root while accepting a version 2 folder tree', () => {
    const legacy = parseDocumentsIndex(JSON.stringify({
      version: 1,
      activeDocumentId: 'legacy',
      documents: [{ ...document('legacy'), artifacts: undefined }]
    }))
    expect(legacy).toMatchObject({
      version: 1,
      folders: [],
      documents: [{ id: 'legacy', folderId: null }]
    })

    const folders = [
      { id: 'design', name: 'Design', parentId: null },
      { id: 'mobile', name: 'Mobile', parentId: 'design' }
    ]
    const modern = parseDocumentsIndex(serializeDocumentsIndex([
      { ...document('modern'), folderId: 'mobile' }
    ], 'modern', folders))
    expect(modern).toMatchObject({
      version: 2,
      folders,
      documents: [{ id: 'modern', folderId: 'mobile' }]
    })
  })

  it('reads a lightweight workspace index without loading artifact directories', async () => {
    const content = serializeDocumentsIndex([
      { ...document('mobile'), folderId: 'mobile' }
    ], 'mobile', [{ id: 'mobile', name: 'Mobile', parentId: null }])
    const readWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      path: documentsIndexPath(),
      content,
      size: content.length,
      truncated: false,
      mtimeMs: 0
    }))
    vi.stubGlobal('window', { kunGui: { readWorkspaceFile } })

    await expect(readDesignDocumentsIndex('/workspace/mobile')).resolves.toMatchObject({
      activeDocumentId: 'mobile',
      folders: [{ id: 'mobile', name: 'Mobile' }],
      documents: [{ id: 'mobile', folderId: 'mobile' }]
    })
    expect(readWorkspaceFile).toHaveBeenCalledWith({
      path: documentsIndexPath(),
      workspaceRoot: '/workspace/mobile'
    })
  })

  it('round-trips the visible title origin without requiring it for legacy indexes', () => {
    const generated = { ...document('generated'), titleOrigin: 'generated' as const }
    expect(JSON.parse(serializeDocumentsIndex([generated], generated.id))).toMatchObject({
      version: 1,
      activeDocumentId: generated.id
    })
    expect(parseDocumentsIndex(serializeDocumentsIndex([generated], generated.id)))
      .toMatchObject({
        documents: [{ id: 'generated', titleOrigin: 'generated' }]
      })
    expect(parseDocumentsIndex(JSON.stringify({
      version: 1,
      activeDocumentId: 'legacy',
      documents: [{ ...document('legacy'), artifacts: undefined }]
    }))?.documents[0]).not.toHaveProperty('titleOrigin')
  })

  it('retains the latest pending payload per workspace and flushes it before the debounce', async () => {
    vi.useFakeTimers()
    const writeWorkspaceFile = vi.fn(async ({ path }: { path: string }) => ({
      ok: true as const,
      path,
      savedAt: 'now'
    }))
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })
    const first = [document('first')]
    const latest = [document('latest')]

    persistDocumentsIndex('/workspace', first, 'first')
    persistDocumentsIndex('/workspace', latest, 'latest')
    await flushPendingDocumentsIndexes('/workspace')

    expect(writeWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: documentsIndexPath(),
      workspaceRoot: '/workspace',
      content: serializeDocumentsIndex(latest, 'latest')
    })
  })

  it('keeps pending indexes isolated between workspaces', async () => {
    vi.useFakeTimers()
    const writeWorkspaceFile = vi.fn(async ({ path }: { path: string }) => ({
      ok: true as const,
      path,
      savedAt: 'now'
    }))
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })

    persistDocumentsIndex('/workspace/a', [document('a')], 'a')
    persistDocumentsIndex('/workspace/b', [document('b')], 'b')
    await flushPendingDocumentsIndexes('/workspace/a')

    expect(writeWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(writeWorkspaceFile.mock.calls[0]?.[0]).toMatchObject({ workspaceRoot: '/workspace/a' })
  })

  it('removes a drawing from its original persisted workspace after navigation', async () => {
    let indexContent = serializeDocumentsIndex([document('a'), document('b')], 'a')
    const writeWorkspaceFile = vi.fn(async (request: { content: string; path: string }) => {
      indexContent = request.content
      return { ok: true as const, path: request.path, savedAt: 'now' }
    })
    const deleteWorkspaceEntry = vi.fn(async (request: { path: string }) => ({
      ok: true as const,
      path: request.path,
      deletedAt: 'now'
    }))
    vi.stubGlobal('window', {
      kunGui: {
        readWorkspaceFile: vi.fn(async () => ({
          ok: true as const,
          path: documentsIndexPath(),
          content: indexContent,
          size: indexContent.length,
          truncated: false,
          mtimeMs: 0
        })),
        writeWorkspaceFile,
        deleteWorkspaceEntry
      }
    })

    await expect(removePersistedDesignDocument({
      workspaceRoot: '/workspace/original',
      documentId: 'a',
      fallbackDocuments: [document('a'), document('b')],
      fallbackActiveDocumentId: 'a'
    })).resolves.toBe(true)

    expect(parseDocumentsIndex(indexContent)).toMatchObject({
      activeDocumentId: 'b',
      documents: [{ id: 'b' }]
    })
    expect(deleteWorkspaceEntry).toHaveBeenCalledWith({
      workspaceRoot: '/workspace/original',
      path: '.kun-design/a'
    })
  })

  it('waits for a pending drawing directory creation before deleting it', async () => {
    const firstMkdir = deferred<{ ok: true; path: string }>()
    const createWorkspaceDirectory = vi.fn()
      .mockImplementationOnce(() => firstMkdir.promise)
      .mockResolvedValue({ ok: true as const, path: '/workspace/.kun-design/doc' })
    const deleteWorkspaceEntry = vi.fn(async (request: { path: string }) => ({
      ok: true as const,
      path: request.path,
      deletedAt: 'now'
    }))
    vi.stubGlobal('window', {
      kunGui: {
        createWorkspaceDirectory,
        writeWorkspaceFile: vi.fn(async (request: { path: string }) => ({
          ok: true as const,
          path: request.path,
          savedAt: 'now'
        })),
        deleteWorkspaceEntry
      }
    })

    void ensureDocumentDir('/workspace', 'doc')
    const removal = removePersistedDesignDocument({
      workspaceRoot: '/workspace',
      documentId: 'doc',
      fallbackDocuments: [document('doc')],
      fallbackActiveDocumentId: 'doc'
    })
    await Promise.resolve()
    expect(deleteWorkspaceEntry).not.toHaveBeenCalled()

    firstMkdir.resolve({ ok: true, path: '/workspace/.kun-design' })
    await expect(removal).resolves.toBe(true)
    expect(createWorkspaceDirectory).toHaveBeenCalledTimes(2)
    expect(deleteWorkspaceEntry).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      path: '.kun-design/doc'
    })
  })
})
