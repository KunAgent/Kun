import {
  loadKunProjectConfig,
  type KunProjectWorktreeConfig
} from '../config/project-config.js'
import type { ApprovedSetupStep } from './setup-runner.js'
import type { EnvFillEntryMode } from './environment-fill.js'

/**
 * Approved-setup resolution for task workspaces (docs/ade/07 §7.1). The GUI
 * writes digest-bound worktree sections into `ade.approvedWorktreeConfigs`;
 * Kun only returns the declared steps while the live `.kun/project.json`
 * digest still matches — editing any section (MCP included) revokes approval.
 */

export type ApprovedWorktreeConfigEntry = {
  repoRoot: string
  digest: string
  worktree: KunProjectWorktreeConfig
}

export function comparableRepoPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/g, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function createApprovedSectionResolver(
  opts: {
    approvedEntries: () => readonly ApprovedWorktreeConfigEntry[]
    loadConfig?: (repoRoot: string) => Promise<{ status: string; digest?: string } | null>
  },
  pick: (worktree: KunProjectWorktreeConfig) => ApprovedSetupStep[]
): (repoRoot: string) => Promise<ApprovedSetupStep[]> {
  const loadConfig = opts.loadConfig ??
    ((repoRoot: string) => loadKunProjectConfig(repoRoot).catch(() => null))
  return async (repoRoot) => {
    const key = comparableRepoPath(repoRoot)
    const entry = opts.approvedEntries().find(
      (candidate) => comparableRepoPath(candidate.repoRoot) === key
    )
    if (!entry) return []
    const current = await loadConfig(repoRoot)
    if (!current || current.status !== 'valid' || current.digest !== entry.digest) return []
    return pick(entry.worktree)
  }
}

export function createApprovedSetupResolver(opts: {
  approvedEntries: () => readonly ApprovedWorktreeConfigEntry[]
  loadConfig?: (repoRoot: string) => Promise<{ status: string; digest?: string } | null>
}): (repoRoot: string) => Promise<ApprovedSetupStep[]> {
  return createApprovedSectionResolver(opts, (worktree) => worktree.setup)
}

/** `worktree.checks` follow the same whole-config digest approval (10 §4.2). */
export function createApprovedChecksResolver(opts: {
  approvedEntries: () => readonly ApprovedWorktreeConfigEntry[]
  loadConfig?: (repoRoot: string) => Promise<{ status: string; digest?: string } | null>
}): (repoRoot: string) => Promise<ApprovedSetupStep[]> {
  return createApprovedSectionResolver(opts, (worktree) => worktree.checks)
}

/** User-level `worktreeSharedPaths` lookup with repo-root normalization. */
export function userSharedPathsForRepo(
  sharedPaths: Record<string, ReadonlyArray<{ path: string; mode: EnvFillEntryMode }>> | undefined,
  repoRoot: string
): ReadonlyArray<{ path: string; mode: EnvFillEntryMode }> {
  if (!sharedPaths) return []
  const key = comparableRepoPath(repoRoot)
  const entry = Object.entries(sharedPaths).find(
    ([root]) => comparableRepoPath(root) === key
  )
  return entry?.[1] ?? []
}
