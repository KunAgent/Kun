import { AsyncLocalStorage } from 'node:async_hooks'
import type { ManagerResourceFence } from './resource-lease-state.js'

export type ManagerDataMutexOperationContext = {
  resource: string
  signal: AbortSignal
  fence?: ManagerResourceFence
  /** Origin of the Manager that issued the fence; not an authentication token. */
  managerBaseUrl?: string
  /** Check Manager fencing immediately before an irreversible side effect. */
  assertCurrent: () => Promise<void>
  /** Keep irreversible effects inside this reservation so Manager can fence their final commit. */
  withCommit: <T>(operation: (commitId?: string) => Promise<T>) => Promise<T>
}

const storage = new AsyncLocalStorage<ManagerDataMutexOperationContext>()
const commitStorage = new AsyncLocalStorage<{ resource?: string; commitId: string }>()

export function currentManagerDataMutexContext(): ManagerDataMutexOperationContext | undefined {
  return storage.getStore()
}

export function currentManagerDataCommitId(): string | undefined {
  const commit = commitStorage.getStore()
  return commit?.resource === storage.getStore()?.resource ? commit?.commitId : undefined
}

/** A scheduler wake must not inherit the emitting mutation's already released lease or commit reservation. */
export function runWithoutManagerDataMutexContext<T>(operation: () => T): T {
  return storage.exit(() => commitStorage.exit(operation))
}

export function runWithManagerDataCommitId<T>(
  commitId: string,
  operation: () => Promise<T>
): Promise<T> {
  return commitStorage.run({ resource: storage.getStore()?.resource, commitId }, operation)
}

export function runWithManagerDataMutexContext<T>(
  context: ManagerDataMutexOperationContext,
  operation: () => Promise<T>
): Promise<T> {
  return storage.run(context, operation)
}
