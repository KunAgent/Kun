import { normalizeWritePath } from './write-path-normalization'

// Unlike the disk-write queue, these tasks include save completion/state updates.
// A directory rename conflicts with every descendant, but unrelated files remain concurrent.
type DocumentOperation = {
  root: string
  path: string
  done: Promise<unknown>
}
const operations = new Set<DocumentOperation>()
const normalize = (path: string): string => normalizeWritePath(path.trim())
const contains = (parent: string, path: string): boolean =>
  path === parent || path.startsWith(parent.endsWith('/') ? parent : `${parent}/`)

export function enqueueWriteDocumentOperation<T>(
  workspaceRoot: string,
  path: string,
  operation: (currentPath: string) => Promise<T>
): Promise<T> {
  const root = normalize(workspaceRoot)
  const normalizedPath = normalize(path)
  const previous = [...operations].filter((task) => task.root === root && (
    contains(task.path, normalizedPath) || contains(normalizedPath, task.path)
  ))
  const entry: DocumentOperation = { root, path: normalizedPath, done: Promise.resolve() }
  const task = Promise.all(previous.map((item) => item.done.catch(() => undefined)))
    .then(() => operation(entry.path))
  entry.done = task
  operations.add(entry)
  void task.finally(() => operations.delete(entry)).catch(() => undefined)
  return task
}

/** Only queued requests are redirected; future requests must use the current store path. */
export function relocateQueuedWriteDocumentOperations(
  workspaceRoot: string,
  previousPath: string,
  nextPath: string
): void {
  const root = normalize(workspaceRoot)
  const previous = normalize(previousPath)
  for (const task of operations) {
    if (task.root === root && contains(previous, task.path)) {
      const next = normalize(nextPath)
      const suffix = task.path.slice(previous.length).replace(/^\/+/, '')
      task.path = suffix ? `${next}${next.endsWith('/') ? '' : '/'}${suffix}` : next
    }
  }
}
