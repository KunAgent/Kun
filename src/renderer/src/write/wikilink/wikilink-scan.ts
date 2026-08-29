import type { WorkspaceEntry } from '@shared/workspace-file'
import { toPosix, type WikilinkTarget } from './wikilink-targets'

/**
 * Collects the markdown files of every Work workspace for the `[[` menu.
 *
 * The directory listing is an IPC round trip per folder, so the walk is bounded
 * on three axes — depth, directories visited, and files kept — and noisy
 * machine-generated trees are skipped outright. A menu that is slightly
 * incomplete on a huge tree is far better than one that stalls the editor.
 */

export type WikilinkScanRoot = {
  root: string
  name: string
}

export type WikilinkDirectoryLister = (input: {
  workspaceRoot: string
  path?: string
}) => Promise<{ ok: true; entries: WorkspaceEntry[] } | { ok: false; message: string }>

export type WikilinkScanLimits = {
  maxDepth: number
  maxDirectoriesPerRoot: number
  maxFilesPerRoot: number
  /**
   * Across every root of one scan. The per-root caps bound each workspace,
   * but with many saved workspaces their sum was unbounded — thousands of
   * directory-list IPC calls from one scan.
   */
  maxDirectoriesTotal: number
  maxFilesTotal: number
}

export const DEFAULT_WIKILINK_SCAN_LIMITS: WikilinkScanLimits = {
  maxDepth: 6,
  maxDirectoriesPerRoot: 200,
  maxFilesPerRoot: 800,
  maxDirectoriesTotal: 800,
  maxFilesTotal: 3_200
}

/** Mutable remaining allowance shared by every root of one scan. */
type WikilinkScanBudget = {
  directories: number
  files: number
}

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.kun',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '__pycache__'
])

const MARKDOWN_PATTERN = /\.(md|markdown|mdx)$/i

export function isWikilinkMarkdownName(name: string): boolean {
  return MARKDOWN_PATTERN.test(name)
}

function skipDirectory(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name.toLocaleLowerCase())
}

export type WikilinkScanOutcome = {
  targets: WikilinkTarget[]
  /** True when a limit, budget, or unreadable folder made the walk incomplete. */
  truncated: boolean
  /** Directories the walk could not read. */
  failedDirectories: number
}

/** Walks one workspace breadth-first, so shallow files are always included. */
export async function scanWorkspaceMarkdown(
  scanRoot: WikilinkScanRoot,
  list: WikilinkDirectoryLister,
  limits: WikilinkScanLimits = DEFAULT_WIKILINK_SCAN_LIMITS,
  budget?: WikilinkScanBudget
): Promise<WikilinkScanOutcome> {
  const targets: WikilinkTarget[] = []
  const queue: { path: string; depth: number }[] = [{ path: '', depth: 0 }]
  const seen = new Set<string>()
  let directories = 0
  let truncated = false
  let failedDirectories = 0
  while (queue.length > 0) {
    const current = queue.shift()!
    if (
      directories >= limits.maxDirectoriesPerRoot ||
      targets.length >= limits.maxFilesPerRoot ||
      (budget && (budget.directories <= 0 || budget.files <= 0))
    ) {
      // Work remained when the walk stopped: the result is a partial view,
      // which the menu must be able to say instead of looking like an empty
      // or fully scanned vault.
      truncated = true
      break
    }
    directories += 1
    if (budget) budget.directories -= 1
    let result: Awaited<ReturnType<WikilinkDirectoryLister>>
    try {
      result = await list(
        current.path
          ? { workspaceRoot: scanRoot.root, path: current.path }
          : { workspaceRoot: scanRoot.root }
      )
    } catch {
      failedDirectories += 1
      truncated = true
      continue
    }
    if (!result.ok) {
      failedDirectories += 1
      truncated = true
      continue
    }
    for (const entry of result.entries) {
      if (entry.type === 'directory') {
        if (current.depth + 1 > limits.maxDepth || skipDirectory(entry.name)) continue
        const next = joinRelative(current.path, entry.name)
        if (seen.has(next)) continue
        seen.add(next)
        queue.push({ path: next, depth: current.depth + 1 })
        continue
      }
      if (!isWikilinkMarkdownName(entry.name)) continue
      if (targets.length >= limits.maxFilesPerRoot || (budget && budget.files <= 0)) {
        truncated = true
        break
      }
      if (budget) budget.files -= 1
      targets.push({
        workspaceRoot: scanRoot.root,
        workspaceName: scanRoot.name,
        relativePath: joinRelative(current.path, entry.name),
        name: entry.name
      })
    }
  }
  return { targets, truncated, failedDirectories }
}

function joinRelative(parent: string, name: string): string {
  return parent ? `${toPosix(parent)}/${name}` : name
}

/**
 * Scans every workspace. Roots are walked sequentially rather than in parallel
 * to keep a burst of directory IPC from competing with the editor's own reads,
 * and all of them share one directory/file allowance so the total is bounded
 * no matter how many workspaces are saved.
 */
export async function scanAllWorkspaceMarkdown(
  roots: readonly WikilinkScanRoot[],
  list: WikilinkDirectoryLister,
  limits: WikilinkScanLimits = DEFAULT_WIKILINK_SCAN_LIMITS
): Promise<WikilinkScanOutcome> {
  const collected: WikilinkTarget[] = []
  const seenRoots = new Set<string>()
  let truncated = false
  let failedDirectories = 0
  const budget: WikilinkScanBudget = {
    directories: limits.maxDirectoriesTotal,
    files: limits.maxFilesTotal
  }
  for (const scanRoot of roots) {
    if (budget.directories <= 0 || budget.files <= 0) {
      // Later roots never started: the combined result is partial.
      truncated = true
      break
    }
    const key = toPosix(scanRoot.root).replace(/\/+$/, '')
    if (!key || seenRoots.has(key)) continue
    seenRoots.add(key)
    const outcome = await scanWorkspaceMarkdown(scanRoot, list, limits, budget)
    collected.push(...outcome.targets)
    truncated ||= outcome.truncated
    failedDirectories += outcome.failedDirectories
  }
  return { targets: collected, truncated, failedDirectories }
}
