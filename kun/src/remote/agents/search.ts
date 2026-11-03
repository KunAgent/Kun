import { z } from 'zod'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { AgentIdentity } from '../../contracts/agent-identities.js'
import type { RoomStoredDocument } from '../../rooms/room-store.js'
import { RemoteMessages } from '../messages/service.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), Seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Position = z.object({ beforeSeq: Seq.optional(), pending: z.object({ agentId: Id, seq: Seq,
  revision: Seq, cursor: z.string().min(1).max(2048) }).strict().optional() }).strict()
type Params = { query: string; includeArchived?: boolean; cursor?: string; limit?: number }
type Match = { messageId: string; snippet: string; createdAt: string; historyVersion: string }
type Entry = { id: string; name: string; title: string; revision: number; archived: boolean; match?: Match }

/** Searches all visible personal identities and their currently readable private transcripts, never group/Bot DMs. */
export class RemoteAgentSearch {
  private messages: RemoteMessages
  constructor(private runtime: ServerRuntime) { this.messages = new RemoteMessages(runtime) }
  async search(p: Params) {
    const store = this.runtime.rooms!.deps.store, scope = cursorScope(['agent.search', p.query, p.includeArchived === true])
    const position = Position.parse(readCursor(p.cursor, scope, {})), agents: Entry[] = [], query = p.query.trim().toLowerCase()
    const limit = p.limit ?? 20, deadline = Date.now() + 1000
    let beforeSeq = position.beforeSeq, pending = position.pending, hasMore = false, scanned = 0
    const inspect = async (row: RoomStoredDocument<AgentIdentity>, messageCursor?: string) => {
      const agent = row.value
      if (agent.archivedAt && !p.includeArchived) return true
      const entry: Entry = { id: row.id, name: agent.name, title: agent.title, revision: row.revision, archived: Boolean(agent.archivedAt) }
      if (`${agent.name}\n${agent.title}`.toLowerCase().includes(query)) { agents.push(entry); return true }
      const result = await this.messages.search({ resource: { kind: 'agent', id: row.id }, query: p.query, limit: 1, cursor: messageCursor })
      const match = result.messages[0]
      if (match) agents.push({ ...entry, match: { messageId: match.messageId, snippet: match.snippet,
        createdAt: match.createdAt, historyVersion: match.historyVersion } })
      else if (result.hasMore && result.nextCursor) {
        pending = { agentId: row.id, seq: row.seq, revision: row.revision, cursor: result.nextCursor }
        return false
      }
      return true
    }
    const finish = () => ({ agents, searchScope: 'profile_and_private_messages' as const,
      coverage: 'current_private_conversations' as const, hasMore, complete: !hasMore, scanned,
      ...(hasMore ? { nextCursor: writeCursor(scope, { beforeSeq, ...(pending ? { pending } : {}) }) } : {}) })
    if (pending) {
      const current = pending, row = await store.get<AgentIdentity>('agent_identity', current.agentId)
      pending = undefined
      if (!row || row.seq !== current.seq || row.revision !== current.revision) throw new Error('HISTORY_CHANGED')
      if (!await inspect(row, current.cursor)) { hasMore = true; return finish() }
      beforeSeq = row.seq; scanned++
      if (agents.length >= limit) { hasMore = true; return finish() }
    }
    do {
      const rows = await store.list<AgentIdentity>('agent_identity', { beforeSeq, limit: 50, includeArchived: p.includeArchived === true })
      for (const row of rows) {
        if (beforeSeq !== undefined && row.seq >= beforeSeq) throw new Error('INVALID_CURSOR')
        if (!await inspect(row)) { hasMore = true; return finish() }
        beforeSeq = row.seq; scanned++
        if (agents.length >= limit || scanned >= 100 || Date.now() >= deadline) {
          hasMore = row !== rows.at(-1) || rows.length === 50
          return finish()
        }
      }
      hasMore = rows.length === 50
    } while (hasMore)
    return finish()
  }
}
