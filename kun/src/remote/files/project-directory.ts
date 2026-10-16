import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { isRemoteCodeAllowed } from '../code/access.js'
export async function projects(runtime: ServerRuntime) {
  const roots = new Set((await runtime.rooms?.workbench.directory.get())?.codeProjects ?? [])
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
    const page = await runtime.threadService.listPage({ workbenchScope: 'code', limit: 200, cursor })
    for (const thread of page.threads) {
      if (await isRemoteCodeAllowed(runtime, thread)) roots.add(thread.workspace)
    }
    if (!page.hasMore) break
    if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('PROJECT_DIRECTORY_UNAVAILABLE')
    cursor = page.nextCursor
    seen.add(cursor)
  } while (cursor)
  const result = []
  const canonicalRoots = new Set<string>()
  for (const path of roots) {
    try {
      const canonical = await realpath(path)
      if (!canonicalRoots.has(canonical) && (await stat(canonical)).isDirectory()) {
        canonicalRoots.add(canonical)
        result.push({
          id: createHash('sha256').update(canonical).digest('hex'),
          name: basename(canonical),
          path: canonical
        })
      }
    } catch {}
  }
  return result
}
