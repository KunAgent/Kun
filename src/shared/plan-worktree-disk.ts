/** Below this much free space a plan-build worktree is refused (ENOSPC takes the runtime manager down with it). */
export const PLAN_WORKTREE_MIN_FREE_BYTES = 5 * 1024 ** 3

export function planWorktreeLowDiskMessage(freeBytes: number): string {
  const freeGb = (freeBytes / 1024 ** 3).toFixed(1)
  const minGb = (PLAN_WORKTREE_MIN_FREE_BYTES / 1024 ** 3).toFixed(0)
  return `Only ${freeGb} GB of disk space is free (need at least ${minGb} GB). Free up space or remove unused worktrees under ~/.kun/worktrees before building in a worktree.`
}
