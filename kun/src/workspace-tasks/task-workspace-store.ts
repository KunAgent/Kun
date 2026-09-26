import { join } from 'node:path'
import { z } from 'zod'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { TaskWorkspaceRecordSchema, type TaskWorkspaceRecord } from '../contracts/task-workspace.js'

const TaskWorkspaceFileSchema = z.object({
  version: z.literal(1),
  records: z.array(TaskWorkspaceRecordSchema).max(10_000)
}).strict()
type TaskWorkspaceFile = z.infer<typeof TaskWorkspaceFileSchema>

const STORE_MUTEX_RESOURCE = 'ade/task-workspaces'
const MAX_RECORDS = 10_000

function parseFile(value: unknown): TaskWorkspaceFile {
  const parsed = TaskWorkspaceFileSchema.safeParse(value)
  return parsed.success ? parsed.data : { version: 1, records: [] }
}

/**
 * Durable task-workspace records at dataDir/ade/task-workspaces.json
 * (docs/ade/07 §4). Writes go through the Manager data mutex with a short
 * debounce; in-memory state is authoritative within the process.
 */
export class TaskWorkspaceStore {
  private readonly file: AtomicJsonFile<TaskWorkspaceFile>
  private records: TaskWorkspaceRecord[] = []
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private writeChain: Promise<void> = Promise.resolve()
  private mutationCount = 0
  private writtenCount = 0
  private readonly flushDelayMs: number

  constructor(options: { dataDir: string; flushDelayMs?: number }) {
    this.file = new AtomicJsonFile(
      join(options.dataDir, 'ade', 'task-workspaces.json'),
      parseFile
    )
    this.flushDelayMs = options.flushDelayMs ?? 1_000
  }

  async load(): Promise<void> {
    const file = await this.file.read(() => ({ version: 1, records: [] }))
    this.records = file.records
  }

  get(workspaceId: string): TaskWorkspaceRecord | undefined {
    return this.records.find((record) => record.workspaceId === workspaceId)
  }

  list(filter?: { ownerThreadId?: string; boundThreadId?: string }): TaskWorkspaceRecord[] {
    const rows = this.records.filter((record) => {
      if (filter?.ownerThreadId && record.ownerThreadId !== filter.ownerThreadId) return false
      if (filter?.boundThreadId) {
        const bound = record.ownerThreadId === filter.boundThreadId ||
          record.unitId === filter.boundThreadId
        if (!bound) return false
      }
      return true
    })
    return rows.map((record) => ({ ...record }))
  }

  insert(record: TaskWorkspaceRecord): TaskWorkspaceRecord {
    const parsed = TaskWorkspaceRecordSchema.parse(record)
    this.records.push(parsed)
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS)
    }
    this.scheduleFlush()
    return parsed
  }

  update(
    workspaceId: string,
    patch: Partial<TaskWorkspaceRecord>
  ): TaskWorkspaceRecord | undefined {
    const index = this.records.findIndex((record) => record.workspaceId === workspaceId)
    if (index === -1) return undefined
    const next = TaskWorkspaceRecordSchema.parse({ ...this.records[index], ...patch })
    this.records[index] = next
    this.scheduleFlush()
    return next
  }

  /** Persist immediately; also used as the debounced flush path. */
  flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    this.writeChain = this.writeChain.then(async () => {
      const count = this.mutationCount
      if (count === this.writtenCount) return
      const snapshot: TaskWorkspaceFile = { version: 1, records: [...this.records] }
      await withManagerDataMutex(STORE_MUTEX_RESOURCE, () => this.file.write(snapshot))
      this.writtenCount = count
      if (this.mutationCount !== this.writtenCount) this.scheduleFlush()
    })
    return this.writeChain.catch(() => undefined)
  }

  private scheduleFlush(): void {
    this.mutationCount += 1
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flush()
    }, this.flushDelayMs)
    this.flushTimer.unref?.()
  }
}
