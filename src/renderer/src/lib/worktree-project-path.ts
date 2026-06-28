import {
  isKunBranchWorktreePath,
  resolveKunBranchWorktreeProjectPath
} from '@shared/kun-worktree-path'
import type { ThreadWorktreeRecord } from './thread-worktree-registry'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from './workspace-path'

export function projectPathForWorktreeRecord(
  record: Pick<ThreadWorktreeRecord, 'projectPath' | 'worktreePath'> | undefined
): string {
  const projectPath = normalizeWorkspaceRoot(record?.projectPath ?? '')
  const worktreePath = normalizeWorkspaceRoot(record?.worktreePath ?? '')
  return projectPath && worktreePath ? projectPath : ''
}

export function resolveProjectWorkspacePath(
  workspacePath: string,
  options: {
    threadWorktrees?: Record<string, Pick<ThreadWorktreeRecord, 'projectPath' | 'worktreePath'>>
    candidateProjectPaths?: readonly string[]
  } = {}
): string {
  const normalized = normalizeWorkspaceRoot(workspacePath)
  if (!normalized) return ''
  if (!isKunBranchWorktreePath(normalized)) return normalized

  const key = workspaceRootIdentityKey(normalized)
  for (const record of Object.values(options.threadWorktrees ?? {})) {
    const worktreePath = normalizeWorkspaceRoot(record.worktreePath)
    if (workspaceRootIdentityKey(worktreePath) === key) {
      const projectPath = projectPathForWorktreeRecord(record)
      if (projectPath) return projectPath
    }
  }

  const resolved = resolveKunBranchWorktreeProjectPath(
    normalized,
    options.candidateProjectPaths ?? []
  )
  return resolved ? normalizeWorkspaceRoot(resolved) : ''
}

export function shouldOmitFromCodeWorkspaceRoots(workspacePath: string): boolean {
  const normalized = normalizeWorkspaceRoot(workspacePath)
  return Boolean(normalized) && isKunBranchWorktreePath(normalized)
}
