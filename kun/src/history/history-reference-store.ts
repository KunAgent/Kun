import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { CreateThreadRequest } from '../contracts/threads.js'
import { HistoryReferenceSchema, type HistoryReference } from '../contracts/history-reference.js'
import { AtomicJsonFile, assertManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { listHistoryReservationKeys } from './history-reference-reservations.js'

const ReservationSchema = z.object({
  requestHash: z.string(),
  threadId: z.string(),
  referenceId: z.string(),
  request: CreateThreadRequest.optional(),
  completed: z.boolean().default(false),
  deleted: z.boolean().optional()
}).strict().refine((value) => value.deleted === true || value.request !== undefined, {
  message: 'A live branch reservation requires its create request'
})
export type HistoryBranchReservation = z.infer<typeof ReservationSchema>

/** AtomicJsonFile delegates physical persistence to the configured Service Manager. */
export class HistoryReferenceStore {
  readonly directory: string

  constructor(private readonly dataDir: string) {
    this.directory = join(resolve(dataDir), 'history-references')
    assertManagerAtomicJsonPath(join(this.directory, 'store.json'))
  }

  /** Lifecycle callbacks may acquire unrelated Manager resources; reserve commits only around our writes. */
  withLifecycleMutation<T>(operation: () => Promise<T>): Promise<T> {
    return withManagerDataMutex(this.directory, async (context) => {
      await context.assertCurrent()
      return operation()
    })
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
    await this.withMutation(() => this.reference(value.id).write(value))
    return value
  }

  async remove(id: string): Promise<void> {
    await this.withMutation(() => this.reference(id).delete())
  }

  getReservation(key: string): Promise<HistoryBranchReservation | null> {
    return this.reservation(key).read(() => null)
  }

  async saveReservation(key: string, value: HistoryBranchReservation): Promise<void> {
    await this.withMutation(() => this.reservation(key).write(ReservationSchema.parse(value)))
  }

  async reservations(): Promise<Array<{ key: string; value: HistoryBranchReservation }>> {
    const result: Array<{ key: string; value: HistoryBranchReservation }> = []
    for (const key of await listHistoryReservationKeys(this.dataDir)) {
      const value = await this.reservationFile(key).read(() => null)
      if (value) result.push({ key, value })
    }
    return result
  }

  async tombstoneReservation(key: string, value: HistoryBranchReservation): Promise<void> {
    await this.withMutation(() => this.reservationFile(key).write({ requestHash: value.requestHash,
      threadId: value.threadId, referenceId: value.referenceId, completed: true, deleted: true }))
  }

  private reference(id: string): AtomicJsonFile<HistoryReference | null> {
    return new AtomicJsonFile(join(this.directory, `${historyKey(id)}.json`), (value) =>
      value === null ? null : HistoryReferenceSchema.parse(value))
  }

  private reservation(key: string): AtomicJsonFile<HistoryBranchReservation | null> {
    return this.reservationFile(historyKey(key))
  }

  private reservationFile(key: string): AtomicJsonFile<HistoryBranchReservation | null> {
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('Invalid history reservation key')
    return new AtomicJsonFile(join(this.directory, 'requests', `${key}.json`), (value) =>
      value === null ? null : ReservationSchema.parse(value))
  }
}

export function historyKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
