import { AsyncLocalStorage } from 'node:async_hooks'
import type { ThreadRecord } from '../contracts/threads.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'

export type ThreadAdmissionWriteGuard = <T>(
  store: ThreadStore, next: ThreadRecord, write: () => Promise<T>, sessions: SessionStore
) => Promise<T>
const admissionWrites = new AsyncLocalStorage<ThreadAdmissionWriteGuard>()

/** Manager installs this at its RPC boundary; execution happens inside its per-thread queue. */
export function withThreadAdmissionWriteGuard<T>(guard: ThreadAdmissionWriteGuard, operation: () => Promise<T>): Promise<T> {
  return admissionWrites.run(guard, operation)
}

export function guardThreadAdmissionWrite<T>(store: ThreadStore, next: ThreadRecord, write: () => Promise<T>, sessions: SessionStore): Promise<T> {
  const guard = admissionWrites.getStore()
  return guard ? guard(store, next, write, sessions) : write()
}
