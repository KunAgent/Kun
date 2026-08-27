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

type FakeRun = {
  threadId: string
  updatedAt: string
  summary?: { changedFiles: readonly string[] }
}

/** A store-faithful fake: scope and cap are applied before anything returns. */
function runSource(all: readonly FakeRun[]): NodeGraphRunSource {
  return {
    list: async (filter) => {
      const scoped = all
        .filter((run) => !filter?.threadIds || filter.threadIds.includes(run.threadId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      return typeof filter?.limit === 'number' ? scoped.slice(0, filter.limit) : scoped
    }
  }
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
    const projection = await service({
      threads: [thread({ id: 'a' })],
      runs: runSource([
        { threadId: 'a', updatedAt: '2026-08-18T03:00:00.000Z', summary: { changedFiles: ['src/new.ts'] } },
        { threadId: 'a', updatedAt: '2026-08-18T01:00:00.000Z', summary: { changedFiles: ['src/old.ts'] } }
      ]),
      maxRuns: 1
    }).project()
    const files = projection.nodes.filter((node) => node.kind === 'file').map((node) => node.path)
    expect(files).toEqual(['src/new.ts'])
  })

  it('pushes the thread scope and run cap into the store query', async () => {
    const filters: unknown[] = []
    const runs: NodeGraphRunSource = {
      list: async (filter) => {
        filters.push(filter)
        return []
      }
    }
    await service({
      threads: [thread({ id: 'b' }), thread({ id: 'a' })],
      runs,
      maxRuns: 7
    }).project()
    expect(filters).toEqual([{ threadIds: ['a', 'b'], limit: 7 }])
  })

  it('keeps the selected workspace\'s runs when newer runs belong elsewhere', async () => {
    // The store applies scope before the cap, so a burst of runs in another
    // workspace can no longer crowd out this workspace's older runs.
    const runs = runSource([
      { threadId: 'other-1', updatedAt: '2026-08-18T05:00:00.000Z', summary: { changedFiles: ['x.ts'] } },
      { threadId: 'other-2', updatedAt: '2026-08-18T04:00:00.000Z', summary: { changedFiles: ['y.ts'] } },
      { threadId: 'mine', updatedAt: '2026-08-18T01:00:00.000Z', summary: { changedFiles: ['src/kept.ts'] } }
    ])
    const projection = await service({
      threads: [thread({ id: 'mine', workspace: '/repo' })],
      runs,
      maxRuns: 2
    }).project({ workspace: '/repo' })
    const files = projection.nodes.filter((node) => node.kind === 'file').map((node) => node.path)
    expect(files).toEqual(['src/kept.ts'])
  })

  it('shares one in-flight run scan between concurrent projections', async () => {
    let calls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const runs: NodeGraphRunSource = {
      list: async () => {
        calls += 1
        await gate
        return []
      }
    }
    const instance = service({ threads: [thread({ id: 'a' })], runs })
    const first = instance.project({ refresh: true })
    const second = instance.project({ refresh: true })
    release!()
    await Promise.all([first, second])
    expect(calls).toBe(1)
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

type ReadyFolderIndex = (
  root: string,
  mountId: string,
  options?: {
    verifyFreshness?: boolean
    budget?: { remainingFiles: number; remainingBytes: number }
  }
) => Promise<{ index: null; state: string; budgetExhausted?: boolean }>

function folderService(
  readyFolderIndex: ReadyFolderIndex,
  options: { maxFolderRoots?: number; folderConcurrency?: number } = {}
): NodeGraphService {
  return new NodeGraphService({
    threads: { list: async () => [] },
    knowledgeBaseService: {
      readyIndex: async () => ({ index: null, state: 'pending' as const }),
      readyFolderIndex
    } as never,
    nowIso: () => BUILT_AT,
    ...options
  })
}

describe('NodeGraphService.projectFolder', () => {
  it('caps the number of roots and says which were dropped', async () => {
    const indexed: string[] = []
    const projection = await folderService(
      async (root) => {
        indexed.push(root)
        return { index: null, state: 'pending' }
      },
      { maxFolderRoots: 2 }
    ).projectFolder(['/c', '/a', '/b'])
    expect(indexed.sort()).toEqual(['/a', '/b'])
    expect(projection.truncated).toBe(true)
    expect(projection.diagnostics.join(' ')).toContain('projecting 2 of 3 requested roots')
  })

  it('indexes at most folderConcurrency roots at once', async () => {
    let inFlight = 0
    let peak = 0
    const projection = await folderService(
      async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return { index: null, state: 'pending' }
      },
      { folderConcurrency: 2 }
    ).projectFolder(['/a', '/b', '/c', '/d', '/e'])
    expect(peak).toBeLessThanOrEqual(2)
    expect(projection.diagnostics.join(' ')).not.toContain('failed')
  })

  it('hands every root one shared scan budget', async () => {
    const budgets: unknown[] = []
    await folderService(async (_root, _mount, options) => {
      budgets.push(options?.budget)
      return { index: null, state: 'pending' }
    }).projectFolder(['/a', '/b', '/c'])
    expect(budgets).toHaveLength(3)
    expect(budgets[0]).toBeDefined()
    // The same object every time: consuming it in one root is visible to all.
    expect(budgets[1]).toBe(budgets[0])
    expect(budgets[2]).toBe(budgets[0])
  })

  it('reports budget exhaustion as a diagnostic and marks the projection truncated', async () => {
    const projection = await folderService(async (root) => {
      if (root === '/a') return { index: null, state: 'ready' }
      return { index: null, state: 'pending', budgetExhausted: true }
    }).projectFolder(['/a', '/b'])
    expect(projection.truncated).toBe(true)
    expect(projection.diagnostics.join(' ')).toContain('scan budget reached: "/b" was skipped')
  })
})
