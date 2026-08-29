import { mkdir, mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  it('caps roots in request order, so the active root always survives', async () => {
    const indexed: string[] = []
    const projection = await folderService(
      async (root) => {
        indexed.push(root)
        return { index: null, state: 'pending' }
      },
      { maxFolderRoots: 2 }
    ).projectFolder(['/c', '/a', '/b'])
    // Callers put the active workspace first; sorting before the cap could
    // drop exactly the root the user is looking at.
    expect(indexed).toEqual(['/c', '/a'])
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

  it('collapses lexical spellings of the same directory into one root', async () => {
    const indexed: string[] = []
    await folderService(async (root) => {
      indexed.push(root)
      return { index: null, state: 'pending' }
    }).projectFolder(['/vault', '/vault/', '/vault/.', '/vault/notes/..'])
    expect(indexed).toEqual(['/vault'])
  })

  it('collapses a symlinked root into its physical directory', async () => {
    const base = await mkdtemp(join(tmpdir(), 'kun-node-graph-roots-'))
    const physical = join(base, 'vault')
    const linked = join(base, 'linked')
    await mkdir(physical)
    await symlink(physical, linked)
    const indexed: string[] = []
    await folderService(async (root) => {
      indexed.push(root)
      return { index: null, state: 'pending' }
    }).projectFolder([linked, physical])
    expect(indexed).toHaveLength(1)
  })

  it('merges a root nested inside another requested root into its ancestor', async () => {
    const indexed: string[] = []
    const projection = await folderService(async (root) => {
      indexed.push(root)
      return { index: null, state: 'pending' }
    }).projectFolder(['/vault/sub', '/vault'])
    expect(indexed).toEqual(['/vault'])
    expect(projection.diagnostics.join(' ')).toContain(
      'folder root "/vault/sub" is inside "/vault"'
    )
  })
})

describe('NodeGraphService knowledge-base loading', () => {
  function mount(id: string): { id: string; root: string; name: string; source: string; access: string } {
    return { id, root: `/kb/${id}`, name: id, source: 'manual', access: 'read-only' }
  }

  it('loads knowledge bases with bounded concurrency and one shared budget', async () => {
    let inFlight = 0
    let peak = 0
    const budgets: unknown[] = []
    const instance = new NodeGraphService({
      threads: {
        list: async () => ['a', 'b', 'c', 'd', 'e'].map((id) =>
          thread({ id, knowledgeBases: [mount(`kb-${id}`)] } as never))
      },
      knowledgeBaseService: {
        readyIndex: async (_mount: unknown, options?: { budget?: unknown }) => {
          budgets.push(options?.budget)
          inFlight += 1
          peak = Math.max(peak, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 5))
          inFlight -= 1
          return { index: null, state: 'pending' as const }
        },
        readyFolderIndex: async () => ({ index: null, state: 'pending' as const })
      } as never,
      nowIso: () => BUILT_AT,
      folderConcurrency: 2
    })
    await instance.project()
    expect(peak).toBeLessThanOrEqual(2)
    expect(budgets).toHaveLength(5)
    expect(budgets[0]).toBeDefined()
    expect(budgets.every((budget) => budget === budgets[0])).toBe(true)
  })

  it('caps the number of mounts and reports the drop', async () => {
    const loaded: string[] = []
    const instance = new NodeGraphService({
      threads: {
        list: async () => ['a', 'b', 'c'].map((id) =>
          thread({ id, knowledgeBases: [mount(`kb-${id}`)] } as never))
      },
      knowledgeBaseService: {
        readyIndex: async (requested: { id: string }) => {
          loaded.push(requested.id)
          return { index: null, state: 'pending' as const }
        },
        readyFolderIndex: async () => ({ index: null, state: 'pending' as const })
      } as never,
      nowIso: () => BUILT_AT,
      maxKnowledgeBases: 2
    })
    const projection = await instance.project()
    expect(loaded).toHaveLength(2)
    expect(projection.truncated).toBe(true)
    expect(projection.diagnostics.join(' ')).toContain('loading 2 of 3 mounted bases')
  })

  it('surfaces a spent budget as a diagnostic and truncation', async () => {
    const instance = new NodeGraphService({
      threads: { list: async () => [thread({ id: 'a', knowledgeBases: [mount('kb-a')] } as never)] },
      knowledgeBaseService: {
        readyIndex: async () => ({ index: null, state: 'pending' as const, budgetExhausted: true }),
        readyFolderIndex: async () => ({ index: null, state: 'pending' as const })
      } as never,
      nowIso: () => BUILT_AT
    })
    const projection = await instance.project()
    expect(projection.truncated).toBe(true)
    expect(projection.diagnostics.join(' ')).toContain('scan budget reached: knowledge base "kb-a" was skipped')
  })
})

describe('NodeGraphService changed-file scan lifecycle', () => {
  it('evicts a timed-out scan so the next refresh starts fresh', async () => {
    let calls = 0
    const runs: NodeGraphRunSource = {
      list: () => {
        calls += 1
        return new Promise(() => undefined) // never settles
      }
    }
    const instance = service({
      threads: [thread({ id: 'a' })],
      runs,
      changedFilesTimeoutMs: 5,
      cacheTtlMs: 0
    })
    const first = await instance.project({ refresh: true })
    expect(first.diagnostics.join(' ')).toContain('exceeded 5ms')
    // Before the eviction fix this reused the hung promise forever: every
    // later refresh timed out against the same never-settling scan.
    await instance.project({ refresh: true })
    expect(calls).toBe(2)
  })

  it('treats an omitted includeChangedFiles exactly like an explicit true', async () => {
    let threadCalls = 0
    const instance = new NodeGraphService({
      threads: {
        list: async () => {
          threadCalls += 1
          return [thread({ id: 'a' })]
        }
      },
      nowIso: () => BUILT_AT
    })
    await instance.project()
    await instance.project({ includeChangedFiles: true })
    // One cache entry: the omitted and explicit spellings share a key.
    expect(threadCalls).toBe(1)
    await instance.project({ includeChangedFiles: false })
    expect(threadCalls).toBe(2)
  })
})
