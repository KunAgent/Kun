import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { normalizeGraphRelativePath } from '../contracts/graph-path.js'

// Git/mutex helpers moved to workspace-tasks/workspace-git.ts (docs/ade/07
// §3); the old names stay exported here for compatibility.
export {
  workspaceWriteMutexContext as graphWriteMutexContext,
  assertWorkspaceWriteFence as assertGraphWriteFence,
  withWorkspaceWriteCommit as withGraphWriteCommit,
  workspaceCommitGit as graphCommitGit,
  workspaceGit as graphGit,
  workspaceChangeSnapshot,
  workingTreeChangedFiles
} from '../workspace-tasks/workspace-git.js'

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
