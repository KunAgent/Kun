import type { WorkspaceDirectoryListResult, WorkspaceEntry } from '@shared/workspace-file'

const MAX_DIRECTORIES = 200
const MAX_MATCHES = 300
const SKIP = new Set(['.git', 'node_modules', '.cache', 'dist', 'out'])

/** Bounded, cancellable filename search without copying an entire tree into the Work store. */
export async function searchMobileWorkEntries(
  root: string, query: string,
  list: (path: string) => Promise<WorkspaceDirectoryListResult>,
  canceled: () => boolean
): Promise<{ entries: WorkspaceEntry[]; truncated: boolean; skipped: number }> {
  const queue = [root]
  const seen = new Set<string>()
  const found: WorkspaceEntry[] = []
  const needle = query.trim().toLocaleLowerCase()
  let skipped = 0
  while (queue.length && seen.size < MAX_DIRECTORIES && found.length < MAX_MATCHES && !canceled()) {
    const batch = queue.splice(0, Math.min(4, MAX_DIRECTORIES - seen.size))
    const results = await Promise.all(batch.map((path) => list(path).catch(() => null)))
    if (canceled()) break
    for (let index = 0; index < batch.length; index += 1) {
      const dir = batch[index]
      if (seen.has(dir)) continue
      seen.add(dir)
      const result = results[index]
      if (!result?.ok) { skipped += 1; continue }
      for (const entry of result.entries) {
        if (entry.type === 'directory' && !SKIP.has(entry.name) && !seen.has(entry.path)) queue.push(entry.path)
        if (`${entry.name} ${entry.path}`.toLocaleLowerCase().includes(needle)) {
          found.push(entry)
          if (found.length >= MAX_MATCHES) break
        }
      }
    }
  }
  return { entries: found, truncated: queue.length > 0 || found.length >= MAX_MATCHES,
    skipped }
}
