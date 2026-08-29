import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  DEFAULT_WIKILINK_SCAN_LIMITS,
  isWikilinkMarkdownName,
  scanAllWorkspaceMarkdown,
  scanWorkspaceMarkdown,
  type WikilinkDirectoryLister,
  type WikilinkScanLimits
} from './wikilink-scan'

function limits(overrides: Partial<WikilinkScanLimits>): WikilinkScanLimits {
  return { ...DEFAULT_WIKILINK_SCAN_LIMITS, ...overrides }
}

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
    const { targets: found } = await scanWorkspaceMarkdown(ROOT, lister({
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
    const { targets: found } = await scanWorkspaceMarkdown(ROOT, lister({
      '': [directory('node_modules'), directory('.git'), directory('dist'), directory('ok')],
      node_modules: [file('bad.md')],
      '.git': [file('bad.md')],
      dist: [file('bad.md')],
      ok: [file('good.md')]
    }))
    expect(found.map((item) => item.relativePath)).toEqual(['ok/good.md'])
  })

  it('honours the depth limit', async () => {
    const { targets: found } = await scanWorkspaceMarkdown(
      ROOT,
      lister({
        '': [directory('a')],
        a: [directory('b'), file('shallow.md')],
        'a/b': [file('deep.md')]
      }),
      limits({ maxDepth: 1 })
    )
    expect(found.map((item) => item.relativePath)).toEqual(['a/shallow.md'])
  })

  it('honours the file cap', async () => {
    const { targets: found } = await scanWorkspaceMarkdown(
      ROOT,
      lister({ '': Array.from({ length: 10 }, (_, index) => file(`n${index}.md`)) }),
      limits({ maxFilesPerRoot: 3 })
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
    await scanWorkspaceMarkdown(ROOT, list, limits({ maxDirectoriesPerRoot: 2 }))
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('is breadth-first, so shallow files survive a cap', async () => {
    const { targets: found } = await scanWorkspaceMarkdown(
      ROOT,
      lister({
        '': [directory('deep'), file('root.md')],
        deep: [file('nested.md')]
      }),
      limits({ maxDirectoriesPerRoot: 1 })
    )
    expect(found.map((item) => item.relativePath)).toEqual(['root.md'])
  })

  it('keeps going when one directory fails to list', async () => {
    const { targets: found } = await scanWorkspaceMarkdown(ROOT, lister({
      '': [directory('broken'), directory('ok')],
      ok: [file('good.md')]
    }))
    expect(found.map((item) => item.relativePath)).toEqual(['ok/good.md'])
  })

  it('survives a lister that throws', async () => {
    const { targets: found } = await scanWorkspaceMarkdown(ROOT, async ({ path }) => {
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
    const { targets: found } = await scanAllWorkspaceMarkdown(
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
    expect((await scanAllWorkspaceMarkdown([], list)).targets).toEqual([])
    expect(list).not.toHaveBeenCalled()
  })

  it('caps the total files across every root, not only per root', async () => {
    // Three roots of 3 files each stay under the per-root cap of 50; the
    // global cap of 4 is what stops the walk mid-way through the second root.
    const list = async () => ({
      ok: true as const,
      entries: [file('a.md'), file('b.md'), file('c.md')]
    })
    const { targets: found } = await scanAllWorkspaceMarkdown(
      [
        { root: '/one', name: 'one' },
        { root: '/two', name: 'two' },
        { root: '/three', name: 'three' }
      ],
      list,
      limits({ maxFilesTotal: 4 })
    )
    expect(found).toHaveLength(4)
    expect(found.map((item) => item.workspaceName)).toEqual(['one', 'one', 'one', 'two'])
  })

  it('caps the total directory listings across every root', async () => {
    const list = vi.fn(lister({
      '': [directory('a'), directory('b')],
      a: [file('a.md')],
      b: [file('b.md')]
    }))
    // Each root would list 3 directories (root, a, b); the global cap of 4
    // allows the first root plus only the second root's top level.
    await scanAllWorkspaceMarkdown(
      [
        { root: '/one', name: 'one' },
        { root: '/two', name: 'two' },
        { root: '/three', name: 'three' }
      ],
      list,
      limits({ maxDirectoriesTotal: 4 })
    )
    expect(list).toHaveBeenCalledTimes(4)
  })

  it('flags a complete scan as neither truncated nor failed', async () => {
    const outcome = await scanAllWorkspaceMarkdown(
      [ROOT],
      lister({ '': [file('a.md')] })
    )
    expect(outcome.truncated).toBe(false)
    expect(outcome.failedDirectories).toBe(0)
  })

  it('flags truncation when a cap stops the walk early', async () => {
    const outcome = await scanAllWorkspaceMarkdown(
      [ROOT],
      lister({ '': Array.from({ length: 10 }, (_, index) => file(`n${index}.md`)) }),
      limits({ maxFilesPerRoot: 3 })
    )
    expect(outcome.targets).toHaveLength(3)
    expect(outcome.truncated).toBe(true)
  })

  it('flags truncation when later roots never start', async () => {
    const outcome = await scanAllWorkspaceMarkdown(
      [{ root: '/one', name: 'one' }, { root: '/two', name: 'two' }],
      async () => ({ ok: true as const, entries: [file('a.md'), file('b.md')] }),
      limits({ maxFilesTotal: 2 })
    )
    expect(outcome.truncated).toBe(true)
  })

  it('counts unreadable directories instead of swallowing them', async () => {
    const outcome = await scanAllWorkspaceMarkdown(
      [ROOT],
      lister({
        '': [directory('broken'), directory('ok')],
        ok: [file('good.md')]
      })
    )
    expect(outcome.targets.map((item) => item.relativePath)).toEqual(['ok/good.md'])
    expect(outcome.failedDirectories).toBe(1)
    expect(outcome.truncated).toBe(true)
  })
})
