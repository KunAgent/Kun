import { describe, expect, it } from 'vitest'
import type { WorkspaceDirectoryTarget, WorkspaceEntry, WorkspaceFileTarget } from '@shared/workspace-file'
import { normalizeLibraryRoots, projectNameForRoot, scanArtifactLibrary, type ArtifactScanApi } from './artifact-index'

type Tree = Record<string, Record<string, { files?: Record<string, { content?: string; mtimeMs?: number; size?: number }>; dirs?: string[] }>>

function fakeApi(tree: Tree): ArtifactScanApi {
  return {
    listWorkspaceDirectory: async ({ workspaceRoot, path = '' }: WorkspaceDirectoryTarget) => {
      const dir = tree[workspaceRoot]?.[path]
      if (!dir) return { ok: false, message: 'missing' }
      const entries: WorkspaceEntry[] = [
        ...Object.entries(dir.files ?? {}).map(([name, file]) => ({
          name, path: path ? `${path}/${name}` : name, type: 'file' as const,
          ext: name.includes('.') ? name.slice(name.lastIndexOf('.')) : '', mtimeMs: file.mtimeMs, size: file.size
        })),
        ...(dir.dirs ?? []).map((name) => ({ name, path: path ? `${path}/${name}` : name, type: 'directory' as const, ext: '' }))
      ]
      return { ok: true, root: workspaceRoot, entries }
    },
    readWorkspaceFile: async ({ workspaceRoot, path }: WorkspaceFileTarget) => {
      const slash = path.lastIndexOf('/')
      const dir = slash < 0 ? '' : path.slice(0, slash)
      const file = tree[workspaceRoot ?? '']?.[dir]?.files?.[path.slice(slash + 1)]
      return file?.content !== undefined
        ? { ok: true, path, content: file.content, size: file.content.length, truncated: false }
        : { ok: false, message: 'missing' }
    }
  }
}

const designIndex = JSON.stringify({
  version: 1,
  activeDocumentId: 'doc_a',
  documents: [{
    id: 'doc_a', title: 'Update entry', order: 0, createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z', activeArtifactId: null
  }]
})

const whiteboards = JSON.stringify({
  version: 1,
  whiteboards: [{
    id: 'wb_1', title: 'Runtime map', threadId: 'thread_board', phase: 'blank', revision: 1,
    createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z'
  }]
})

describe('artifact library scan', () => {
  it('collects designs, whiteboards, office files and generated images per project', async () => {
    const root = '/work/kun-app'
    const api = fakeApi({
      [root]: {
        '': { files: { 'notes.docx': { mtimeMs: 300, size: 2048 }, 'README.md': { mtimeMs: 900 }, '~$notes.docx': { mtimeMs: 1 } } },
        '.kun-design': { files: { 'documents.json': { content: designIndex } } },
        '.kun-whiteboards': { files: { 'index.json': { content: whiteboards } } },
        reports: { files: { 'usage.xlsx': { mtimeMs: 200 }, 'launch.pptx': { mtimeMs: 250 } } },
        '.kun/images': { files: { 'mascot.png': { mtimeMs: 100 }, 'meta.json': { mtimeMs: 100 } } }
      }
    })
    const items = await scanArtifactLibrary(api, [root])
    const byTitle = Object.fromEntries(items.map((item) => [item.title, item]))
    expect(Object.keys(byTitle).sort()).toEqual(['Runtime map', 'Update entry', 'launch', 'mascot', 'notes', 'usage'])
    expect(byTitle['Update entry']).toMatchObject({ kind: 'design', designDocumentId: 'doc_a', path: '.kun-design/doc_a', projectName: 'kun-app' })
    expect(byTitle['Runtime map']).toMatchObject({ kind: 'board', whiteboardId: 'wb_1', sourceThreadId: 'thread_board' })
    expect(byTitle.notes).toMatchObject({ kind: 'doc', path: 'notes.docx', ext: '.docx', size: 2048 })
    expect(byTitle.usage).toMatchObject({ kind: 'sheet', path: 'reports/usage.xlsx' })
    expect(byTitle.launch).toMatchObject({ kind: 'slides' })
    expect(byTitle.mascot).toMatchObject({ kind: 'image', path: '.kun/images/mascot.png' })
    expect(items[0].title).toBe('Update entry')
  })

  it('treats missing folders and broken indexes as empty', async () => {
    const root = '/work/empty'
    const api = fakeApi({ [root]: { '.kun-design': { files: { 'documents.json': { content: '{broken' } } } } })
    await expect(scanArtifactLibrary(api, [root, '  ', null])).resolves.toEqual([])
  })

  it('dedupes roots and names projects by folder', () => {
    expect(normalizeLibraryRoots(['/a/b/', '/a/b', '', undefined, '/c'])).toEqual(['/a/b', '/c'])
    expect(projectNameForRoot('/Users/me/DeepSeek-GUI/')).toBe('DeepSeek-GUI')
    expect(projectNameForRoot('C:\\work\\kun')).toBe('kun')
  })

  it('scans one space at a time when only that root is passed', async () => {
    const workRoot = '/work/space-a'
    const otherRoot = '/work/space-b'
    const boardIndex = (id: string): string => JSON.stringify({
      version: 1,
      whiteboards: [{
        id, title: 'Same title', threadId: null, phase: 'blank', revision: 0,
        createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z'
      }]
    })
    const api = fakeApi({
      [workRoot]: { '.kun-whiteboards': { files: { 'index.json': { content: boardIndex('wb_a') } } } },
      [otherRoot]: { '.kun-whiteboards': { files: { 'index.json': { content: boardIndex('wb_b') } } } }
    })

    const scoped = await scanArtifactLibrary(api, [workRoot])
    const all = await scanArtifactLibrary(api, [workRoot, otherRoot])

    expect(scoped.map((item) => item.whiteboardId)).toEqual(['wb_a'])
    // Identity is workspace + path, so equal titles never merge across spaces.
    expect(all.map((item) => item.whiteboardId).sort()).toEqual(['wb_a', 'wb_b'])
  })
})
