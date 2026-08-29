import { describe, expect, it } from 'vitest'
import { getNodeGraph, getNodeGraphFolder } from './node-graph.js'
import { NodeGraphService } from '../../node-graph/index.js'
import type { ThreadSummary } from '../../contracts/threads.js'

const BUILT_AT = '2026-08-18T00:00:00.000Z'

function thread(id: string, workspace: string): ThreadSummary {
  return {
    id,
    title: id,
    workspace,
    model: 'deepseek-chat',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    approvalReviewer: 'user',
    relation: 'primary',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT
  } as ThreadSummary
}

function service(threads: ThreadSummary[] = []): NodeGraphService {
  return new NodeGraphService({
    threads: { list: async () => threads },
    nowIso: () => BUILT_AT
  })
}

function request(query = ''): Request {
  return new Request(`http://127.0.0.1:1/v1/node-graph${query}`)
}

function payload<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T
}

describe('GET /v1/node-graph', () => {
  it('reports unavailable when the projection service is absent', async () => {
    const response = await getNodeGraph(undefined, request())
    expect(response.status).toBe(503)
  })

  it('returns a contract-valid projection', async () => {
    const response = await getNodeGraph(
      service([thread('a', '/repo')]),
      request('?workspace=%2Frepo')
    )
    expect(response.status).toBe(200)
    const body = payload<{ nodes: unknown[]; workspace?: string; version: number }>(response)
    expect(body.version).toBe(1)
    expect(body.workspace).toBe('/repo')
    expect(body.nodes.length).toBeGreaterThan(0)
  })

  it('spans every workspace when the query omits one', async () => {
    const response = await getNodeGraph(
      service([thread('a', '/one'), thread('b', '/two')]),
      request()
    )
    const body = payload<{ workspace?: string; counts: Record<string, number> }>(response)
    expect(body.workspace).toBeUndefined()
    expect(body.counts.workspace).toBe(2)
  })

  it('ignores a blank workspace parameter', async () => {
    const response = await getNodeGraph(service([thread('a', '/repo')]), request('?workspace=%20'))
    expect(payload<{ workspace?: string }>(response).workspace).toBeUndefined()
  })

  it('turns a projection failure into a 500 instead of throwing', async () => {
    const broken = {
      project: async () => {
        throw new Error('boom')
      }
    } as unknown as NodeGraphService
    const response = await getNodeGraph(broken, request())
    expect(response.status).toBe(500)
  })
})

describe('GET /v1/node-graph/folder', () => {
  function folderRequest(query = ''): Request {
    return new Request(`http://127.0.0.1:1/v1/node-graph/folder${query}`)
  }

  it('reports unavailable without a projection service', async () => {
    expect((await getNodeGraphFolder(undefined, folderRequest('?root=%2Fvault'))).status).toBe(503)
  })

  it('rejects a missing or blank root', async () => {
    expect((await getNodeGraphFolder(service(), folderRequest())).status).toBe(400)
    expect((await getNodeGraphFolder(service(), folderRequest('?root=%20'))).status).toBe(400)
  })

  it('rejects a request with more roots than the hard cap', async () => {
    const query = `?${Array.from({ length: 65 }, (_, index) => `root=%2Fr${index}`).join('&')}`
    const response = await getNodeGraphFolder(service(), folderRequest(query))
    expect(response.status).toBe(400)
    expect(response.body).toContain('64')
  })

  it('accepts repeated root parameters', async () => {
    const seen: string[][] = []
    const multi = {
      projectFolder: async (roots: readonly string[]) => {
        seen.push([...roots])
        return {
          version: 1 as const,
          builtAt: BUILT_AT,
          nodes: [],
          edges: [],
          counts: {},
          truncated: false,
          diagnostics: []
        }
      }
    } as unknown as NodeGraphService
    const response = await getNodeGraphFolder(multi, folderRequest('?root=%2Fa&root=%2Fb'))
    expect(response.status).toBe(200)
    expect(seen[0]).toEqual(['/a', '/b'])
  })

  it('reports the missing index rather than failing when nothing is indexed', async () => {
    const response = await getNodeGraphFolder(service(), folderRequest('?root=%2Fvault'))
    expect(response.status).toBe(200)
    const body = payload<{ workspace?: string; diagnostics: string[]; nodes: unknown[] }>(response)
    expect(body.workspace).toBe('/vault')
    expect(body.nodes).toEqual([])
    expect(body.diagnostics.join(' ')).toContain('not available')
  })

  it('turns a projection failure into a 500', async () => {
    const broken = {
      projectFolder: async () => {
        throw new Error('boom')
      }
    } as unknown as NodeGraphService
    expect((await getNodeGraphFolder(broken, folderRequest('?root=%2Fvault'))).status).toBe(500)
  })
})
