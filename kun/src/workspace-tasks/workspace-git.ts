import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { normalizeGraphRelativePath } from '../contracts/graph-path.js'
import type { ManagerDataMutexOperationContext } from '../manager/data-mutex.js'

/**
 * Generic git helpers for host-managed task worktrees and Graph write
 * isolation (docs/ade/07 §3). The mutex context propagates whichever
 * Manager data mutex is currently holding the write fence; callers run
 * their operations inside `workspaceWriteMutexContext.run(...)`.
 */
export const workspaceWriteMutexContext =
  new AsyncLocalStorage<ManagerDataMutexOperationContext>()

export async function assertWorkspaceWriteFence(): Promise<void> {
  const context = workspaceWriteMutexContext.getStore()
  context?.signal.throwIfAborted()
  await context?.assertCurrent()
  context?.signal.throwIfAborted()
}

const execFileAsync = promisify(execFile)

export async function withWorkspaceWriteCommit<T>(
  operation: (context: ManagerDataMutexOperationContext) => Promise<T>
): Promise<T> {
  const context = workspaceWriteMutexContext.getStore()
  if (!context) throw new Error('Workspace write commit requires an active mutex context')
  return context.withCommit(() => operation(context))
}

export async function workspaceCommitGit(cwd: string, args: string[]): Promise<string> {
  const context = workspaceWriteMutexContext.getStore()
  if (!context) return workspaceGit(cwd, args)
  return context.withCommit(() => workspaceGit(cwd, args))
}

export async function workspaceGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal
): Promise<string> {
  const operationSignal = signal ?? workspaceWriteMutexContext.getStore()?.signal
  operationSignal?.throwIfAborted()
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    signal: operationSignal
  })
  operationSignal?.throwIfAborted()
  return result.stdout
}

export async function workspaceChangeSnapshot(
  workspaceRoot: string,
  signal?: AbortSignal
): Promise<Record<string, string>> {
  const output = await workspaceGit(workspaceRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames'
  ], signal)
  const snapshot: Record<string, string> = {}
  for (const entry of output.split('\0').filter(Boolean)) {
    signal?.throwIfAborted()
    if (entry.length < 4) continue
    const status = entry.slice(0, 2)
    const path = normalizeGraphRelativePath(entry.slice(3))
    const signature = await readFile(resolve(workspaceRoot, path))
      .then((content) => createHash('sha256').update(content).digest('hex'))
      .catch((error) =>
        String((error as { code?: unknown })?.code ?? '') === 'ENOENT'
          ? 'missing'
          : Promise.reject(error))
    snapshot[path] = `${status}:${signature}`
  }
  return snapshot
}

export async function workingTreeChangedFiles(
  repositoryRoot: string,
  signal?: AbortSignal
): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    workspaceGit(repositoryRoot, ['diff', '-z', '--name-only', '--no-renames', 'HEAD'], signal),
    workspaceGit(repositoryRoot, ['ls-files', '-z', '--others', '--exclude-standard'], signal)
  ])
  return [...new Set(
    [...tracked.split('\0'), ...untracked.split('\0')]
      .filter(Boolean)
      .map((path) => normalizeGraphRelativePath(path))
  )].sort()
}
