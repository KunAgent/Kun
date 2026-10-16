import { z } from 'zod'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { AgentIdentity } from '../../contracts/agent-identities.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
import { requireRemoteScope, type RemoteAuthority } from '../authorization/scopes.js'
export const AgentDirectoryParams = z.object({ directoryView: z.enum(['visible', 'archived', 'all']).default('visible'),
  cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20) }).strict()
/** Metadata-only directory; archived identities remain discoverable without cached phone IDs. */
export async function remoteAgentDirectory(runtime: ServerRuntime, scope: RemoteAuthority, raw: unknown) {
  requireRemoteScope(scope, 'personal')
  const p = AgentDirectoryParams.parse(raw), token = cursorScope([scope.accountId, scope.deviceId, p.directoryView])
  const { beforeSeq } = readCursor<{ beforeSeq?: number }>(p.cursor, token, {})
  if (beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq < 0)) throw new Error('INVALID_CURSOR')
  const rows = await runtime.rooms!.deps.store.list<AgentIdentity>('agent_identity', { beforeSeq, limit: p.limit + 1,
    includeArchived: p.directoryView === 'all', archivedOnly: p.directoryView === 'archived' })
  const page = rows.slice(0, p.limit), hasMore = rows.length > p.limit
  return { agents: page.map((row) => ({ id: row.id, name: row.value.name, title: row.value.title,
    archived: Boolean(row.value.archivedAt), revision: row.revision, canLeadGroup: !row.value.archivedAt && !row.value.executor })), hasMore,
    nextCursor: hasMore ? writeCursor(token, { beforeSeq: page.at(-1)!.seq }) : undefined }
}
