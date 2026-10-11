/** Renderer mirror of kun/src/contracts/review-revision.ts. */
export type ReviewArtifactTarget =
  | { kind: 'task-workspace'; workspaceId: string }
  | { kind: 'source-checkout'; workspaceId: string }

export type ReviewRevision = {
  version: 1
  target: ReviewArtifactTarget
  headRevision?: string
  contentHash?: string
  completeness: 'complete' | 'incomplete'
  reason?: 'git_unavailable' | 'too_many_files' | 'file_too_large' |
    'total_bytes_exceeded' | 'concurrent_change' | 'unsupported_entry'
  fileCount: number
  capturedAt: string
}

export type ReviewRevisionValidity = 'current' | 'stale' | 'unknown'

export function reviewRevisionValidity(
  decided: ReviewRevision | undefined,
  current: ReviewRevision | undefined
): ReviewRevisionValidity {
  if (!decided || !current || decided.completeness !== 'complete' ||
      current.completeness !== 'complete' || !decided.contentHash ||
      !current.contentHash || decided.target.kind !== current.target.kind ||
      decided.target.workspaceId !== current.target.workspaceId) return 'unknown'
  return decided.contentHash === current.contentHash ? 'current' : 'stale'
}
