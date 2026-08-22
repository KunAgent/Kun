import { describe, expect, it } from 'vitest'
import { buildNodeGraphProjection } from './node-graph-builder.js'
import type { StoredKnowledgeIndex } from '../knowledge/knowledge-types.js'
import type { NodeGraphBuildInput } from './node-graph-inputs.js'

const BUILT_AT = '2026-08-18T00:00:00.000Z'

function index(overrides: Partial<StoredKnowledgeIndex> = {}): StoredKnowledgeIndex {
  return {
    version: 3,
    root: '/vault',
    fingerprint: 'fp',
    builtAt: BUILT_AT,
    rootNodeId: 'root:.',
    documents: [],
    nodes: {
      'root:.': {
        id: 'root:.', kind: 'root', title: 'vault', summary: '',
        parentId: null, childIds: ['doc:a.md', 'doc:b.md']
      },
      'doc:a.md': {
        id: 'doc:a.md', kind: 'document', title: 'a.md', summary: 'note a',
        parentId: 'root:.', childIds: ['sec:a1'], relativePath: 'notes/a.md'
      },
      'sec:a1': {
        id: 'sec:a1', kind: 'section', title: 'Heading', summary: 'body',
        parentId: 'doc:a.md', childIds: [], relativePath: 'notes/a.md',
        location: { kind: 'text', lineStart: 1, lineEnd: 4 }
      },
      'doc:b.md': {
        id: 'doc:b.md', kind: 'document', title: 'b.md', summary: 'note b',
        parentId: 'root:.', childIds: [], relativePath: 'b.md'
      }
    },
    references: [{ fromId: 'doc:a.md', toId: 'doc:b.md', label: 'b' }],
    diagnostics: [],
    ...overrides
  }
}

function input(overrides: Partial<NodeGraphBuildInput> = {}): NodeGraphBuildInput {
  return {
    builtAt: BUILT_AT,
    workspace: '/repo',
    threads: [
      { id: 't1', title: 'Root chat', workspace: '/repo', status: 'idle', updatedAt: BUILT_AT },
      {
        id: 't2', title: 'Fork', workspace: '/repo', status: 'idle',
        forkedFromThreadId: 't1', agentId: 'reviewer', updatedAt: BUILT_AT
      }
    ],
    ...overrides
  }
}

function kindsOf(projection: ReturnType<typeof buildNodeGraphProjection>): string[] {
  return [...new Set(projection.nodes.map((node) => node.kind))].sort()
}

function edge(
  projection: ReturnType<typeof buildNodeGraphProjection>,
  kind: string,
  from: string,
  to: string
): boolean {
  return projection.edges.some(
    (candidate) => candidate.kind === kind && candidate.from === from && candidate.to === to
  )
}

describe('buildNodeGraphProjection', () => {
  it('links threads to their workspace, fork parent, and agent', () => {
    const projection = buildNodeGraphProjection(input())
    expect(kindsOf(projection)).toEqual(['agent', 'thread', 'workspace'])
    expect(edge(projection, 'workspace', 'thread:t1', 'workspace:/repo')).toBe(true)
    expect(edge(projection, 'fork', 'thread:t2', 'thread:t1')).toBe(true)
    expect(edge(projection, 'agent', 'thread:t2', 'agent:reviewer')).toBe(true)
    expect(projection.workspace).toBe('/repo')
    expect(projection.truncated).toBe(false)
  })

  it('drops relations whose other endpoint is outside the projection', () => {
    const projection = buildNodeGraphProjection(input({
      threads: [{ id: 't2', title: 'Orphan fork', workspace: '/repo', forkedFromThreadId: 'gone' }]
    }))
    expect(projection.edges.filter((item) => item.kind === 'fork')).toHaveLength(0)
    expect(projection.nodes.some((node) => node.id === 'thread:gone')).toBe(false)
  })

  it('projects knowledge documents, sections, and wikilink references', () => {
    const projection = buildNodeGraphProjection(input({
      knowledgeBases: [
        { mountId: 'kb1', mountName: 'Vault', state: 'ready', index: index(), threadIds: ['t1'] }
      ]
    }))
    expect(kindsOf(projection)).toContain('document')
    expect(kindsOf(projection)).toContain('section')
    expect(edge(projection, 'mount', 'thread:t1', 'kb:kb1')).toBe(true)
    expect(edge(projection, 'contains', 'kb:kb1', 'kn:kb1:doc:a.md')).toBe(true)
    expect(edge(projection, 'contains', 'kn:kb1:doc:a.md', 'kn:kb1:sec:a1')).toBe(true)
    expect(edge(projection, 'link', 'kn:kb1:doc:a.md', 'kn:kb1:doc:b.md')).toBe(true)
    const document = projection.nodes.find((node) => node.id === 'kn:kb1:doc:a.md')
    expect(document?.label).toBe('a.md')
    expect(document?.folder).toBe('notes')
    expect(document?.path).toBe('notes/a.md')
  })

  it('reports a knowledge base with no ready index instead of hiding it', () => {
    const projection = buildNodeGraphProjection(input({
      knowledgeBases: [
        { mountId: 'kb1', mountName: 'Vault', state: 'pending', index: null, threadIds: ['t1'] }
      ]
    }))
    expect(projection.nodes.some((node) => node.id === 'kb:kb1')).toBe(true)
    expect(projection.diagnostics.join(' ')).toContain('no ready index')
  })

  it('collapses a shared knowledge base into one hub node', () => {
    const projection = buildNodeGraphProjection(input({
      knowledgeBases: [
        { mountId: 'kb1', mountName: 'Vault', index: index(), threadIds: ['t1', 't2'] }
      ]
    }))
    expect(projection.nodes.filter((node) => node.kind === 'knowledgeBase')).toHaveLength(1)
    expect(edge(projection, 'mount', 'thread:t1', 'kb:kb1')).toBe(true)
    expect(edge(projection, 'mount', 'thread:t2', 'kb:kb1')).toBe(true)
  })

  it('links memories to their source thread, workspace, and tags', () => {
    const projection = buildNodeGraphProjection(input({
      memories: [
        {
          id: 'm1', content: 'Prefer targeted vitest runs', scope: 'workspace',
          workspace: '/repo', tags: ['Testing', 'testing'], sourceThreadId: 't1',
          updatedAt: BUILT_AT
        },
        { id: 'm2', content: 'deleted', scope: 'workspace', deletedAt: BUILT_AT }
      ]
    }))
    expect(projection.nodes.some((node) => node.id === 'memory:m2')).toBe(false)
    expect(edge(projection, 'memoryOf', 'memory:m1', 'thread:t1')).toBe(true)
    expect(edge(projection, 'workspace', 'memory:m1', 'workspace:/repo')).toBe(true)
    // Tag ids are case-folded so `Testing` and `testing` are one node.
    expect(projection.nodes.filter((node) => node.kind === 'tag')).toHaveLength(1)
    expect(edge(projection, 'tagged', 'memory:m1', 'tag:testing')).toBe(true)
  })

  it('adds file nodes for changed files of known threads only', () => {
    const projection = buildNodeGraphProjection(input({
      changedFiles: [
        { threadId: 't1', workspace: '/repo', files: ['src/a.ts', 'src/a.ts'] },
        { threadId: 'unknown', workspace: '/repo', files: ['src/z.ts'] }
      ]
    }))
    expect(projection.nodes.filter((node) => node.kind === 'file')).toHaveLength(1)
    expect(edge(projection, 'touches', 'thread:t1', 'file:/repo:src/a.ts')).toBe(true)
    expect(projection.nodes.some((node) => node.path === 'src/z.ts')).toBe(false)
  })

  it('weights nodes by degree so the UI can size them like Obsidian', () => {
    const projection = buildNodeGraphProjection(input())
    const workspace = projection.nodes.find((node) => node.kind === 'workspace')
    const agent = projection.nodes.find((node) => node.kind === 'agent')
    expect(workspace?.degree).toBe(2)
    expect(agent?.degree).toBe(1)
  })

  it('keeps structural nodes when the node cap truncates a large vault', () => {
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, position) => [
        `sec:${position}`,
        {
          id: `sec:${position}`, kind: 'section' as const, title: `S${position}`, summary: '',
          parentId: 'doc:a.md', childIds: [], relativePath: 'notes/a.md'
        }
      ])
    )
    const projection = buildNodeGraphProjection(input({
      knowledgeBases: [{
        mountId: 'kb1', mountName: 'Vault', threadIds: ['t1'],
        index: index({ nodes: { ...index().nodes, ...many } })
      }],
      limits: { maxNodes: 8 }
    }))
    expect(projection.nodes).toHaveLength(8)
    expect(projection.truncated).toBe(true)
    expect(projection.nodes.filter((node) => node.kind === 'thread')).toHaveLength(2)
    // Structural tiers fill first; sections only take whatever budget is left.
    expect(projection.nodes.filter((node) => node.kind === 'section')).toHaveLength(1)
    expect(projection.counts.section).toBe(41)
    expect(projection.diagnostics.join(' ')).toContain('node cap reached')
  })

  it('caps sections per document', () => {
    const many = Object.fromEntries(
      Array.from({ length: 10 }, (_, position) => [
        `sec:${position}`,
        {
          id: `sec:${position}`, kind: 'section' as const, title: `S${position}`, summary: '',
          parentId: 'doc:a.md', childIds: [], relativePath: 'notes/a.md'
        }
      ])
    )
    const projection = buildNodeGraphProjection(input({
      knowledgeBases: [{
        mountId: 'kb1', mountName: 'Vault', threadIds: ['t1'],
        index: index({ nodes: { ...index().nodes, ...many } })
      }],
      limits: { maxSectionsPerDocument: 3 }
    }))
    expect(projection.nodes.filter((node) => node.kind === 'section')).toHaveLength(3)
  })

  it('is deterministic for the same input', () => {
    const first = buildNodeGraphProjection(input())
    const second = buildNodeGraphProjection(input())
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})
