import { describe, expect, it } from 'vitest'
import {
  buildWikilinkInsertion,
  rankWikilinkTargets,
  relativePathFrom,
  shortenMarkdownPath,
  workspaceRelativePath,
  type WikilinkTarget
} from './wikilink-targets'
import { WikilinkMenuView } from './wikilink-menu-view'

const VAULT = '/Users/me/vault'
const OTHER = '/Users/me/wp'

function target(
  relativePath: string,
  workspaceRoot = VAULT,
  workspaceName = 'vault'
): WikilinkTarget {
  return {
    workspaceRoot,
    workspaceName,
    relativePath,
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1)
  }
}

describe('shortenMarkdownPath', () => {
  it('drops a trailing .md the way wikilinks are usually written', () => {
    expect(shortenMarkdownPath('notes/alpha.md')).toBe('notes/alpha')
    expect(shortenMarkdownPath('Alpha.MD')).toBe('Alpha')
  })

  it('keeps .md when the stem already contains a dot', () => {
    // `notes/a.b` has an extension, so the resolver would not re-add `.md`
    // and the link would stop resolving.
    expect(shortenMarkdownPath('notes/a.b.md')).toBe('notes/a.b.md')
  })

  it('leaves other extensions alone', () => {
    expect(shortenMarkdownPath('notes/readme.mdx')).toBe('notes/readme.mdx')
    expect(shortenMarkdownPath('notes/data.txt')).toBe('notes/data.txt')
  })
})

describe('relativePathFrom', () => {
  it('walks down from a shared directory', () => {
    expect(relativePathFrom('', 'notes/alpha.md')).toBe('notes/alpha.md')
    expect(relativePathFrom('notes', 'notes/alpha.md')).toBe('alpha.md')
  })

  it('walks up out of nested directories', () => {
    expect(relativePathFrom('notes/deep', 'index.md')).toBe('../../index.md')
    expect(relativePathFrom('notes', 'index.md')).toBe('../index.md')
  })

  it('walks up and back down across sibling directories', () => {
    expect(relativePathFrom('notes/deep', 'other/beta.md')).toBe('../../other/beta.md')
  })

  it('normalizes windows separators', () => {
    expect(relativePathFrom('notes\\deep', 'notes/deep/alpha.md')).toBe('alpha.md')
  })

  it('returns a dot when the paths are identical', () => {
    expect(relativePathFrom('notes', 'notes')).toBe('.')
  })
})

describe('workspaceRelativePath', () => {
  it('strips the workspace root from an absolute path', () => {
    expect(workspaceRelativePath(VAULT, `${VAULT}/notes/alpha.md`)).toBe('notes/alpha.md')
  })

  it('tolerates a trailing separator on the root', () => {
    expect(workspaceRelativePath(`${VAULT}/`, `${VAULT}/a.md`)).toBe('a.md')
  })

  it('normalizes windows separators', () => {
    expect(workspaceRelativePath('C:\\vault', 'C:\\vault\\notes\\a.md'))
      .toBe('notes/a.md')
  })

  it('leaves an already-relative path alone', () => {
    expect(workspaceRelativePath(VAULT, 'notes/alpha.md')).toBe('notes/alpha.md')
  })

  it('does not strip a merely similar prefix', () => {
    // `/Users/me/vault-two` must not be treated as living inside `/Users/me/vault`.
    expect(workspaceRelativePath(VAULT, `${VAULT}-two/a.md`)).toBe(`${VAULT}-two/a.md`)
  })

  it('returns empty for the root itself', () => {
    expect(workspaceRelativePath(VAULT, VAULT)).toBe('')
  })
})

describe('buildWikilinkInsertion', () => {
  const context = { workspaceRoot: VAULT, activePath: 'notes/alpha.md' }

  it('writes a path relative to the editing file inside one workspace', () => {
    expect(buildWikilinkInsertion(target('index.md'), context)).toBe('../index')
    expect(buildWikilinkInsertion(target('notes/beta.md'), context)).toBe('beta')
    expect(buildWikilinkInsertion(target('notes/deep/gamma.md'), context)).toBe('deep/gamma')
  })

  it('writes a path relative from the root for a file at the top level', () => {
    expect(buildWikilinkInsertion(target('notes/beta.md'), {
      workspaceRoot: VAULT,
      activePath: 'index.md'
    })).toBe('notes/beta')
  })

  it('reaches across workspaces via their shared ancestor', () => {
    expect(buildWikilinkInsertion(target('docs/spec.md', OTHER, 'wp'), context))
      .toBe('../../wp/docs/spec')
  })

  it('accepts an absolute active path', () => {
    // Regression: an absolute activePath produced `../../../../welcome` because
    // the relative walk climbed out of every absolute segment.
    expect(buildWikilinkInsertion(target('welcome.md'), {
      workspaceRoot: VAULT,
      activePath: `${VAULT}/untitled.md`
    })).toBe('welcome')
    expect(buildWikilinkInsertion(target('index.md'), {
      workspaceRoot: VAULT,
      activePath: `${VAULT}/notes/alpha.md`
    })).toBe('../index')
  })

  it('handles workspace roots with a trailing separator', () => {
    expect(buildWikilinkInsertion(target('a.md', `${OTHER}/`, 'wp'), {
      workspaceRoot: `${VAULT}/`,
      activePath: 'index.md'
    })).toBe('../wp/a')
  })
})

describe('rankWikilinkTargets', () => {
  const targets = [
    target('index.md'),
    target('notes/alpha.md'),
    target('notes/alphabet-soup.md'),
    target('notes/beta.md'),
    target('docs/spec.md', OTHER, 'wp')
  ]
  const options = { workspaceRoot: VAULT, activePath: 'notes/alpha.md' }

  it('returns everything but the current file for an empty query', () => {
    const ranked = rankWikilinkTargets(targets, '', options)
    expect(ranked.map((item) => item.relativePath)).not.toContain('notes/alpha.md')
    expect(ranked).toHaveLength(4)
  })

  it('excludes the edited file when its path is absolute', () => {
    // Regression: the current file was offered as a link to itself because an
    // absolute activePath never matched a workspace-relative target.
    const ranked = rankWikilinkTargets(targets, '', {
      workspaceRoot: VAULT,
      activePath: `${VAULT}/notes/alpha.md`
    })
    expect(ranked.map((item) => item.relativePath)).not.toContain('notes/alpha.md')
  })

  it('ranks an exact stem match first', () => {
    const ranked = rankWikilinkTargets(targets, 'beta', options)
    expect(ranked[0]!.relativePath).toBe('notes/beta.md')
  })

  it('prefers a prefix match over a mere substring', () => {
    const ranked = rankWikilinkTargets(targets, 'alphab', options)
    expect(ranked[0]!.relativePath).toBe('notes/alphabet-soup.md')
  })

  it('includes files from other workspaces and flags them', () => {
    const ranked = rankWikilinkTargets(targets, 'spec', options)
    expect(ranked[0]!.relativePath).toBe('docs/spec.md')
    expect(ranked[0]!.external).toBe(true)
    expect(ranked[0]!.workspaceName).toBe('wp')
  })

  it('puts an equally good same-workspace match ahead of an external one', () => {
    const both = [target('shared.md'), target('shared.md', OTHER, 'wp')]
    const ranked = rankWikilinkTargets(both, 'shared', options)
    expect(ranked[0]!.external).toBe(false)
    expect(ranked[1]!.external).toBe(true)
  })

  it('matches a path query', () => {
    const ranked = rankWikilinkTargets(targets, 'notes/be', options)
    expect(ranked[0]!.relativePath).toBe('notes/beta.md')
  })

  it('falls back to a subsequence match', () => {
    const ranked = rankWikilinkTargets([target('notes/alphabet-soup.md')], 'nabs', options)
    expect(ranked).toHaveLength(1)
  })

  it('returns nothing when the query matches nothing', () => {
    expect(rankWikilinkTargets(targets, 'zzzzqqq', options)).toEqual([])
  })

  it('honours the limit', () => {
    expect(rankWikilinkTargets(targets, '', { ...options, limit: 2 })).toHaveLength(2)
  })

  it('does offer the same relative path from a different workspace', () => {
    // Only the file being edited is excluded, not its namesake elsewhere.
    const ranked = rankWikilinkTargets(
      [target('notes/alpha.md'), target('notes/alpha.md', OTHER, 'wp')],
      'alpha',
      options
    )
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.external).toBe(true)
  })
})

describe('WikilinkMenuView.placementFor', () => {
  const container = { left: 100, top: 50, height: 400 }

  it('positions below the caret relative to the container', () => {
    const placement = WikilinkMenuView.placementFor(
      { left: 160, top: 70, bottom: 90 },
      container,
      3
    )
    expect(placement.left).toBe(60)
    expect(placement.top).toBe(44)
  })

  it('flips above the caret when there is no room below but room above', () => {
    // 3 rows need ~98px. Below the caret there are only ~46px left, above there
    // are 330 — so it flips.
    const placement = WikilinkMenuView.placementFor(
      { left: 160, top: 380, bottom: 400 },
      container,
      3
    )
    expect(placement.top).toBeLessThan(380 - container.top)
  })

  it('stays below when neither side has room', () => {
    // 12 rows need ~368px and the container is only 400 tall, so flipping would
    // not help; the menu keeps its downward placement and scrolls internally.
    const placement = WikilinkMenuView.placementFor(
      { left: 160, top: 380, bottom: 400 },
      container,
      12
    )
    expect(placement.top).toBe(400 - container.top + 4)
  })

  it('folds in the container scroll offset', () => {
    const unscrolled = WikilinkMenuView.placementFor(
      { left: 160, top: 70, bottom: 90 },
      container,
      3
    )
    const scrolled = WikilinkMenuView.placementFor(
      { left: 160, top: 70, bottom: 90 },
      container,
      3,
      { left: 5, top: 220 }
    )
    expect(scrolled.top).toBe(unscrolled.top + 220)
    expect(scrolled.left).toBe(unscrolled.left + 5)
  })

  it('never positions left of the container edge', () => {
    const placement = WikilinkMenuView.placementFor(
      { left: 0, top: 70, bottom: 90 },
      container,
      3
    )
    expect(placement.left).toBe(4)
  })
})
