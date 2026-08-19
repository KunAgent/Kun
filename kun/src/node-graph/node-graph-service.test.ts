import { describe, expect, it } from 'vitest'
import { NodeGraphService, type NodeGraphRunSource } from './node-graph-service.js'
import type { ThreadSummary } from '../contracts/threads.js'

const BUILT_AT = '2026-08-18T00:00:00.000Z'

function thread(overrides: Partial<ThreadSummary> & { id: string }): ThreadSummary {
  return {
    title: overrides.id,
    workspace: '/repo',
    model: 'deepseek-chat',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    approvalReviewer: 'user',
    relation: 'primary',
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
    ...overrides
  } as ThreadSummary
}

function service(options: {
  threads?: ThreadSummary[]
  runs?: NodeGraphRunSource
  memories?: unknown[]
  cacheTtlMs?: number
  changedFilesTimeoutMs?: number
  maxRuns?: number
} = {}): NodeGraphService {
  return new NodeGraphService({
    threads: { list: async () => options.threads ?? [] },
    ...(options.memories
      ? { memoryStore: () => ({ list: async () => options.memories }) as never }
      : {}),
    ...(options.runs ? { runs: options.runs } : {}),
    nowIso: () => BUILT_AT,
    ...(options.cacheTtlMs !== undefined ? { cacheTtlMs: options.cacheTtlMs } : {}),
    ...(options.changedFilesTimeoutMs !== undefined
      ? { changedFilesTimeoutMs: options.changedFilesTimeoutMs }
      : {}),
    ...(options.maxRuns !== undefined ? { maxRuns: options.maxRuns } : {})
  })
}

describe('NodeGraphService', () => {
  it('restricts the projection to one workspace including additional mounts', async () => {
    const projection = await service({
      threads: [
        thread({ id: 'a', workspace: '/repo' }),
        thread({ id: 'b', workspace: '/other' }),
        thread({ id: 'c', workspace: '/other', additionalWorkspaces: ['/repo'] })
      ]
    }).project({ workspace: '/repo' })
    const threads = projection.nodes.filter((node) => node.kind === 'thread').map((node) => node.threadId)
    expect(threads.sort()).toEqual(['a', 'c'])
    expect(projection.workspace).toBe('/repo')
  })

  it('spans every workspace when none is requested', async () => {
    const projection = await service({
      threads: [thread({ id: 'a', workspace: '/repo' }), thread({ id: 'b', workspace: '/other' })]
    }).project()
    expect(projection.nodes.filter((node) => node.kind === 'workspace')).toHaveLength(2)
    expect(projection.workspace).toBeUndefined()
  })

  it('aggregates changed files from the most recent runs only', async () => {
    const runs: NodeGraphRunSource = {
      list: async () => [
        { threadId: 'a', updatedAt: '2026-08-18T03:00:00.000Z', summary: { changedFiles: ['src/new.ts'] } },
        { threadId: 'a', updatedAt: '2026-08-18T01:00:00.000Z', summary: { changedFiles: ['src/old.ts'] } }
      ]
    }
    const projection = await service({ threads: [thread({ id: 'a' })], runs, maxRuns: 1 }).project()
    const files = projection.nodes.filter((node) => node.kind === 'file').map((node) => node.path)
    expect(files).toEqual(['src/new.ts'])
  })

  it('skips changed files when the caller opts out', async () => {
    const runs: NodeGraphRunSource = {
      list: async () => {
        throw new Error('should not be called')
      }
    }
    const projection = await service({ threads: [thread({ id: 'a' })], runs })
      .project({ includeChangedFiles: false })
    expect(projection.nodes.some((node) => node.kind === 'file')).toBe(false)
    expect(projection.diagnostics).toEqual([])
  })

  it('degrades to a diagnostic when the run scan exceeds its budget', async () => {
    const runs: NodeGraphRunSource = { list: () => new Promise(() => undefined) }
    const projection = await service({
      threads: [thread({ id: 'a' })],
      runs,
      changedFilesTimeoutMs: 5
    }).project()
    expect(projection.nodes.some((node) => node.kind === 'file')).toBe(false)
    expect(projection.diagnostics.join(' ')).toContain('exceeded 5ms')
  })

  it('reports a failing run scan without failing the projection', async () => {
    const runs: NodeGraphRunSource = {
      list: async () => {
        throw new Error('journal corrupt')
      }
    }
    const projection = await service({ threads: [thread({ id: 'a' })], runs }).project()
    expect(projection.nodes.some((node) => node.kind === 'thread')).toBe(true)
    expect(projection.diagnostics.join(' ')).toContain('journal corrupt')
  })

  it('serves a cached projection until refresh is requested', async () => {
    let calls = 0
    const instance = new NodeGraphService({
      threads: {
        list: async () => {
          calls += 1
          return [thread({ id: 'a' })]
        }
      },
      nowIso: () => BUILT_AT
    })
    await instance.project()
    await instance.project()
    expect(calls).toBe(1)
    await instance.project({ refresh: true })
    expect(calls).toBe(2)
    instance.invalidate()
    await instance.project()
    expect(calls).toBe(3)
  })

  it('caches the changed-file and no-changed-file projections separately', async () => {
    let calls = 0
    const instance = new NodeGraphService({
      threads: {
        list: async () => {
          calls += 1
          return [thread({ id: 'a' })]
        }
      },
      nowIso: () => BUILT_AT
    })
    await instance.project({ includeChangedFiles: true })
    await instance.project({ includeChangedFiles: false })
    expect(calls).toBe(2)
  })

  it('surfaces a thread listing failure as a diagnostic', async () => {
    const instance = new NodeGraphService({
      threads: {
        list: async () => {
          throw new Error('store offline')
        }
      },
      nowIso: () => BUILT_AT
    })
    const projection = await instance.project()
    expect(projection.nodes).toEqual([])
    expect(projection.diagnostics.join(' ')).toContain('store offline')
  })
})
