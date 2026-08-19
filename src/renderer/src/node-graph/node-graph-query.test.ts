import { describe, expect, it } from 'vitest'
import { matchesNodeGraphQuery, parseNodeGraphQuery } from './node-graph-query'
import type { NodeGraphNode } from './node-graph-types'

function node(overrides: Partial<NodeGraphNode> = {}): NodeGraphNode {
  return {
    id: 'kn:kb1:doc',
    kind: 'document',
    label: 'Release Notes.md',
    subtitle: 'shipping checklist',
    path: 'docs/release/notes.md',
    folder: 'docs/release',
    degree: 3,
    ...overrides
  }
}

function matches(query: string, target: NodeGraphNode = node()): boolean {
  return matchesNodeGraphQuery(target, parseNodeGraphQuery(query))
}

describe('node graph query', () => {
  it('matches label, subtitle, and path substrings case-insensitively', () => {
    expect(matches('release')).toBe(true)
    expect(matches('CHECKLIST')).toBe(true)
    expect(matches('notes.md')).toBe(true)
    expect(matches('absent')).toBe(false)
  })

  it('combines terms with AND', () => {
    expect(matches('release checklist')).toBe(true)
    expect(matches('release absent')).toBe(false)
  })

  it('excludes terms with a leading dash', () => {
    expect(matches('release -checklist')).toBe(false)
    expect(matches('release -absent')).toBe(true)
  })

  it('matches kind exactly', () => {
    expect(matches('kind:document')).toBe(true)
    expect(matches('kind:doc')).toBe(false)
    expect(matches('kind:thread')).toBe(false)
  })

  it('matches folder on exact value or prefix segment', () => {
    expect(matches('folder:docs/release')).toBe(true)
    expect(matches('folder:docs')).toBe(true)
    // A prefix must land on a segment boundary, so `doc` is not `docs`.
    expect(matches('folder:doc')).toBe(false)
  })

  it('matches tags without their leading hash', () => {
    const tag = node({ kind: 'tag', tag: 'Testing', label: '#Testing' })
    expect(matchesNodeGraphQuery(tag, parseNodeGraphQuery('tag:testing'))).toBe(true)
    expect(matchesNodeGraphQuery(tag, parseNodeGraphQuery('tag:#testing'))).toBe(true)
    expect(matchesNodeGraphQuery(tag, parseNodeGraphQuery('tag:other'))).toBe(false)
  })

  it('matches state and workspace fields', () => {
    const thread = node({ kind: 'thread', state: 'running', workspace: '/Users/me/repo' })
    expect(matchesNodeGraphQuery(thread, parseNodeGraphQuery('state:running'))).toBe(true)
    expect(matchesNodeGraphQuery(thread, parseNodeGraphQuery('workspace:repo'))).toBe(true)
    expect(matchesNodeGraphQuery(thread, parseNodeGraphQuery('state:idle'))).toBe(false)
  })

  it('treats an unknown field prefix as plain text', () => {
    expect(parseNodeGraphQuery('color:red')).toEqual([
      { field: 'text', value: 'color:red', negated: false }
    ])
  })

  it('matches nothing for an empty query so a blank group never colors nodes', () => {
    expect(parseNodeGraphQuery('   ')).toEqual([])
    expect(matches('')).toBe(false)
  })
})
