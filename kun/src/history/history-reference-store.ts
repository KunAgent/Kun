import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { CreateThreadRequest } from '../contracts/threads.js'
import { HistoryReferenceSchema, type HistoryReference } from '../contracts/history-reference.js'
import { AtomicJsonFile, assertManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'

const ReservationSchema = z.object({
  requestHash: z.string(),
  threadId: z.string(),
  referenceId: z.string(),
  request: CreateThreadRequest,
  completed: z.boolean().default(false)
}).strict()
export type HistoryBranchReservation = z.infer<typeof ReservationSchema>

/** AtomicJsonFile delegates physical persistence to the configured Service Manager. */
export class HistoryReferenceStore {
  readonly directory: string

  constructor(dataDir: string) {
    this.directory = join(resolve(dataDir), 'history-references')
    assertManagerAtomicJsonPath(join(this.directory, 'store.json'))
  }

  withMutation<T>(operation: () => Promise<T>): Promise<T> {
    return withManagerDataMutex(this.directory, async (context) => {
      await context.assertCurrent()
      return context.withCommit(operation)
    })
  }

  get(id: string): Promise<HistoryReference | null> {
    return this.reference(id).read(() => null)
  }

  async put(reference: HistoryReference): Promise<HistoryReference> {
    const value = HistoryReferenceSchema.parse(reference)
    await this.reference(value.id).write(value)
    return value
  }

  async remove(id: string): Promise<void> {
    await this.reference(id).delete()
  }

  getReservation(key: string): Promise<HistoryBranchReservation | null> {
    return this.reservation(key).read(() => null)
  }

  async saveReservation(key: string, value: HistoryBranchReservation): Promise<void> {
    await this.reservation(key).write(ReservationSchema.parse(value))
  }

  private reference(id: string): AtomicJsonFile<HistoryReference | null> {
    return new AtomicJsonFile(join(this.directory, `${historyKey(id)}.json`), (value) =>
      value === null ? null : HistoryReferenceSchema.parse(value))
  }

  private reservation(key: string): AtomicJsonFile<HistoryBranchReservation | null> {
    return new AtomicJsonFile(join(this.directory, 'requests', `${historyKey(key)}.json`), (value) =>
      value === null ? null : ReservationSchema.parse(value))
  }
}

export function historyKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
