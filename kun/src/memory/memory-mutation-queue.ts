import { resolve } from 'node:path'

// Manager owns cross-process writes. This queue also serializes canonical file
// adapters sharing a path within one owner (including hot config replacements).
const queues = new Map<string, Promise<void>>()

export function withMemoryMutation<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const resolved = resolve(path)
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const run = (queues.get(key) ?? Promise.resolve()).then(operation, operation)
  const settled = run.then(() => undefined, () => undefined)
  queues.set(key, settled)
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key) })
  return run
}
