import { realpath } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { encodeThreadCursor } from '../../domain/thread-list-query.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
import type { RemoteCodeManagement } from '../code/management.js'
import { isRemoteCodeAllowed } from '../code/access.js'
import { workSessionAnchor } from './anchor.js'
import { workSpaces } from './spaces.js'

const PLACEHOLDERS = new Set(['Write Assistant', 'New Thread', 'New chat', '新会话', 'Untitled', '未命名'])
const SCAN = 200
/** A placeholder title means the titler has not named the session yet; the phone shows the file instead. */
function shownTitle(title: string, anchor?: string) {
  const trimmed = title.trim()
  if (trimmed && !PLACEHOLDERS.has(trimmed) && !trimmed.startsWith('[写作上下文]')) return trimmed
  return anchor ? basename(anchor) : ''
}
export class RemoteWork {
  constructor(private runtime: ServerRuntime, private code: RemoteCodeManagement) {}
  async spaces() {
    return { spaces: (await workSpaces(this.runtime)).map(({ id, name, sessionCount, isDefault }) => ({ id, name, sessionCount, ...(isDefault ? { isDefault } : {}) })) }
  }
  async sessions(p: { spaceId: string; query?: string; status?: 'all' | 'archived'; cursor?: string; limit?: number }) {
    const space = (await workSpaces(this.runtime)).find((row) => row.id === p.spaceId)
    if (!space) throw new Error('NOT_FOUND')
    const { cursor, limit: requested, ...filter } = p, limit = requested ?? 20, scope = cursorScope(['work.sessions.list', filter])
    const position = readCursor<{ after?: string }>(cursor, scope, {})
    if (position.after !== undefined && typeof position.after !== 'string') throw new Error('INVALID_CURSOR')
    const query = (p.query ?? '').toLowerCase(), archived = p.status === 'archived'
    const roots = new Map<string, Promise<string | null>>(), rootOf = (workspace: string) => {
      let root = roots.get(workspace)
      if (!root) roots.set(workspace, root = realpath(workspace).catch(() => null))
      return root
    }
    const threads: unknown[] = []
    let after = position.after, hasMore = false, scanned = 0
    while (threads.length < limit && scanned < SCAN) {
      const page = await this.runtime.threadService.listPage({ workbenchScope: 'work', lean: true, archivedOnly: archived, cursor: after, limit: 50 })
      hasMore = page.hasMore
      for (const row of page.threads) {
        const next = encodeThreadCursor(row.updatedAt, row.id)
        if (next === after) throw new Error('INVALID_CURSOR')
        after = next; scanned++
        if (await rootOf(row.workspace) === space.path) {
          const thread = await this.runtime.threadService.getMetadata(row.id)
          if (thread && thread.status !== 'deleted' && await isRemoteCodeAllowed(this.runtime, thread)) {
            const anchorPath = await workSessionAnchor(this.runtime, thread, space.path), title = shownTitle(thread.title, anchorPath)
            if (!query || `${title}\n${thread.summary ?? ''}\n${anchorPath ?? ''}`.toLowerCase().includes(query))
              threads.push({ ...await this.code.summary(thread), title, ...(anchorPath ? { anchorPath } : {}) })
          }
        }
        if (threads.length >= limit || scanned >= SCAN) { hasMore = row !== page.threads.at(-1) || page.hasMore; break }
      }
      if (!page.hasMore || threads.length >= limit || scanned >= SCAN) break
    }
    return { threads, hasMore, ...(hasMore ? { nextCursor: writeCursor(scope, { after }) } : {}) }
  }
}
