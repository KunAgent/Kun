import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearWorkspaceFileIndexCaches,
  loadWorkspaceDirectoryContextFiles,
  loadWorkspaceFileIndex,
  loadWorkspaceMentionPathSuggestions,
  MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES,
  MAX_WORKSPACE_MENTION_DIRECTORY_CACHE_ENTRIES,
  mentionQueryDirectory,
  mergeMentionCandidates,
  workspaceFileIndexCacheSizes
} from './workspace-file-index'
import {
  COMPOSER_FILE_REFERENCE_DRAG_MIME,
  composerFileReferenceFromPath,
  filterWorkspaceFileMentionSuggestions,
  parseComposerFileReferenceDragData,
  type ComposerFileReference
} from './composer-file-references'

function entry(path: string, type: 'file' | 'directory'): {
  name: string
  path: string
  type: 'file' | 'directory'
  ext: string
} {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return { name, path, type, ext: type === 'file' && dot > 0 ? name.slice(dot) : '' }
}

function installListDirectory(
  impl: (options: { workspaceRoot: string; path?: string }) => unknown
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (options: { workspaceRoot: string; path?: string }) => impl(options))
  vi.stubGlobal('window', { kunGui: { listWorkspaceDirectory: fn } })
  return fn
}

afterEach(() => {
  clearWorkspaceFileIndexCaches()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('composerFileReferenceFromPath', () => {
  it('keeps workspace files relative and external user-picked files explicit', () => {
    expect(composerFileReferenceFromPath('C:\\repo\\src\\app.ts', 'C:\\repo')).toEqual({
      path: 'C:/repo/src/app.ts',
      relativePath: 'src/app.ts',
      name: 'app.ts',
      type: 'file',
      workspaceRoot: 'C:/repo'
    })
    expect(composerFileReferenceFromPath('D:\\notes\\context.md', 'C:\\repo')).toEqual({
      path: 'D:/notes/context.md',
      relativePath: 'D:/notes/context.md',
      name: 'context.md',
      type: 'file',
      workspaceRoot: null
    })
    expect(composerFileReferenceFromPath('C:\\backend\\src\\app.ts', ['C:\\repo', 'C:\\backend'])).toEqual({
      path: 'C:/backend/src/app.ts',
      relativePath: 'src/app.ts',
      name: 'app.ts',
      type: 'file',
      workspaceRoot: 'C:/backend'
    })
  })

  it('parses bounded internal drag data and rejects malformed payloads', () => {
    const reference = {
      path: 'C:\\repo\\docs\\plan.md',
      relativePath: 'docs\\plan.md',
      name: 'plan.md',
      type: 'file' as const,
      workspaceRoot: 'C:\\repo'
    }

    expect(COMPOSER_FILE_REFERENCE_DRAG_MIME).toBe('application/x-kun-file-reference')
    expect(parseComposerFileReferenceDragData(JSON.stringify(reference))).toEqual({
      path: 'C:/repo/docs/plan.md',
      relativePath: 'docs/plan.md',
      name: 'plan.md',
      type: 'file',
      workspaceRoot: 'C:/repo'
    })
    expect(parseComposerFileReferenceDragData(JSON.stringify(reference), 'C:/repo')).toEqual({
      path: 'C:/repo/docs/plan.md',
      relativePath: 'docs/plan.md',
      name: 'plan.md',
      type: 'file',
      workspaceRoot: 'C:/repo'
    })
    expect(parseComposerFileReferenceDragData(JSON.stringify(reference), 'C:/other')).toBeNull()
    expect(parseComposerFileReferenceDragData(JSON.stringify({
      ...reference,
      path: 'C:\\backend\\src\\app.ts',
      relativePath: 'src\\app.ts',
      workspaceRoot: 'C:\\backend'
    }), ['C:/repo', 'C:/backend'])).toEqual({
      path: 'C:/backend/src/app.ts',
      relativePath: 'src/app.ts',
      name: 'plan.md',
      type: 'file',
      workspaceRoot: 'C:/backend'
    })
    expect(parseComposerFileReferenceDragData(JSON.stringify({
      ...reference,
      path: 'C:\\outside\\plan.md',
      relativePath: '../outside/plan.md'
    }), 'C:/repo')).toBeNull()
    expect(parseComposerFileReferenceDragData('{bad json')).toBeNull()
    expect(parseComposerFileReferenceDragData(JSON.stringify({ ...reference, type: 'link' }))).toBeNull()
    expect(parseComposerFileReferenceDragData('x'.repeat(16 * 1024 + 1))).toBeNull()
    expect(parseComposerFileReferenceDragData('界'.repeat(6 * 1024))).toBeNull()
  })
})

describe('mentionQueryDirectory', () => {
  it('returns the directory portion of a path-like query', () => {
    expect(mentionQueryDirectory('src/a/b/c/deep.ts')).toBe('src/a/b/c')
    expect(mentionQueryDirectory('src/a/b/c/')).toBe('src/a/b/c')
    expect(mentionQueryDirectory('src\\a\\b\\file')).toBe('src/a/b')
  })

  it('returns null for a name-only query the index already covers', () => {
    expect(mentionQueryDirectory('deep.ts')).toBeNull()
    expect(mentionQueryDirectory('')).toBeNull()
  })
})

describe('loadWorkspaceMentionPathSuggestions', () => {
  it('lists the deep directory implied by the query and yields mentionable entries', async () => {
    const root = '/ws-deep-1'
    const list = installListDirectory(() => ({
      ok: true,
      root: `${root}/src/a/b/c`,
      entries: [
        entry(`${root}/src/a/b/c/deep.ts`, 'file'),
        entry(`${root}/src/a/b/c/nested`, 'directory'),
        entry(`${root}/src/a/b/c/image.png`, 'file'), // not a mentionable text file
        entry(`${root}/src/a/b/c/node_modules`, 'directory') // ignored dir
      ]
    }))

    const suggestions = await loadWorkspaceMentionPathSuggestions(root, 'src/a/b/c/de')

    expect(list).toHaveBeenCalledWith({ workspaceRoot: root, path: 'src/a/b/c' })
    expect(suggestions.map((ref) => ref.relativePath)).toEqual([
      'src/a/b/c/deep.ts',
      'src/a/b/c/nested'
    ])
  })

  it('returns [] for name-only queries without hitting the IPC', async () => {
    const list = installListDirectory(() => ({ ok: true, root: '/ws', entries: [] }))
    expect(await loadWorkspaceMentionPathSuggestions('/ws-name-only', 'deep.ts')).toEqual([])
    expect(list).not.toHaveBeenCalled()
  })

  it('returns [] when the directory cannot be listed', async () => {
    installListDirectory(() => ({ ok: false, message: 'not found' }))
    expect(await loadWorkspaceMentionPathSuggestions('/ws-missing', 'no/such/dir/x')).toEqual([])
  })

  it('makes a deeply nested file selectable through fuzzy filtering', async () => {
    const root = '/ws-deep-2'
    installListDirectory(() => ({
      ok: true,
      root: `${root}/src/a/b/c/d/e/f/g`,
      entries: [entry(`${root}/src/a/b/c/d/e/f/g/VeryDeep.ts`, 'file')]
    }))

    const onDemand = await loadWorkspaceMentionPathSuggestions(root, 'src/a/b/c/d/e/f/g/VeryDeep')
    // The bounded index (empty here, mimicking a file past the depth cap) plus
    // the on-demand directory listing must surface the deep file.
    const candidates = mergeMentionCandidates([], onDemand)
    const filtered = filterWorkspaceFileMentionSuggestions(candidates, 'src/a/b/c/d/e/f/g/VeryDeep', [])
    expect(filtered.map((ref) => ref.relativePath)).toContain('src/a/b/c/d/e/f/g/VeryDeep.ts')
  })
})

describe('loadWorkspaceFileIndex design document references', () => {
  it('adds design document directories from the persisted documents index', async () => {
    const root = '/ws-design-doc-index'
    const listWorkspaceDirectory = vi.fn(async () => ({ ok: true as const, root, entries: [] }))
    const readWorkspaceFile = vi.fn(async (options: { path: string }) => {
      if (options.path !== '.kun-design/documents.json') return { ok: false as const, message: 'missing' }
      return {
        ok: true as const,
        content: JSON.stringify({
          version: 1,
          activeDocumentId: 'doc_1',
          documents: [{
            id: 'doc_1',
            title: '我的设计',
            order: 0,
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
            activeArtifactId: null
          }]
        })
      }
    })
    vi.stubGlobal('window', { kunGui: { listWorkspaceDirectory, readWorkspaceFile } })

    const index = await loadWorkspaceFileIndex(root)

    expect(index.directories).toContainEqual(expect.objectContaining({
      path: `${root}/.kun-design/doc_1`,
      relativePath: '.kun-design/doc_1',
      name: 'Untitled drawing',
      type: 'directory',
      workspaceRoot: root
    }))
  })

  it('bounds cached indexes across many visited workspaces', async () => {
    const list = installListDirectory((options) => ({
      ok: true,
      root: options.workspaceRoot,
      entries: []
    }))
    for (let index = 0; index < MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES + 5; index += 1) {
      await loadWorkspaceFileIndex(`/cache-workspace-${index}`)
    }

    expect(workspaceFileIndexCacheSizes().indexes).toBe(MAX_WORKSPACE_FILE_INDEX_CACHE_ENTRIES)
    const callsBeforeReload = list.mock.calls.length
    await loadWorkspaceFileIndex('/cache-workspace-0')
    expect(list.mock.calls.length).toBe(callsBeforeReload + 1)
  })
})

describe('workspace mention directory cache', () => {
  it('bounds path-specific directory results during deep typing', async () => {
    vi.useFakeTimers()
    installListDirectory((options) => ({
      ok: true,
      root: `${options.workspaceRoot}/${options.path ?? ''}`,
      entries: []
    }))

    for (let index = 0; index < MAX_WORKSPACE_MENTION_DIRECTORY_CACHE_ENTRIES + 5; index += 1) {
      await loadWorkspaceMentionPathSuggestions('/mention-cache', `dir-${index}/file`)
    }

    expect(workspaceFileIndexCacheSizes().mentionDirectories)
      .toBe(MAX_WORKSPACE_MENTION_DIRECTORY_CACHE_ENTRIES)
  })
})

describe('loadWorkspaceDirectoryContextFiles', () => {
  it('recursively lists mentionable text files under the referenced directory', async () => {
    const root = '/ws-design-dir-context'
    const listWorkspaceDirectory = installListDirectory((options) => {
      if (options.path === '.kun-design/doc_1') {
        return {
          ok: true,
          root: `${root}/.kun-design/doc_1`,
          entries: [
            entry(`${root}/.kun-design/doc_1/design.md`, 'file'),
            entry(`${root}/.kun-design/doc_1/home`, 'directory'),
            entry(`${root}/.kun-design/doc_1/preview.png`, 'file')
          ]
        }
      }
      if (options.path === '.kun-design/doc_1/home') {
        return {
          ok: true,
          root: `${root}/.kun-design/doc_1/home`,
          entries: [
            entry(`${root}/.kun-design/doc_1/home/DESIGN.md`, 'file'),
            entry(`${root}/.kun-design/doc_1/home/v1.html`, 'file'),
            entry(`${root}/.kun-design/doc_1/home/screenshot.png`, 'file')
          ]
        }
      }
      return { ok: false, message: 'missing' }
    })

    const files = await loadWorkspaceDirectoryContextFiles(root, '.kun-design/doc_1', 10)

    expect(listWorkspaceDirectory).toHaveBeenCalledWith({ workspaceRoot: root, path: '.kun-design/doc_1' })
    expect(files.map((file) => file.relativePath)).toEqual([
      '.kun-design/doc_1/design.md',
      '.kun-design/doc_1/home/DESIGN.md',
      '.kun-design/doc_1/home/v1.html'
    ])
  })
})

describe('mergeMentionCandidates', () => {
  it('appends new references and de-dupes by relative path', () => {
    const base: ComposerFileReference[] = [
      { path: '/ws/a.ts', relativePath: 'a.ts', name: 'a.ts', type: 'file' }
    ]
    const extra: ComposerFileReference[] = [
      { path: '/ws/a.ts', relativePath: 'a.ts', name: 'a.ts', type: 'file' },
      { path: '/ws/deep/b.ts', relativePath: 'deep/b.ts', name: 'b.ts', type: 'file' }
    ]
    const merged = mergeMentionCandidates(base, extra)
    expect(merged.map((ref) => ref.relativePath)).toEqual(['a.ts', 'deep/b.ts'])
  })

  it('returns the base array unchanged when there is nothing to merge', () => {
    const base: ComposerFileReference[] = [
      { path: '/ws/a.ts', relativePath: 'a.ts', name: 'a.ts', type: 'file' }
    ]
    expect(mergeMentionCandidates(base, [])).toBe(base)
  })
})
