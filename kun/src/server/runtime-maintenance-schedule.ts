import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'

const MaintenanceScheduleSchema = z.object({
  version: z.literal(1),
  completedAt: z.record(z.string(), z.string().datetime())
}).strict()

export type MaintenanceCompletionLog = {
  /** Last completed pass per task, in epoch milliseconds. */
  read(): Promise<Record<string, number>>
  record(task: string, completedAtMs: number): Promise<void>
}

/**
 * When each full maintenance pass last finished. A restart inside a task's
 * interval resumes that schedule instead of starting another full pass over
 * every thread. Kept apart from maintenance-state.json, whose strict layout
 * older builds still read.
 */
export function createMaintenanceCompletionLog(dataDir: string): MaintenanceCompletionLog {
  const path = join(dataDir, 'maintenance-schedule.json')
  let writes: Promise<void> = Promise.resolve()
  const load = async (): Promise<Record<string, string>> => {
    try {
      const parsed = MaintenanceScheduleSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
      return parsed.success ? parsed.data.completedAt : {}
    } catch {
      return {}
    }
  }
  return {
    async read() {
      const completed: Record<string, number> = {}
      for (const [task, at] of Object.entries(await load())) {
        const ms = Date.parse(at)
        if (Number.isFinite(ms)) completed[task] = ms
      }
      return completed
    },
    record(task, completedAtMs) {
      writes = writes.then(async () => {
        const completedAt = { ...await load(), [task]: new Date(completedAtMs).toISOString() }
        await atomicWriteFile(path, `${JSON.stringify({ version: 1, completedAt }, null, 2)}\n`)
      }).catch(() => undefined)
      return writes
    }
  }
}
