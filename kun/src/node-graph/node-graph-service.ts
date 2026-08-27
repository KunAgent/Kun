import type { NodeGraphProjection } from '../contracts/node-graph.js'
import type { KnowledgeBaseMount, ThreadSummary } from '../contracts/threads.js'
import type { KnowledgeBaseService, KnowledgeScanBudget } from '../knowledge/knowledge-base-service.js'
import type { MemoryStore } from '../memory/memory-store.js'
import { buildNodeGraphProjection } from './node-graph-builder.js'
import {
  buildNodeGraphFolderProjection,
  folderMountId,
  type NodeGraphFolderRoot
} from './node-graph-folder.js'
import type {
  NodeGraphChangedFilesInput,
  NodeGraphKnowledgeInput,
  NodeGraphMemoryInput,
  NodeGraphThreadInput
} from './node-graph-inputs.js'

/** Only the Graph Mode surface the projection touches, so tests can fake it. */
export type NodeGraphRunSource = {
  list(filter?: {
    threadId?: string
    /** Restrict to these threads before any snapshot is loaded. */
    threadIds?: readonly string[]
    /** Newest-first cap, applied with the scope, so the store never reads more. */
    limit?: number
  }): Promise<readonly {
    threadId: string
    updatedAt: string
    summary?: { changedFiles: readonly string[] }
  }[]>
}

export type NodeGraphServiceOptions = {
  threads: { list(): Promise<ThreadSummary[]> }
  /** Resolved per call: the memory store is replaced on runtime reconfigure. */
  memoryStore?: () => MemoryStore | undefined
  knowledgeBaseService?: Pick<KnowledgeBaseService, 'readyIndex' | 'readyFolderIndex'>
  runs?: NodeGraphRunSource
  nowIso?: () => string
  /** Cache lifetime. Repeated view opens and refresh clicks stay cheap. */
  cacheTtlMs?: number
  /** Wall-clock budget for the Graph Mode run scan, which reads full runs. */
  changedFilesTimeoutMs?: number
  /** Most recent runs to read changed files from. */
  maxRuns?: number
  /** Most roots one folder projection will index; the rest are dropped. */
  maxFolderRoots?: number
  /** Shared file/byte allowance across every root of one folder projection. */
  folderScanBudget?: { files: number; bytes: number }
  /** Roots indexed at once. Bounds the CPU/I/O spike of a many-root load. */
  folderConcurrency?: number
}

export type NodeGraphRequest = {
  /** Restrict to one workspace root. Absent means every workspace. */
  workspace?: string
  /** Include `file` nodes derived from Graph Mode run summaries. */
  includeChangedFiles?: boolean
  /** Bypass the cache. */
  refresh?: boolean
}

const DEFAULT_CACHE_TTL_MS = 10_000
const DEFAULT_CHANGED_FILES_TIMEOUT_MS = 2_500
const DEFAULT_MAX_RUNS = 40
export const DEFAULT_MAX_FOLDER_ROOTS = 12
export const DEFAULT_FOLDER_SCAN_BUDGET = { files: 1_600, bytes: 96 * 1024 * 1024 }
const DEFAULT_FOLDER_CONCURRENCY = 2

export class NodeGraphService {
  private readonly cache = new Map<string, { at: number; projection: NodeGraphProjection }>()
  /** In-flight run scans by thread scope, so concurrent projections share one. */
  private readonly changedFilesScans = new Map<string, ReturnType<NodeGraphRunSource['list']>>()
  private readonly nowIso: () => string

  constructor(private readonly options: NodeGraphServiceOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async project(request: NodeGraphRequest = {}): Promise<NodeGraphProjection> {
    const key = `${request.workspace ?? '*'}|${request.includeChangedFiles ? 'files' : 'nofiles'}`
    const ttl = this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    const cached = this.cache.get(key)
    if (!request.refresh && cached && Date.now() - cached.at < ttl) return cached.projection
    const diagnostics: string[] = []
    const threads = await this.loadThreads(request.workspace, diagnostics)
    const [memories, knowledgeBases, changedFiles] = await Promise.all([
      this.loadMemories(request.workspace, diagnostics),
      this.loadKnowledgeBases(threads, diagnostics),
      request.includeChangedFiles === false
        ? Promise.resolve([])
        : this.loadChangedFiles(threads, diagnostics)
    ])
    const projection = buildNodeGraphProjection({
      builtAt: this.nowIso(),
      ...(request.workspace ? { workspace: request.workspace } : {}),
      threads: threads.map(toThreadInput),
      memories,
      knowledgeBases,
      changedFiles,
      diagnostics
    })
    this.cache.set(key, { at: Date.now(), projection })
    return projection
  }

  /**
   * Projects one or more directory trees: markdown files, their `[[wikilinks]]`,
   * and the folders nesting them. Projecting several roots together is what
   * lets a link reaching into a sibling workspace draw a real edge. Shares the
   * cache with `project()` under a distinct key, so switching between the Code
   * and Work graphs stays cheap.
   */
  async projectFolder(
    roots: readonly string[],
    options: { refresh?: boolean } = {}
  ): Promise<NodeGraphProjection> {
    const unique = [...new Set(roots.map((root) => root.trim()).filter(Boolean))].sort()
    const key = `folder|${unique.join('|')}`
    const ttl = this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    const cached = this.cache.get(key)
    if (!options.refresh && cached && Date.now() - cached.at < ttl) return cached.projection
    const service = this.options.knowledgeBaseService
    const diagnostics: string[] = []
    const maxRoots = this.options.maxFolderRoots ?? DEFAULT_MAX_FOLDER_ROOTS
    const kept = unique.slice(0, maxRoots)
    if (kept.length < unique.length) {
      diagnostics.push(
        `folder root limit reached: projecting ${kept.length} of ${unique.length} requested roots`
      )
    }
    let budgetHit = false
    let loaded: NodeGraphFolderRoot[] = []
    if (!service) {
      diagnostics.push('folder indexing is not available in this runtime')
    } else {
      // One allowance for the whole request. The indexer's per-root caps bound
      // each tree, but with many roots their sum was unbounded — which is what
      // let a default "all workspaces" load scan thousands of files at once.
      const allowance = this.options.folderScanBudget ?? DEFAULT_FOLDER_SCAN_BUDGET
      const budget: KnowledgeScanBudget = {
        remainingFiles: allowance.files,
        remainingBytes: allowance.bytes
      }
      const concurrency = Math.max(1, this.options.folderConcurrency ?? DEFAULT_FOLDER_CONCURRENCY)
      loaded = await mapWithConcurrency(kept, concurrency, async (root) => {
        try {
          // Folder projections always verify freshness: this view exists to
          // reflect files on disk, and the projection cache above already keeps
          // repeated opens from re-scanning.
          const result = await service.readyFolderIndex(root, folderMountId(root), {
            verifyFreshness: true,
            budget
          })
          if (result.budgetExhausted) {
            budgetHit = true
            diagnostics.push(result.index
              ? `scan budget reached: "${root}" shows its last built index`
              : `scan budget reached: "${root}" was skipped`)
          }
          return { root, index: result.index, ...(result.state ? { state: result.state } : {}) }
        } catch (error) {
          diagnostics.push(`folder index failed for "${root}": ${errorText(error)}`)
          return { root, index: null }
        }
      })
    }
    const projection = buildNodeGraphFolderProjection({
      builtAt: this.nowIso(),
      roots: loaded.length > 0 ? loaded : kept.map((root) => ({ root, index: null })),
      diagnostics,
      ...(kept.length < unique.length || budgetHit ? { truncated: true } : {})
    })
    this.cache.set(key, { at: Date.now(), projection })
    return projection
  }

  invalidate(): void {
    this.cache.clear()
  }

  private async loadThreads(
    workspace: string | undefined,
    diagnostics: string[]
  ): Promise<ThreadSummary[]> {
    try {
      const threads = await this.options.threads.list()
      if (!workspace) return threads
      return threads.filter((thread) =>
        thread.workspace === workspace ||
        (thread.additionalWorkspaces ?? []).includes(workspace)
      )
    } catch (error) {
      diagnostics.push(`thread listing failed: ${errorText(error)}`)
      return []
    }
  }

  private async loadMemories(
    workspace: string | undefined,
    diagnostics: string[]
  ): Promise<NodeGraphMemoryInput[]> {
    const store = this.options.memoryStore?.()
    if (!store) return []
    try {
      const records = await store.list(
        workspace ? { workspace } : { all: true }
      )
      return records.map((record) => ({
        id: record.id,
        content: record.content,
        scope: record.scope,
        ...(record.workspace ? { workspace: record.workspace } : {}),
        ...(record.project ? { project: record.project } : {}),
        tags: record.tags,
        ...(record.sourceThreadId ? { sourceThreadId: record.sourceThreadId } : {}),
        updatedAt: record.updatedAt,
        ...(record.disabledAt ? { disabledAt: record.disabledAt } : {}),
        ...(record.deletedAt ? { deletedAt: record.deletedAt } : {})
      }))
    } catch (error) {
      diagnostics.push(`memory listing failed: ${errorText(error)}`)
      return []
    }
  }

  /**
   * Collapses the same mount referenced by several threads into one node, so a
   * shared base is a single hub rather than one copy per conversation.
   */
  private async loadKnowledgeBases(
    threads: readonly ThreadSummary[],
    diagnostics: string[]
  ): Promise<NodeGraphKnowledgeInput[]> {
    const service = this.options.knowledgeBaseService
    if (!service) return []
    const mounts = new Map<string, { mount: KnowledgeBaseMount; threadIds: string[] }>()
    for (const thread of threads) {
      for (const mount of thread.knowledgeBases ?? []) {
        const entry = mounts.get(mount.id)
        if (entry) entry.threadIds.push(thread.id)
        else mounts.set(mount.id, { mount, threadIds: [thread.id] })
      }
    }
    return Promise.all([...mounts.values()].map(async ({ mount, threadIds }) => {
      try {
        const { index, state } = await service.readyIndex(mount)
        return { mountId: mount.id, mountName: mount.name, state, index, threadIds }
      } catch (error) {
        diagnostics.push(`knowledge base "${mount.name}" failed to load: ${errorText(error)}`)
        return { mountId: mount.id, mountName: mount.name, index: null, threadIds }
      }
    }))
  }

  /**
   * Graph Mode runs are the only durable record of which files a conversation
   * changed. The thread scope and the run cap are pushed into the store query,
   * so unrelated snapshots are never read and the newest runs *of these
   * threads* are what fill the cap — a burst of runs in another workspace
   * cannot crowd this one's out. The scan is still time-boxed, and concurrent
   * requests for the same scope share one in-flight scan.
   */
  private async loadChangedFiles(
    threads: readonly ThreadSummary[],
    diagnostics: string[]
  ): Promise<NodeGraphChangedFilesInput[]> {
    const runs = this.options.runs
    if (!runs) return []
    if (threads.length === 0) return []
    const workspaceOf = new Map(threads.map((thread) => [thread.id, thread.workspace]))
    const threadIds = [...workspaceOf.keys()].sort()
    const scanKey = threadIds.join('|')
    const timeoutMs = this.options.changedFilesTimeoutMs ?? DEFAULT_CHANGED_FILES_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const existing = this.changedFilesScans.get(scanKey)
      const scan = existing ?? runs
        .list({ threadIds, limit: this.options.maxRuns ?? DEFAULT_MAX_RUNS })
        .finally(() => this.changedFilesScans.delete(scanKey))
      if (!existing) {
        this.changedFilesScans.set(scanKey, scan)
        // The scan keeps running after a timeout, so its rejection must be
        // absorbed here or it surfaces as an unhandled rejection later.
        scan.catch(() => undefined)
      }
      const listed = await Promise.race([
        scan,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs)
        })
      ])
      if (listed === null) {
        diagnostics.push(`changed-file scan exceeded ${timeoutMs}ms and was skipped`)
        return []
      }
      const byThread = new Map<string, Set<string>>()
      for (const run of listed) {
        if (!workspaceOf.has(run.threadId)) continue
        const files = run.summary?.changedFiles ?? []
        if (files.length === 0) continue
        const bucket = byThread.get(run.threadId) ?? new Set<string>()
        for (const file of files) bucket.add(file)
        byThread.set(run.threadId, bucket)
      }
      return [...byThread.entries()].map(([threadId, files]) => ({
        threadId,
        ...(workspaceOf.get(threadId) ? { workspace: workspaceOf.get(threadId)! } : {}),
        files: [...files]
      }))
    } catch (error) {
      diagnostics.push(`changed-file scan failed: ${errorText(error)}`)
      return []
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

/** Order-preserving map with at most `concurrency` callbacks in flight. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await map(items[index]!)
      }
    }
  )
  await Promise.all(workers)
  return results
}

function toThreadInput(thread: ThreadSummary): NodeGraphThreadInput {
  return {
    id: thread.id,
    title: thread.title,
    workspace: thread.workspace,
    ...(thread.additionalWorkspaces ? { additionalWorkspaces: thread.additionalWorkspaces } : {}),
    ...(thread.agentId ? { agentId: thread.agentId } : {}),
    ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}),
    ...(thread.forkedFromThreadId ? { forkedFromThreadId: thread.forkedFromThreadId } : {}),
    ...(thread.relation ? { relation: thread.relation } : {}),
    ...(thread.status ? { status: thread.status } : {}),
    ...(thread.mode ? { mode: thread.mode } : {}),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    ...(thread.knowledgeBases
      ? { knowledgeBases: thread.knowledgeBases.map((mount) => ({ id: mount.id, name: mount.name })) }
      : {})
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
