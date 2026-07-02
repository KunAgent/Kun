import { describe, expect, it } from 'vitest'
import {
  VirtualToolCatalog,
  type VirtualToolEntry
} from '../src/adapters/tool/virtual-tool-catalog.js'

const entries: VirtualToolEntry[] = [
  {
    id: 'builtin:read',
    name: 'read',
    kind: 'builtin',
    description: 'Read a file from disk',
    alwaysOn: true
  },
  {
    id: 'mcp:gh/create_issue',
    name: 'create_issue',
    kind: 'mcp',
    description: 'Create a GitHub issue',
    keywords: ['github', 'issue', 'tracker']
  },
  {
    id: 'mcp:db/query',
    name: 'sql_query',
    kind: 'mcp',
    description: 'Run a SQL query against the database',
    keywords: ['database', 'sql', 'postgres'],
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } }
    }
  },
  {
    id: 'skill:pdf',
    name: 'pdf_extract',
    kind: 'skill',
    description: 'Extract text from a PDF document',
    keywords: ['pdf', 'document']
  }
]

describe('VirtualToolCatalog', () => {
  it('searches across names, descriptions, and keywords', () => {
    const catalog = new VirtualToolCatalog(entries)
    expect(catalog.search('github issue')[0]?.entry.id).toBe('mcp:gh/create_issue')
  })

  it('filters search by tool kind and exposes always-on entries', () => {
    const catalog = new VirtualToolCatalog(entries)
    const results = catalog.search('query database', { kinds: ['mcp'] })
    expect(results.every((result) => result.entry.kind === 'mcp')).toBe(true)
    expect(results[0]?.entry.id).toBe('mcp:db/query')
    expect(catalog.alwaysOn().map((entry) => entry.id)).toEqual(['builtin:read'])
  })

  it('changes version when a same-id schema changes', () => {
    const catalog = new VirtualToolCatalog(entries)
    const previous = catalog.currentVersion()
    catalog.replaceAll(entries.map((entry) =>
      entry.id === 'mcp:db/query'
        ? { ...entry, inputSchema: { type: 'object', required: ['query'] } }
        : entry
    ))
    expect(catalog.currentVersion()).not.toBe(previous)
  })

  it('keeps a frozen view stable while reporting live catalog drift', () => {
    const catalog = new VirtualToolCatalog(entries)
    const frozen = catalog.freeze()
    catalog.replaceAll([
      ...entries,
      {
        id: 'connector:slack',
        name: 'post',
        kind: 'connector',
        description: 'Post to a Slack channel'
      }
    ])

    expect(frozen.pendingUpdate()).toBe(true)
    expect(frozen.has('connector:slack')).toBe(false)
    expect(frozen.search('slack channel')).toEqual([])
  })

  it('isolates frozen metadata from a live same-id replacement', () => {
    const catalog = new VirtualToolCatalog(entries)
    const frozen = catalog.freeze()
    catalog.replaceAll(entries.map((entry) =>
      entry.id === 'mcp:db/query'
        ? { ...entry, description: 'Run a new parameterized query' }
        : entry
    ))

    expect(frozen.load('mcp:db/query')?.description).toBe('Run a SQL query against the database')
    expect(frozen.pendingUpdate()).toBe(true)
  })
})
