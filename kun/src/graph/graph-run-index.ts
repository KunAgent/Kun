import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  GraphRunIdSchema,
  GraphRunStatusSchema,
  GraphRunV1Schema,
  type GraphRunStatus,
  type GraphRunV1
} from '../contracts/graph.js'
import { AtomicJsonFile } from '../extensions/atomic-json.js'

const EntrySchema = z.object({
  runId: GraphRunIdSchema,
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  status: GraphRunStatusSchema,
  updatedAt: z.string().datetime({ offset: true })
}).strict()
const IndexSchema = z.array(EntrySchema)
const SnapshotStateSchema = z.object({ state: GraphRunV1Schema }).passthrough()
type Entry = z.infer<typeof EntrySchema>

export type GraphRunListFilter = {
  threadId?: string
  /** Restrict to any of these threads. Applied before snapshots are loaded. */
  threadIds?: readonly string[]
  projectId?: string
  statuses?: GraphRunStatus[]
  /** Newest-first cap on index entries, so at most this many snapshots load. */
  limit?: number
}

export class FileGraphRunIndex {
  private readonly entries = new Map<string, Entry>()
  private readonly file: AtomicJsonFile<Entry[]>

  constructor(private readonly rootDir: string) {
    this.file = new AtomicJsonFile(this.path(), (value) => IndexSchema.parse(value))
  }

  async initialize(): Promise<void> {
    const rebuilt = new Map<string, Entry>()
    const directories = await readdir(this.rootDir, { withFileTypes: true }).catch(() => [])
    for (const directory of directories) {
      if (!directory.isDirectory() || !GraphRunIdSchema.safeParse(directory.name).success) continue
      try {
        const snapshot = SnapshotStateSchema.parse(JSON.parse(
          await readFile(join(this.rootDir, directory.name, 'snapshot.json'), 'utf8')
        ))
        rebuilt.set(directory.name, entryFor(snapshot.state))
      } catch {
        // A direct read will surface corruption diagnostics for this run.
      }
    }
    const entries = await this.file.update(
      () => [],
      (current) => {
        const merged = new Map<string, Entry>(rebuilt)
        for (const entry of current) merged.set(entry.runId, entry)
        return [...merged.values()]
      }
    )
    this.apply(entries)
  }

  async candidates(filter: GraphRunListFilter): Promise<Entry[]> {
    await this.refresh()
    const threadIds = filter.threadIds ? new Set(filter.threadIds) : null
    const matched = [...this.entries.values()]
      .filter((entry) => !filter.threadId || entry.threadId === filter.threadId)
      .filter((entry) => !threadIds || threadIds.has(entry.threadId))
      .filter((entry) => !filter.projectId || entry.projectId === filter.projectId)
      .filter((entry) => !filter.statuses || filter.statuses.includes(entry.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.runId.localeCompare(b.runId))
    // The limit is applied to index entries, before any snapshot is read, so a
    // scoped listing never pays for unrelated or older runs.
    return typeof filter.limit === 'number' && filter.limit >= 0
      ? matched.slice(0, filter.limit)
      : matched
  }

  async update(state: GraphRunV1): Promise<void> {
    const nextEntry = entryFor(state)
    const entries = await this.file.update(
      () => [],
      (current) => [...current.filter((entry) => entry.runId !== state.id), nextEntry]
    )
    this.apply(entries)
  }

  async remove(runId: string): Promise<void> {
    const entries = await this.file.update(
      () => [],
      (current) => current.filter((entry) => entry.runId !== runId)
    )
    this.apply(entries)
  }

  private async refresh(): Promise<void> {
    this.apply(await this.file.read(() => []))
  }

  private apply(entries: Entry[]): void {
    this.entries.clear()
    for (const entry of entries) this.entries.set(entry.runId, entry)
  }

  private path(): string {
    return join(this.rootDir, 'index.json')
  }
}

function entryFor(state: GraphRunV1): Entry {
  return EntrySchema.parse({
    runId: state.id,
    threadId: state.threadId,
    projectId: state.projectId,
    status: state.status,
    updatedAt: state.updatedAt
  })
}
