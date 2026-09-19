import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { AgentIdentitySchema } from '../contracts/agent-identities.js'
import { RoomSidebarQuery, type RoomSidebarEntry, type RoomSidebarPage } from '../contracts/room-sidebar.js'
import { roomAttentionPredicateSql } from './room-activity-predicates.js'
import { roomMessagePreview } from './room-message-preview.js'
import { RoomSchema, type RoomMessage } from '../contracts/rooms.js'

const Cursor = z.object({ scope: z.string(), pinned: z.number().int().min(0).max(1), activitySeq: z.number().int().nonnegative(), id: z.string() }).strict()
/** One keyset across both persisted conversations and identities with no private chat yet. */
export function queryRoomSidebar(db: DatabaseSync, raw: RoomSidebarQuery): RoomSidebarPage {
  const input = RoomSidebarQuery.parse(raw)
  const { cursor: encoded, limit, ...filter } = input
  const scope = createHash('sha256').update(JSON.stringify(filter)).digest('hex')
  let cursor: z.infer<typeof Cursor> | undefined
  if (encoded) {
    try { cursor = Cursor.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))) }
    catch { throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'invalid sidebar cursor' }]) }
    if (cursor.scope !== scope) throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'sidebar cursor scope changed' }])
  }
  const conditions = ['s.archived=?'], args: Array<string | number> = [input.archivedOnly ? 1 : 0]
  if (input.kind === 'all') conditions.push("conversation_kind IN ('user_agent','group')")
  else { conditions.push('conversation_kind=?'); args.push(input.kind === 'agents' ? 'user_agent' : input.kind) }
  if (input.search) { conditions.push("instr(lower(name || ' ' || title),lower(?))>0"); args.push(input.search) }
  if (input.repositoryRoot) {
    conditions.push("EXISTS(SELECT 1 FROM json_each(room_document,'$.repositories') repo WHERE json_extract(repo.value,'$.canonicalRoot')=?)")
    args.push(input.repositoryRoot)
  }
  if (input.unreadOnly) conditions.push('message_seq>read_seq')
  if (input.attentionOnly) conditions.push('attention_count>0')
  const rows = db.prepare(`WITH identities AS (
    SELECT a.id AS agent_id, a.document AS agent_document, a.archived AS agent_archived, a.seq AS created_seq,
      (SELECT r.id FROM room_documents r WHERE r.kind='room' AND json_extract(r.document,'$.conversationKind')='user_agent'
        AND json_extract(r.document,'$.members[0].participantAgentId')=a.id ORDER BY r.seq LIMIT 1) AS room_id
    FROM room_documents a WHERE a.kind='agent_identity'
  ), entries AS (
    SELECT 'agent:' || a.agent_id AS stable_id, a.agent_id, a.agent_document, r.id AS room_id, r.document AS room_document,
      'user_agent' AS conversation_kind, json_extract(a.agent_document,'$.name') AS name,
      COALESCE(json_extract(a.agent_document,'$.title'),'') AS title,
      CASE WHEN a.agent_archived=1 OR r.archived=1 THEN 1 ELSE 0 END AS archived,
      COALESCE(json_extract(r.document,'$.pinned'),0) AS pinned,
      a.created_seq AS created_seq
    FROM identities a LEFT JOIN room_documents r ON r.kind='room' AND r.id=a.room_id
    UNION ALL
    SELECT 'room:' || r.id, NULL, NULL, r.id, r.document, COALESCE(json_extract(r.document,'$.conversationKind'),'group'),
      json_extract(r.document,'$.name'), COALESCE(json_extract(r.document,'$.description'),''), r.archived,
      COALESCE(json_extract(r.document,'$.pinned'),0), r.seq
    FROM room_documents r WHERE r.kind='room' AND COALESCE(json_extract(r.document,'$.conversationKind'),'group')<>'user_agent'
  ), summaries AS (
    SELECT e.*,
      COALESCE((SELECT m.seq FROM room_documents m WHERE m.kind='message' AND m.room_id=e.room_id
        AND COALESCE(json_extract(m.document,'$.status'),'final')<>'streaming'
        AND COALESCE(json_extract(m.document,'$.presentationKind'),'')<>'setup'
        ORDER BY m.seq DESC LIMIT 1),0) AS message_seq,
      COALESCE((SELECT json_extract(r.document,'$.seq') FROM room_documents r WHERE r.kind='read_state' AND r.id=e.room_id),0) AS read_seq,
      (SELECT COUNT(DISTINCT CASE WHEN t.kind='request' THEN 'request:' || t.id
        WHEN COALESCE(json_extract(t.document,'$.task.requestId'),json_extract(t.document,'$.requestId')) IS NOT NULL
          THEN 'request:' || COALESCE(json_extract(t.document,'$.task.requestId'),json_extract(t.document,'$.requestId'))
        ELSE 'task:' || COALESCE(t.task_id,json_extract(t.document,'$.taskId'),t.id) END)
        FROM room_documents t WHERE t.room_id=e.room_id AND ${roomAttentionPredicateSql('t')}) AS attention_count,
      (SELECT COUNT(DISTINCT CASE WHEN r.kind='request' THEN 'request:' || r.id
        WHEN r.kind='room_run' THEN 'run:' || r.id ELSE 'task:' || COALESCE(r.task_id,json_extract(r.document,'$.taskId'),r.id) END)
        FROM room_documents r WHERE
        (r.room_id=e.room_id AND ((r.kind='task' AND r.status IN ('queued','running','waiting_dependency','stopping')) OR
          (r.kind='request' AND r.status IN ('pending','running','stopping')) OR
          (r.kind='integration' AND r.status IN ('preparing','validating')))) OR
        (r.kind='room_run' AND r.status IN ('queued','running','recovery_required') AND (
          (e.agent_id IS NOT NULL AND json_extract(r.document,'$.participantAgentId')=e.agent_id) OR
          (e.agent_id IS NULL AND r.room_id=e.room_id AND json_extract(r.document,'$.phase') IN ('discussion','triage','conversation'))))) AS running_count
    FROM entries e
  ), ordered AS (
    SELECT s.*, CASE WHEN s.message_seq>0 THEN s.message_seq ELSE s.created_seq END AS activity_seq,
      CASE WHEN m.id IS NOT NULL THEN json_object('id',m.id,'authorKind',json_extract(m.document,'$.authorKind'),
      'authorLabelSnapshot',json_extract(m.document,'$.authorLabelSnapshot'),'createdAt',json_extract(m.document,'$.createdAt'),
      'body',substr(COALESCE(json_extract(m.document,'$.body'),''),1,2000),
      'attachmentIds',json(COALESCE(json_extract(m.document,'$.attachmentIds'),'[]'))) END AS latest_message
    FROM summaries s LEFT JOIN room_documents m ON m.kind='message' AND m.seq=s.message_seq
    WHERE ${conditions.join(' AND ')}
  ) SELECT * FROM ordered ${cursor ? 'WHERE (pinned,activity_seq,stable_id)<(?,?,?)' : ''}
  ORDER BY pinned DESC, activity_seq DESC, stable_id DESC LIMIT ?`).all(...args,
    ...(cursor ? [cursor.pinned, cursor.activitySeq, cursor.id] : []), limit + 1) as Array<{
      stable_id: string; agent_document: string | null; agent_id: string | null; room_document: string | null; room_id: string | null
      conversation_kind: RoomSidebarEntry['kind']; name: string; title: string; archived: number; pinned: number; activity_seq: number
      latest_message: string | null; message_seq: number; read_seq: number; running_count: number; attention_count: number
    }>
  const page = rows.slice(0, limit), last = page.at(-1)
  return { entries: page.map((row) => {
    const agent = row.agent_document ? AgentIdentitySchema.parse(JSON.parse(row.agent_document)) : undefined
    const room = row.room_document ? RoomSchema.parse(JSON.parse(row.room_document)) : undefined
    const message = row.latest_message ? JSON.parse(row.latest_message) as RoomMessage : undefined
    return { id: row.stable_id, agentId: row.agent_id ?? undefined, roomId: row.room_id ?? undefined,
      name: row.name, title: row.title,
      avatar: agent?.avatar ?? (row.conversation_kind === 'user_agent' ? undefined : room?.avatar),
      kind: row.conversation_kind, members: room?.members ?? [],
      activitySeq: row.activity_seq, pinned: Boolean(row.pinned), archived: Boolean(row.archived), latestMessageSeq: row.message_seq, readSeq: row.read_seq,
      runningCount: row.running_count, attentionCount: row.attention_count,
      latestMessage: message ? { id: message.id, authorKind: message.authorKind, authorLabelSnapshot: message.authorLabelSnapshot,
        createdAt: message.createdAt, preview: roomMessagePreview(message.body), attachmentCount: message.attachmentIds.length } : undefined }
  }), ...(rows.length > limit && last ? { nextCursor: Buffer.from(JSON.stringify({ scope, pinned: last.pinned,
    activitySeq: last.activity_seq, id: last.stable_id })).toString('base64url') } : {}) }
}
