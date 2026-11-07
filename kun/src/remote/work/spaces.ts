import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'

export type WorkSpaceRoot = { id: string; name: string; path: string; isDefault: boolean }
const THREAD_PAGE = 200, THREAD_PAGES = 20

async function canonicalDirectory(path: string) {
  try {
    const canonical = await realpath(path)
    return (await stat(canonical)).isDirectory() ? canonical : undefined
  } catch { return undefined }
}
/** Every Work thread's workspace, so a space stays readable after the desktop's recent list moves on. */
async function threadWorkspaces(runtime: ServerRuntime) {
  const counts = new Map<string, number>()
  let cursor: string | undefined
  for (let index = 0; index < THREAD_PAGES; index++) {
    const page = await runtime.threadService.listPage({ workbenchScope: 'work', lean: true, limit: THREAD_PAGE, cursor })
    for (const thread of page.threads) counts.set(thread.workspace, (counts.get(thread.workspace) ?? 0) + 1)
    if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) break
    cursor = page.nextCursor
  }
  return counts
}
/** The roots the desktop registered for Work, with the same id scheme as Code projects; paths never leave the host. */
export async function workSpaces(runtime: ServerRuntime) {
  const directory = await runtime.rooms?.workbench.directory.get()
  const counted = await threadWorkspaces(runtime)
  const defaultRoot = directory?.defaultWorkRoot ? await canonicalDirectory(directory.defaultWorkRoot) : undefined
  const spaces = new Map<string, WorkSpaceRoot & { sessionCount: number }>()
  for (const path of new Set([...(directory?.workRoots ?? []), ...(directory?.defaultWorkRoot ? [directory.defaultWorkRoot] : []), ...counted.keys()])) {
    const canonical = await canonicalDirectory(path)
    if (!canonical) continue
    const space = spaces.get(canonical) ?? { id: createHash('sha256').update(canonical).digest('hex'), name: basename(canonical),
      path: canonical, isDefault: canonical === defaultRoot, sessionCount: 0 }
    space.sessionCount += counted.get(path) ?? 0
    spaces.set(canonical, space)
  }
  return [...spaces.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.sessionCount - a.sessionCount || a.name.localeCompare(b.name))
}
