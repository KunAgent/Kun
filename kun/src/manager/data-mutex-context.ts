import { AsyncLocalStorage } from 'node:async_hooks'
import type { ManagerResourceFence } from './resource-lease-state.js'

export type ManagerDataMutexOperationContext = {
  resource: string
  signal: AbortSignal
  fence?: ManagerResourceFence
  /** Check Manager fencing immediately before an irreversible side effect. */
  assertCurrent: () => Promise<void>
  /** Keep irreversible effects inside this reservation so Manager can fence their final commit. */
  withCommit: <T>(operation: (commitId?: string) => Promise<T>) => Promise<T>
}

const storage = new AsyncLocalStorage<ManagerDataMutexOperationContext>()
const commitStorage = new AsyncLocalStorage<string>()

export function currentManagerDataMutexContext(): ManagerDataMutexOperationContext | undefined {
  return storage.getStore()
}

export function currentManagerDataCommitId(): string | undefined {
  return commitStorage.getStore()
}

export function runWithManagerDataCommitId<T>(
  commitId: string,
  operation: () => Promise<T>
): Promise<T> {
  return commitStorage.run(commitId, operation)
}

export function runWithManagerDataMutexContext<T>(
  context: ManagerDataMutexOperationContext,
  operation: () => Promise<T>
): Promise<T> {
  return storage.run(context, operation)
}
