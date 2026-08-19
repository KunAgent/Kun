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
}

export const DEFAULT_WIKILINK_SCAN_LIMITS: WikilinkScanLimits = {
  maxDepth: 6,
  maxDirectoriesPerRoot: 200,
  maxFilesPerRoot: 800
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

/** Walks one workspace breadth-first, so shallow files are always included. */
export async function scanWorkspaceMarkdown(
  scanRoot: WikilinkScanRoot,
  list: WikilinkDirectoryLister,
  limits: WikilinkScanLimits = DEFAULT_WIKILINK_SCAN_LIMITS
): Promise<WikilinkTarget[]> {
  const targets: WikilinkTarget[] = []
  const queue: { path: string; depth: number }[] = [{ path: '', depth: 0 }]
  const seen = new Set<string>()
  let directories = 0
  while (queue.length > 0) {
    const current = queue.shift()!
    if (directories >= limits.maxDirectoriesPerRoot) break
    if (targets.length >= limits.maxFilesPerRoot) break
    directories += 1
    let result: Awaited<ReturnType<WikilinkDirectoryLister>>
    try {
      result = await list(
        current.path
          ? { workspaceRoot: scanRoot.root, path: current.path }
          : { workspaceRoot: scanRoot.root }
      )
    } catch {
      continue
    }
    if (!result.ok) continue
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
      if (targets.length >= limits.maxFilesPerRoot) break
      targets.push({
        workspaceRoot: scanRoot.root,
        workspaceName: scanRoot.name,
        relativePath: joinRelative(current.path, entry.name),
        name: entry.name
      })
    }
  }
  return targets
}

function joinRelative(parent: string, name: string): string {
  return parent ? `${toPosix(parent)}/${name}` : name
}

/**
 * Scans every workspace. Roots are walked sequentially rather than in parallel
 * to keep a burst of directory IPC from competing with the editor's own reads.
 */
export async function scanAllWorkspaceMarkdown(
  roots: readonly WikilinkScanRoot[],
  list: WikilinkDirectoryLister,
  limits: WikilinkScanLimits = DEFAULT_WIKILINK_SCAN_LIMITS
): Promise<WikilinkTarget[]> {
  const collected: WikilinkTarget[] = []
  const seenRoots = new Set<string>()
  for (const scanRoot of roots) {
    const key = toPosix(scanRoot.root).replace(/\/+$/, '')
    if (!key || seenRoots.has(key)) continue
    seenRoots.add(key)
    collected.push(...await scanWorkspaceMarkdown(scanRoot, list, limits))
  }
  return collected
}
