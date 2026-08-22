import { describe, expect, it } from 'vitest'
import { buildNodeGraphFolderProjection, folderMountId } from './node-graph-folder.js'
import type { KnowledgeNode, StoredKnowledgeIndex } from '../knowledge/knowledge-types.js'

const BUILT_AT = '2026-08-18T00:00:00.000Z'
const ROOT = '/Users/me/vault'

function node(
  id: string,
  kind: KnowledgeNode['kind'],
  overrides: Partial<KnowledgeNode> = {}
): KnowledgeNode {
  return {
    id,
    kind,
    title: id,
    summary: '',
    parentId: null,
    childIds: [],
    ...overrides
  }
}

/**
 * vault/
 *   index.md            -> links to notes/alpha.md
 *   notes/
 *     alpha.md          -> has one heading
 */
function index(overrides: Partial<StoredKnowledgeIndex> = {}): StoredKnowledgeIndex {
  return {
    version: 3,
    root: ROOT,
    fingerprint: 'fp',
    builtAt: BUILT_AT,
    rootNodeId: 'root:.',
    documents: [],
    nodes: {
      'root:.': node('root:.', 'root', { title: 'vault', childIds: ['doc:index.md', 'dir:notes'] }),
      'dir:notes': node('dir:notes', 'directory', {
        title: 'notes', parentId: 'root:.', childIds: ['doc:notes/alpha.md'], relativePath: 'notes'
      }),
      'doc:index.md': node('doc:index.md', 'document', {
        title: 'index.md', parentId: 'root:.', relativePath: 'index.md', summary: 'the entry point'
      }),
      'doc:notes/alpha.md': node('doc:notes/alpha.md', 'document', {
        title: 'alpha.md',
        parentId: 'dir:notes',
        relativePath: 'notes/alpha.md',
        childIds: ['sec:alpha-1']
      }),
      'sec:alpha-1': node('sec:alpha-1', 'section', {
        title: 'Overview',
        parentId: 'doc:notes/alpha.md',
        relativePath: 'notes/alpha.md',
        location: { kind: 'text', lineStart: 1, lineEnd: 6 }
      })
    },
    references: [
      { fromId: 'doc:index.md', toId: 'doc:notes/alpha.md', label: 'notes/alpha' }
    ],
    diagnostics: [],
    ...overrides
  }
}

const MOUNT = folderMountId(ROOT)

function gid(knowledgeId: string): string {
  return `kn:${MOUNT}:${knowledgeId}`
}

function project(overrides: Partial<StoredKnowledgeIndex> | null = {}) {
  return buildNodeGraphFolderProjection({
    builtAt: BUILT_AT,
    roots: [{ root: ROOT, index: overrides === null ? null : index(overrides) }]
  })
}

function edge(
  projection: ReturnType<typeof project>,
  kind: string,
  from: string,
  to: string
): boolean {
  return projection.edges.some(
    (candidate) => candidate.kind === kind && candidate.from === from && candidate.to === to
  )
}

describe('buildNodeGraphFolderProjection', () => {
  it('renders folders, documents, and sections', () => {
    const projection = project()
    expect(projection.counts.folder).toBe(2)
    expect(projection.counts.document).toBe(2)
    expect(projection.counts.section).toBe(1)
    expect(projection.workspace).toBe(ROOT)
  })

  it('labels the root node with the directory name', () => {
    const root = project().nodes.find((item) => item.id === gid('root:.'))
    expect(root?.kind).toBe('folder')
    expect(root?.label).toBe('vault')
  })

  it('labels documents by file name and keeps their path and folder', () => {
    const document = project().nodes.find((item) => item.id === gid('doc:notes/alpha.md'))
    expect(document?.label).toBe('alpha.md')
    expect(document?.path).toBe('notes/alpha.md')
    expect(document?.folder).toBe('notes')
  })

  it('nests containment exactly as the directory tree does', () => {
    const projection = project()
    expect(edge(projection, 'contains', gid('root:.'), gid('dir:notes'))).toBe(true)
    expect(edge(projection, 'contains', gid('dir:notes'), gid('doc:notes/alpha.md'))).toBe(true)
    expect(edge(projection, 'contains', gid('root:.'), gid('doc:index.md'))).toBe(true)
    expect(edge(projection, 'contains', gid('doc:notes/alpha.md'), gid('sec:alpha-1'))).toBe(true)
    // A folder two levels up must not gain a direct edge to a nested file.
    expect(edge(projection, 'contains', gid('root:.'), gid('doc:notes/alpha.md'))).toBe(false)
  })

  it('turns wikilinks into link edges between documents', () => {
    const projection = project()
    expect(edge(projection, 'link', gid('doc:index.md'), gid('doc:notes/alpha.md'))).toBe(true)
    expect(projection.edges.find((item) => item.kind === 'link')?.label).toBe('notes/alpha')
  })

  it('drops a reference whose target is not in the index', () => {
    const projection = project({
      references: [{ fromId: 'doc:index.md', toId: 'doc:missing.md', label: 'missing' }]
    })
    expect(projection.edges.some((item) => item.kind === 'link')).toBe(false)
  })

  it('carries no threads, memories, or agents', () => {
    const kinds = new Set(project().nodes.map((item) => item.kind))
    expect(kinds.has('thread')).toBe(false)
    expect(kinds.has('memory')).toBe(false)
    expect(kinds.has('agent')).toBe(false)
  })

  it('weights nodes by degree', () => {
    const projection = project()
    const document = projection.nodes.find((item) => item.id === gid('doc:index.md'))
    // Contained by root, and links to alpha.
    expect(document?.degree).toBe(2)
  })

  it('reports a missing index instead of rendering an empty graph silently', () => {
    const projection = project(null)
    expect(projection.nodes).toEqual([])
    expect(projection.diagnostics.join(' ')).toContain('no ready index yet')
    expect(projection.workspace).toBe(ROOT)
  })

  it('surfaces index diagnostics', () => {
    const projection = project({ diagnostics: ['Skipped huge.md: too large'] })
    expect(projection.diagnostics.join(' ')).toContain('Skipped huge.md')
  })

  it('caps sections per document', () => {
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, position) => [
        `sec:${position}`,
        node(`sec:${position}`, 'section', {
          title: `S${position}`, parentId: 'doc:index.md', relativePath: 'index.md'
        })
      ])
    )
    const projection = buildNodeGraphFolderProjection({
      builtAt: BUILT_AT,
      roots: [{ root: ROOT, index: index({ nodes: { ...index().nodes, ...many } }) }],
      limits: { maxSectionsPerDocument: 4 }
    })
    expect(projection.nodes.filter((item) => item.kind === 'section')).toHaveLength(5)
  })

  it('is deterministic and gives a stable mount id per root', () => {
    expect(JSON.stringify(project())).toBe(JSON.stringify(project()))
    expect(folderMountId(ROOT)).toBe(folderMountId(ROOT))
    expect(folderMountId(ROOT)).not.toBe(folderMountId('/Users/me/other'))
  })
})

const OTHER = '/Users/me/wp'
const OTHER_MOUNT = folderMountId(OTHER)

/** wp/docs/spec.md, linking back up into the vault. */
function otherIndex(
  overrides: Partial<StoredKnowledgeIndex> = {}
): StoredKnowledgeIndex {
  return {
    version: 3,
    root: OTHER,
    fingerprint: 'fp2',
    builtAt: BUILT_AT,
    rootNodeId: 'root:.',
    documents: [],
    nodes: {
      'root:.': node('root:.', 'root', { title: 'wp', childIds: ['dir:docs'] }),
      'dir:docs': node('dir:docs', 'directory', {
        title: 'docs', parentId: 'root:.', childIds: ['doc:docs/spec.md'], relativePath: 'docs'
      }),
      'doc:docs/spec.md': node('doc:docs/spec.md', 'document', {
        title: 'spec.md', parentId: 'dir:docs', relativePath: 'docs/spec.md'
      })
    },
    references: [],
    diagnostics: [],
    ...overrides
  }
}

function multi(
  vaultOverrides: Partial<StoredKnowledgeIndex> = {},
  otherOverrides: Partial<StoredKnowledgeIndex> = {}
) {
  return buildNodeGraphFolderProjection({
    builtAt: BUILT_AT,
    roots: [
      { root: ROOT, index: index(vaultOverrides) },
      { root: OTHER, index: otherIndex(otherOverrides) }
    ]
  })
}

function ogid(knowledgeId: string): string {
  return `kn:${OTHER_MOUNT}:${knowledgeId}`
}

describe('multi-root folder projections', () => {
  it('renders every root as its own tree', () => {
    const projection = multi()
    expect(projection.counts.folder).toBe(4)
    expect(projection.counts.document).toBe(3)
    // No single workspace owns the projection, so the field is omitted.
    expect(projection.workspace).toBeUndefined()
  })

  it('keeps roots in separate id spaces', () => {
    const projection = multi()
    expect(projection.nodes.some((item) => item.id === gid('root:.'))).toBe(true)
    expect(projection.nodes.some((item) => item.id === ogid('root:.'))).toBe(true)
  })

  it('tags each node with the workspace it came from', () => {
    const projection = multi()
    expect(projection.nodes.find((item) => item.id === ogid('doc:docs/spec.md'))?.workspace)
      .toBe(OTHER)
  })

  it('resolves a link that escapes its own root into a sibling workspace', () => {
    // `vault/index.md` writing `[[../wp/docs/spec]]` — dropped entirely before,
    // because the index resolver rejects a target that leaves the base.
    const projection = multi({
      externalReferences: [
        {
          fromId: 'doc:index.md',
          sourcePath: 'index.md',
          target: '../wp/docs/spec',
          label: 'spec'
        }
      ]
    })
    expect(edge(projection, 'link', gid('doc:index.md'), ogid('doc:docs/spec.md'))).toBe(true)
  })

  it('resolves a cross-root link written with its extension', () => {
    const projection = multi({
      externalReferences: [
        {
          fromId: 'doc:index.md',
          sourcePath: 'index.md',
          target: '../wp/docs/spec.md',
          label: 'spec'
        }
      ]
    })
    expect(edge(projection, 'link', gid('doc:index.md'), ogid('doc:docs/spec.md'))).toBe(true)
  })

  it('resolves a cross-root link from a nested source file', () => {
    const projection = multi({
      externalReferences: [
        {
          fromId: 'doc:notes/alpha.md',
          sourcePath: 'notes/alpha.md',
          target: '../../wp/docs/spec',
          label: 'spec'
        }
      ]
    })
    expect(edge(projection, 'link', gid('doc:notes/alpha.md'), ogid('doc:docs/spec.md')))
      .toBe(true)
  })

  it('resolves an absolute cross-root link', () => {
    const projection = multi({
      externalReferences: [
        {
          fromId: 'doc:index.md',
          sourcePath: 'index.md',
          target: `${OTHER}/docs/spec.md`,
          label: 'spec'
        }
      ]
    })
    expect(edge(projection, 'link', gid('doc:index.md'), ogid('doc:docs/spec.md'))).toBe(true)
  })

  it('ignores a cross-root link to a file no projected root contains', () => {
    const projection = multi({
      externalReferences: [
        {
          fromId: 'doc:index.md',
          sourcePath: 'index.md',
          target: '../elsewhere/ghost',
          label: 'ghost'
        }
      ]
    })
    expect(projection.edges.some((item) => item.kind === 'link' &&
      item.from === gid('doc:index.md') && item.to !== gid('doc:notes/alpha.md'))).toBe(false)
  })

  it('ignores a url target', () => {
    const projection = multi({
      externalReferences: [
        {
          fromId: 'doc:index.md',
          sourcePath: 'index.md',
          target: 'https://example.com/spec.md',
          label: 'web'
        }
      ]
    })
    expect(projection.edges.filter((item) => item.kind === 'link')).toHaveLength(1)
  })

  it('still draws same-root links alongside cross-root ones', () => {
    const projection = multi({
      externalReferences: [
        {
          fromId: 'doc:index.md',
          sourcePath: 'index.md',
          target: '../wp/docs/spec',
          label: 'spec'
        }
      ]
    })
    expect(edge(projection, 'link', gid('doc:index.md'), gid('doc:notes/alpha.md'))).toBe(true)
    expect(projection.edges.filter((item) => item.kind === 'link')).toHaveLength(2)
  })

  it('reports one unindexed root without losing the other', () => {
    const projection = buildNodeGraphFolderProjection({
      builtAt: BUILT_AT,
      roots: [{ root: ROOT, index: index() }, { root: OTHER, index: null }]
    })
    expect(projection.nodes.some((item) => item.id === gid('doc:index.md'))).toBe(true)
    expect(projection.diagnostics.join(' ')).toContain('no ready index yet')
  })

  it('ignores blank roots', () => {
    const projection = buildNodeGraphFolderProjection({
      builtAt: BUILT_AT,
      roots: [{ root: '   ', index: null }, { root: ROOT, index: index() }]
    })
    expect(projection.workspace).toBe(ROOT)
  })

  it('is deterministic', () => {
    expect(JSON.stringify(multi())).toBe(JSON.stringify(multi()))
  })
})
