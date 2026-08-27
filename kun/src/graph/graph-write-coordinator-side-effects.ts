import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { normalizeGraphRelativePath } from '../contracts/graph-path.js'
import type { ManagerDataMutexOperationContext } from '../manager/data-mutex.js'

export const graphWriteMutexContext = new AsyncLocalStorage<ManagerDataMutexOperationContext>()

export async function assertGraphWriteFence(): Promise<void> {
  const context = graphWriteMutexContext.getStore()
  context?.signal.throwIfAborted()
  await context?.assertCurrent()
  context?.signal.throwIfAborted()
}

const execFileAsync = promisify(execFile)

export async function withGraphWriteCommit<T>(
  operation: (context: ManagerDataMutexOperationContext) => Promise<T>
): Promise<T> {
  const context = graphWriteMutexContext.getStore()
  if (!context) throw new Error('Graph write commit requires an active mutex context')
  return context.withCommit(() => operation(context))
}

export async function graphCommitGit(cwd: string, args: string[]): Promise<string> {
  const context = graphWriteMutexContext.getStore()
  if (!context) return graphGit(cwd, args)
  return context.withCommit(() => graphGit(cwd, args))
}

export async function graphGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal
): Promise<string> {
  const operationSignal = signal ?? graphWriteMutexContext.getStore()?.signal
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
  const output = await graphGit(workspaceRoot, [
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
    graphGit(repositoryRoot, ['diff', '-z', '--name-only', '--no-renames', 'HEAD'], signal),
    graphGit(repositoryRoot, ['ls-files', '-z', '--others', '--exclude-standard'], signal)
  ])
  return normalizeGraphScopes([
    ...tracked.split('\0').filter(Boolean),
    ...untracked.split('\0').filter(Boolean)
  ])
}

export function normalizeGraphScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => {
    try {
      return normalizeGraphRelativePath(scope)
    } catch {
      throw new Error(`invalid Graph write scope: ${scope}`)
    }
  }))].sort()
}

export async function canonicalGraphPath(input: string): Promise<string> {
  const absolute = resolve(input)
  return realpath(absolute).catch(() => absolute)
}

export function safeGraphId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error('invalid resource id')
  return value
}

export function boundedGraphError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 2_048)
}
