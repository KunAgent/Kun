import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  isWikilinkMarkdownName,
  scanAllWorkspaceMarkdown,
  scanWorkspaceMarkdown,
  type WikilinkDirectoryLister
} from './wikilink-scan'

function file(name: string): WorkspaceEntry {
  return { name, path: name, type: 'file', ext: name.slice(name.lastIndexOf('.')) }
}

function directory(name: string): WorkspaceEntry {
  return { name, path: name, type: 'directory', ext: '' }
}

/** Directory lister backed by a plain map of relative dir -> entries. */
function lister(tree: Record<string, WorkspaceEntry[]>): WikilinkDirectoryLister {
  return async ({ path }) => {
    const entries = tree[path ?? '']
    return entries ? { ok: true, entries } : { ok: false, message: 'missing' }
  }
}

const ROOT = { root: '/vault', name: 'vault' }

describe('isWikilinkMarkdownName', () => {
  it('accepts markdown extensions only', () => {
    expect(isWikilinkMarkdownName('a.md')).toBe(true)
    expect(isWikilinkMarkdownName('a.MARKDOWN')).toBe(true)
    expect(isWikilinkMarkdownName('a.mdx')).toBe(true)
    expect(isWikilinkMarkdownName('a.txt')).toBe(false)
    expect(isWikilinkMarkdownName('README')).toBe(false)
  })
})

describe('scanWorkspaceMarkdown', () => {
  it('collects markdown across nested directories with relative paths', async () => {
    const found = await scanWorkspaceMarkdown(ROOT, lister({
      '': [file('index.md'), file('logo.png'), directory('notes')],
      notes: [file('alpha.md'), directory('deep')],
      'notes/deep': [file('gamma.md')]
    }))
    expect(found.map((item) => item.relativePath).sort())
      .toEqual(['index.md', 'notes/alpha.md', 'notes/deep/gamma.md'])
    expect(found[0]!.workspaceRoot).toBe('/vault')
    expect(found[0]!.workspaceName).toBe('vault')
  })

  it('skips machine-generated and hidden directories', async () => {
    const found = await scanWorkspaceMarkdown(ROOT, lister({
      '': [directory('node_modules'), directory('.git'), directory('dist'), directory('ok')],
      node_modules: [file('bad.md')],
      '.git': [file('bad.md')],
      dist: [file('bad.md')],
      ok: [file('good.md')]
    }))
    expect(found.map((item) => item.relativePath)).toEqual(['ok/good.md'])
  })

  it('honours the depth limit', async () => {
    const found = await scanWorkspaceMarkdown(
      ROOT,
      lister({
        '': [directory('a')],
        a: [directory('b'), file('shallow.md')],
        'a/b': [file('deep.md')]
      }),
      { maxDepth: 1, maxDirectoriesPerRoot: 50, maxFilesPerRoot: 50 }
    )
    expect(found.map((item) => item.relativePath)).toEqual(['a/shallow.md'])
  })

  it('honours the file cap', async () => {
    const found = await scanWorkspaceMarkdown(
      ROOT,
      lister({ '': Array.from({ length: 10 }, (_, index) => file(`n${index}.md`)) }),
      { maxDepth: 4, maxDirectoriesPerRoot: 50, maxFilesPerRoot: 3 }
    )
    expect(found).toHaveLength(3)
  })

  it('honours the directory cap', async () => {
    const list = vi.fn(lister({
      '': [directory('a'), directory('b'), directory('c')],
      a: [file('a.md')],
      b: [file('b.md')],
      c: [file('c.md')]
    }))
    await scanWorkspaceMarkdown(ROOT, list, {
      maxDepth: 4,
      maxDirectoriesPerRoot: 2,
      maxFilesPerRoot: 50
    })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('is breadth-first, so shallow files survive a cap', async () => {
    const found = await scanWorkspaceMarkdown(
      ROOT,
      lister({
        '': [directory('deep'), file('root.md')],
        deep: [file('nested.md')]
      }),
      { maxDepth: 4, maxDirectoriesPerRoot: 1, maxFilesPerRoot: 50 }
    )
    expect(found.map((item) => item.relativePath)).toEqual(['root.md'])
  })

  it('keeps going when one directory fails to list', async () => {
    const found = await scanWorkspaceMarkdown(ROOT, lister({
      '': [directory('broken'), directory('ok')],
      ok: [file('good.md')]
    }))
    expect(found.map((item) => item.relativePath)).toEqual(['ok/good.md'])
  })

  it('survives a lister that throws', async () => {
    const found = await scanWorkspaceMarkdown(ROOT, async ({ path }) => {
      if (path === 'boom') throw new Error('io')
      return path === undefined
        ? { ok: true, entries: [directory('boom'), file('root.md')] }
        : { ok: true, entries: [] }
    })
    expect(found.map((item) => item.relativePath)).toEqual(['root.md'])
  })
})

describe('scanAllWorkspaceMarkdown', () => {
  it('walks every workspace and tags each file with its root', async () => {
    const found = await scanAllWorkspaceMarkdown(
      [{ root: '/vault', name: 'vault' }, { root: '/wp', name: 'wp' }],
      async ({ workspaceRoot, path }) => {
        if (path) return { ok: true, entries: [] }
        return {
          ok: true,
          entries: [file(workspaceRoot === '/vault' ? 'index.md' : 'spec.md')]
        }
      }
    )
    expect(found.map((item) => `${item.workspaceName}:${item.relativePath}`))
      .toEqual(['vault:index.md', 'wp:spec.md'])
  })

  it('deduplicates repeated and blank roots', async () => {
    const list = vi.fn(async () => ({ ok: true as const, entries: [file('a.md')] }))
    await scanAllWorkspaceMarkdown(
      [
        { root: '/vault', name: 'vault' },
        { root: '/vault/', name: 'vault' },
        { root: '', name: '' }
      ],
      list
    )
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('returns nothing for no roots', async () => {
    const list = vi.fn(async () => ({ ok: true as const, entries: [] }))
    expect(await scanAllWorkspaceMarkdown([], list)).toEqual([])
    expect(list).not.toHaveBeenCalled()
  })
})
