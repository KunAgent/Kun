import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkspaceFileListResult } from '../../shared/workspace-file'
import { resolveWorkspaceDirectory } from './workspace-paths'

export const MAX_WORKSPACE_LISTED_FILES = 50_000
const MAX_LISTING_DEPTH = 24
const LISTING_TIME_BUDGET_MS = 4_000

/** Folders that are never worth searching: VCS internals, dependencies and caches. */
const SKIPPED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.pnpm-store', '__pycache__', '.venv', 'venv', '.tox',
  '.gradle', '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', '.DS_Store'
])

/**
 * Lists workspace files (relative, forward-slash paths) for quick-open style
 * search. Breadth first, so a capped or timed-out listing still covers the
 * shallow, most relevant part of the tree.
 */
export async function listWorkspaceFiles(
  payload: { workspaceRoot: string },
  now: () => number = Date.now
): Promise<WorkspaceFileListResult> {
  try {
    const root = await resolveWorkspaceDirectory({ workspaceRoot: payload.workspaceRoot })
    const started = now()
    const files: string[] = []
    let truncated = false
    let queue: Array<{ path: string; relative: string; depth: number }> = [{ path: root, relative: '', depth: 0 }]
    while (queue.length > 0 && !truncated) {
      const next: typeof queue = []
      for (const directory of queue) {
        if (files.length >= MAX_WORKSPACE_LISTED_FILES || now() - started > LISTING_TIME_BUDGET_MS) {
          truncated = true
          break
        }
        const entries = await readdir(directory.path, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
          const relative = directory.relative ? `${directory.relative}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name) && directory.depth < MAX_LISTING_DEPTH) {
              next.push({ path: join(directory.path, entry.name), relative, depth: directory.depth + 1 })
            }
            continue
          }
          if (entry.name === '.DS_Store') continue
          if (entry.isFile() || entry.isSymbolicLink()) files.push(relative)
          if (files.length >= MAX_WORKSPACE_LISTED_FILES) {
            truncated = true
            break
          }
        }
        if (truncated) break
      }
      queue = next
    }
    return { ok: true, root, files, truncated }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
