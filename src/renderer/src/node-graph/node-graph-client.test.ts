import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchNodeGraph,
  fetchNodeGraphFolder,
  nodeGraphFolderRequestPath,
  nodeGraphRequestPath,
  normalizeNodeGraphProjection
} from './node-graph-client'

function installRuntime(result: { ok: boolean; status: number; body: string }): {
  paths: string[]
} {
  const paths: string[] = []
  ;(globalThis as { window?: unknown }).window = {
    kunGui: {
      runtimeRequest: (path: string) => {
        paths.push(path)
        return Promise.resolve(result)
      }
    }
  }
  return { paths }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  vi.resetModules()
})

describe('nodeGraphRequestPath', () => {
  it('omits the query string when nothing is scoped', () => {
    expect(nodeGraphRequestPath()).toBe('/v1/node-graph')
  })

  it('encodes workspace, opt-out, and refresh', () => {
    const path = nodeGraphRequestPath({
      workspace: '/Users/me/my repo',
      includeChangedFiles: false,
      refresh: true
    })
    expect(path).toContain('workspace=%2FUsers%2Fme%2Fmy+repo')
    expect(path).toContain('changed_files=false')
    expect(path).toContain('refresh=true')
  })

  it('leaves changed_files unset when files are included', () => {
    expect(nodeGraphRequestPath({ includeChangedFiles: true })).toBe('/v1/node-graph')
  })
})

describe('normalizeNodeGraphProjection', () => {
  it('produces an empty projection from junk', () => {
    const projection = normalizeNodeGraphProjection(null)
    expect(projection.nodes).toEqual([])
    expect(projection.edges).toEqual([])
    expect(projection.truncated).toBe(false)
  })

  it('drops nodes with an unknown kind and edges that reference them', () => {
    const projection = normalizeNodeGraphProjection({
      version: 2,
      builtAt: 'now',
      nodes: [
        { id: 'a', kind: 'thread', label: 'A', degree: 1 },
        { id: 'b', kind: 'quantum', label: 'B', degree: 1 }
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b', kind: 'link' },
        { id: 'e2', from: 'a', to: 'a', kind: 'link' },
        { id: 'e3', from: 'a', to: 'a', kind: 'teleports' }
      ],
      counts: { thread: 1 },
      truncated: true,
      diagnostics: ['note', 42]
    })
    expect(projection.nodes.map((node) => node.id)).toEqual(['a'])
    expect(projection.edges.map((edge) => edge.id)).toEqual(['e2'])
    expect(projection.diagnostics).toEqual(['note'])
    expect(projection.truncated).toBe(true)
    expect(projection.version).toBe(2)
  })
})

describe('fetchNodeGraph', () => {
  it('returns a normalized projection on success', async () => {
    installRuntime({
      ok: true,
      status: 200,
      body: JSON.stringify({
        version: 1,
        builtAt: 'now',
        nodes: [{ id: 'a', kind: 'thread', label: 'A', degree: 0 }],
        edges: [],
        counts: {},
        truncated: false,
        diagnostics: []
      })
    })
    const projection = await fetchNodeGraph({ workspace: '/repo' })
    expect(projection.nodes).toHaveLength(1)
  })

  it('surfaces the runtime error message', async () => {
    installRuntime({
      ok: false,
      status: 503,
      body: JSON.stringify({ error: { message: 'node graph projection is not available' } })
    })
    await expect(fetchNodeGraph()).rejects.toThrow('node graph projection is not available')
  })

  it('reports the status when the error body is not JSON', async () => {
    installRuntime({ ok: false, status: 500, body: '<html>' })
    await expect(fetchNodeGraph()).rejects.toThrow('node graph request failed (500)')
  })

  it('rejects an unparseable success body', async () => {
    installRuntime({ ok: true, status: 200, body: 'not json' })
    await expect(fetchNodeGraph()).rejects.toThrow('invalid node graph response')
  })
})

describe('folder projection requests', () => {
  it('encodes the root and the refresh flag', () => {
    expect(nodeGraphFolderRequestPath(['/Users/me/my vault']))
      .toBe('/v1/node-graph/folder?root=%2FUsers%2Fme%2Fmy+vault')
    expect(nodeGraphFolderRequestPath(['/vault'], true)).toContain('refresh=true')
  })

  it('repeats the root parameter for several workspaces', () => {
    expect(nodeGraphFolderRequestPath(['/a', '/b']))
      .toBe('/v1/node-graph/folder?root=%2Fa&root=%2Fb')
  })

  it('skips blank roots', () => {
    expect(nodeGraphFolderRequestPath(['/a', '  ', ''])).toBe('/v1/node-graph/folder?root=%2Fa')
  })

  it('fetches and normalizes a folder projection', async () => {
    const { paths } = installRuntime({
      ok: true,
      status: 200,
      body: JSON.stringify({
        version: 1,
        builtAt: 'now',
        workspace: '/vault',
        nodes: [{ id: 'kn:folder-x:doc', kind: 'document', label: 'a.md', degree: 0 }],
        edges: [],
        counts: {},
        truncated: false,
        diagnostics: []
      })
    })
    const projection = await fetchNodeGraphFolder(['/vault'])
    expect(paths[0]).toContain('/v1/node-graph/folder')
    expect(projection.nodes[0]!.kind).toBe('document')
  })

  it('surfaces a folder request error', async () => {
    installRuntime({
      ok: false,
      status: 400,
      body: JSON.stringify({ error: { message: 'a root query parameter is required' } })
    })
    await expect(fetchNodeGraphFolder([])).rejects.toThrow('a root query parameter is required')
  })
})
