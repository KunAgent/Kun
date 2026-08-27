import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  ThreadStore,
  ThreadStoreConditionalWrite,
  ThreadStoreListOptions,
  ThreadStoreListPage
} from '../../ports/thread-store.js'
import {
  ThreadSchema,
  ThreadSchemaReadable,
  type ThreadRecord,
  type ThreadSummary
} from '../../contracts/threads.js'
import { assertSafeThreadId, isSafeThreadId } from '../../contracts/thread-id.js'
import { toThreadSummary } from '../../domain/thread.js'
import {
  applyThreadCursor,
  filterThreadSummaries,
  queryThreadSummaryPage
} from '../../domain/thread-list-query.js'
import { atomicWriteFile } from './atomic-write.js'
import { isPathBelowDirectory } from './path-containment.js'

type ThreadIndex = { order: string[]; updatedAt: string }
type IndexRead =
  | { kind: 'ok'; index: ThreadIndex }
  | { kind: 'missing' }
  | { kind: 'corrupt'; error: unknown }

type FileThreadStoreOptions = {
  dataDir: string
  now?: () => Date
  writeFile?: (path: string, contents: string) => Promise<void>
}

/** File-backed thread store with a rebuildable, backed-up listing index. */
export class FileThreadStore implements ThreadStore {
  private readonly dataDir: string
  private readonly now: () => Date
  private readonly writeFile: (path: string, contents: string) => Promise<void>
  private indexQueue: Promise<void> = Promise.resolve()
  private readonly threadQueues = new Map<string, Promise<void>>()
  private reconciliation: Promise<void> | null = null

  constructor(options: FileThreadStoreOptions) {
    this.dataDir = resolve(options.dataDir, 'threads')
    this.now = options.now ?? (() => new Date())
    this.writeFile = options.writeFile ?? atomicWriteFile
  }

  async list(options: ThreadStoreListOptions = {}): Promise<ThreadSummary[]> {
    const summaries = filterThreadSummaries(await this.readIndexedSummaries(), options)
    const afterCursor = applyThreadCursor(summaries, options.cursor)
    return typeof options.limit === 'number'
      ? afterCursor.slice(0, Math.max(1, Math.floor(options.limit)))
      : afterCursor
  }

  async listPage(options: ThreadStoreListOptions = {}): Promise<ThreadStoreListPage> {
    return queryThreadSummaryPage(await this.readIndexedSummaries(), options)
  }

  async get(threadId: string): Promise<ThreadRecord | null> {
    if (!isSafeThreadId(threadId)) return null
    const path = this.threadFilePath(threadId)
    let raw: string
    try {
      raw = await readFile(path, 'utf-8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null
      throw fileError(`read thread ${threadId}`, path, error)
    }
    try {
      const parsed = ThreadSchemaReadable.safeParse(JSON.parse(raw))
      if (!parsed.success) throw parsed.error
      return parsed.data
    } catch (error) {
      throw fileError(`parse thread ${threadId}`, path, error)
    }
  }

  async upsert(thread: ThreadRecord): Promise<ThreadRecord> {
    return this.withThreadWrite(thread.id, async () => {
      const current = await this.readThread(thread.id)
      return this.writeThread({ ...thread, revision: (current?.revision ?? -1) + 1 })
    })
  }

  async upsertIfRevision(
    thread: ThreadRecord,
    expectedRevision: number
  ): Promise<ThreadStoreConditionalWrite> {
    return this.withThreadWrite(thread.id, async () => {
      const current = await this.readThread(thread.id)
      const revision = current?.revision ?? 0
      if (!current || revision !== expectedRevision) return { applied: false, revision }
      const stored = await this.writeThread({ ...thread, revision: revision + 1 })
      return { applied: true, thread: stored, revision: stored.revision ?? revision + 1 }
    })
  }

  private async writeThread(thread: ThreadRecord): Promise<ThreadRecord> {
    const normalized = ThreadSchema.parse(thread)
    assertSafeThreadId(normalized.id)
    await this.ensureDir(this.threadDir(normalized.id))
    await this.writeFile(this.threadFilePath(normalized.id), JSON.stringify(normalized))
    await this.ensureReconciled()
    try {
      await this.updateIndex((current) => ({
        order: current.order.includes(normalized.id) ? current.order : [...current.order, normalized.id],
        updatedAt: this.now().toISOString()
      }))
    } catch (error) {
      this.reconciliation = null
      throw error
    }
    return normalized
  }

  private async readThread(threadId: string): Promise<ThreadRecord | null> {
    return this.get(threadId)
  }

  private async withThreadWrite<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.threadQueues.get(threadId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    const guard = run.then(() => undefined, () => undefined)
    this.threadQueues.set(threadId, guard)
    try {
      return await run
    } finally {
      if (this.threadQueues.get(threadId) === guard) this.threadQueues.delete(threadId)
    }
  }

  async delete(threadId: string): Promise<boolean> {
    if (!isSafeThreadId(threadId)) return false
    const dir = this.threadDir(threadId)
    try {
      await stat(dir)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return false
      throw fileError(`stat thread ${threadId}`, dir, error)
    }
    await rm(dir, { recursive: true, force: true })
    await this.ensureReconciled()
    await this.updateIndex((current) => ({
      order: current.order.filter((id) => id !== threadId),
      updatedAt: this.now().toISOString()
    }))
    return true
  }

  async deleteByWorkspace(workspace: string): Promise<string[]> {
    const summaries = await this.list({ workspace, includeArchived: true, includeSide: true })
    const deleted: string[] = []
    for (const summary of summaries) {
      if (await this.delete(summary.id)) deleted.push(summary.id)
    }
    return deleted
  }

  private async readIndexedSummaries(): Promise<ThreadSummary[]> {
    await this.ensureDir(this.dataDir)
    await this.ensureReconciled()
    let current = await this.readIndexFile(this.indexPath())
    if (current.kind !== 'ok') {
      this.reconciliation = null
      await this.ensureReconciled()
      current = await this.readIndexFile(this.indexPath())
    }
    if (current.kind !== 'ok') throw new Error('thread index unavailable after reconciliation')
    const summaries: ThreadSummary[] = []
    for (const threadId of current.index.order) {
      const thread = await this.readThreadForListing(threadId)
      if (thread) summaries.push(toThreadSummary(thread))
    }
    return summaries
  }

  private ensureReconciled(): Promise<void> {
    if (this.reconciliation) return this.reconciliation
    const run = this.enqueueIndex(async () => this.reconcileIndex())
    this.reconciliation = run.catch((error) => {
      this.reconciliation = null
      throw error
    })
    return this.reconciliation
  }

  private async reconcileIndex(): Promise<void> {
    await this.ensureDir(this.dataDir)
    const primary = await this.readIndexFile(this.indexPath())
    const backup = primary.kind === 'ok'
      ? null
      : await this.readIndexFile(this.indexBackupPath())
    if (primary.kind === 'corrupt') warnFileStore(`index is corrupt; rebuilding`, this.indexPath(), primary.error)
    if (primary.kind !== 'ok' && backup?.kind === 'ok') {
      console.warn('[kun] file thread index recovered from index.json.bak and filesystem reconciliation')
    }

    const seed = primary.kind === 'ok'
      ? primary.index
      : backup?.kind === 'ok'
        ? backup.index
        : emptyIndex(this.now())
    const diskOrder: string[] = []
    const entries = await readdir(this.dataDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeThreadId(entry.name)) continue
      if (await this.readThreadForListing(entry.name)) diskOrder.push(entry.name)
    }
    const available = new Set(diskOrder)
    const order = [
      ...seed.order.filter((id) => available.has(id)),
      ...diskOrder.filter((id) => !seed.order.includes(id))
    ]
    const changed = primary.kind !== 'ok' || !sameOrder(order, seed.order)
    if (!changed) return
    const next = { order, updatedAt: this.now().toISOString() }
    await this.writeIndex(next, primary.kind === 'ok' ? primary.index : null)
  }

  private async readThreadForListing(threadId: string): Promise<ThreadRecord | null> {
    const path = this.threadFilePath(threadId)
    let raw: string
    try {
      raw = await readFile(path, 'utf-8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null
      throw fileError(`read thread ${threadId}`, path, error)
    }
    try {
      const parsed = ThreadSchemaReadable.safeParse(JSON.parse(raw))
      if (!parsed.success) throw parsed.error
      if (parsed.data.id !== threadId) throw new Error(`record id ${parsed.data.id} does not match directory`)
      return parsed.data
    } catch (error) {
      warnFileStore(`skipping corrupt thread ${threadId}`, path, error)
      return null
    }
  }

  private async readIndexFile(path: string): Promise<IndexRead> {
    let raw: string
    try {
      raw = await readFile(path, 'utf-8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return { kind: 'missing' }
      throw fileError('read thread index', path, error)
    }
    try {
      const value = JSON.parse(raw) as unknown
      if (!value || typeof value !== 'object') throw new Error('index must be an object')
      const candidate = value as { order?: unknown; updatedAt?: unknown }
      if (!Array.isArray(candidate.order) || typeof candidate.updatedAt !== 'string') {
        throw new Error('index requires order[] and updatedAt')
      }
      if (!candidate.order.every((id) => typeof id === 'string' && isSafeThreadId(id))) {
        throw new Error('index contains an unsafe thread id')
      }
      return {
        kind: 'ok',
        index: { order: [...new Set(candidate.order)], updatedAt: candidate.updatedAt }
      }
    } catch (error) {
      return { kind: 'corrupt', error }
    }
  }

  private async updateIndex(mutator: (current: ThreadIndex) => ThreadIndex): Promise<void> {
    await this.enqueueIndex(async () => {
      const current = await this.readIndexFile(this.indexPath())
      if (current.kind !== 'ok') throw new Error('thread index unavailable during update')
      await this.writeIndex(mutator(current.index), current.index)
    })
  }

  private async writeIndex(next: ThreadIndex, previous: ThreadIndex | null): Promise<void> {
    await this.ensureDir(this.dataDir)
    if (previous) await this.writeFile(this.indexBackupPath(), JSON.stringify(previous))
    await this.writeFile(this.indexPath(), JSON.stringify(next))
  }

  private enqueueIndex(task: () => Promise<void>): Promise<void> {
    const run = this.indexQueue.catch(() => undefined).then(task)
    this.indexQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private threadDir(threadId: string): string {
    assertSafeThreadId(threadId)
    const path = resolve(this.dataDir, threadId)
    if (!isPathBelowDirectory(this.dataDir, path)) throw new Error(`thread path escapes data directory: ${threadId}`)
    return path
  }

  private threadFilePath(threadId: string): string { return join(this.threadDir(threadId), 'thread.json') }
  private indexPath(): string { return join(this.dataDir, 'index.json') }
  private indexBackupPath(): string { return join(this.dataDir, 'index.json.bak') }
  private async ensureDir(path: string): Promise<void> { await mkdir(path, { recursive: true, mode: 0o700 }) }
}

function emptyIndex(now: Date): ThreadIndex { return { order: [], updatedAt: now.toISOString() } }
function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}
function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code
}
function fileError(action: string, path: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const wrapped = new Error(`${action} failed for ${path}: ${message}`, { cause: error })
  const source = error as NodeJS.ErrnoException | undefined
  if (source?.code) Object.assign(wrapped, { code: source.code })
  return wrapped
}
function warnFileStore(action: string, path: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[kun] file thread store ${action} at ${path}: ${message}`)
}

/** Helper used by the JSONL event store to enumerate disk content. */
export async function readJsonl<T>(path: string): Promise<T[]> {
  let content: string
  try {
    content = await readFile(path, 'utf-8')
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return []
    throw fileError('read JSONL', path, error)
  }
  const out: T[] = []
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as T)
    } catch (error) {
      warnFileStore(`skip malformed JSONL line ${index + 1}`, path, error)
    }
  }
  return out
}

export { readdir }
