import type { DatabaseSync } from 'node:sqlite'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomReplyPage, RoomReplyPageInput } from '../contracts/room-replies.js'
import { MAX_ROOM_REPLY_DEPTH } from './room-replies.js'

type MessageRow = { id: string; room_id: string; seq: number; document: string }
const asMessage = (row: MessageRow): RoomMessage => ({ ...JSON.parse(row.document), messageSeq: row.seq })

export function initializeRoomReplyIndex(db: DatabaseSync): void {
  db.exec(`CREATE INDEX IF NOT EXISTS room_message_reply_parent ON room_documents
    (room_id, json_extract(document, '$.replyToMessageId')) WHERE kind='message';
    CREATE INDEX IF NOT EXISTS room_message_display_thread ON room_documents
    (room_id, json_extract(document, '$.displayThreadRootId')) WHERE kind='message';`)
}

function rootMessage(db: DatabaseSync, roomId: string, messageId: string):
  { root?: RoomMessage; unavailableReason?: string } {
  const read = db.prepare("SELECT id,room_id,seq,document FROM room_documents WHERE kind='message' AND id=?")
  const visited = new Set<string>()
  let next = messageId
  for (let depth = 0; depth <= MAX_ROOM_REPLY_DEPTH; depth += 1) {
    if (visited.has(next)) return { unavailableReason: 'cycle' }
    visited.add(next)
    const row = read.get(next) as MessageRow | undefined
    if (!row || row.room_id !== roomId) return { unavailableReason: depth ? 'missing_parent' : 'missing_message' }
    const message = asMessage(row)
    if (!message.replyToMessageId) return message.displayThreadRootId && message.displayThreadRootId !== message.id
      ? { unavailableReason: 'inconsistent_root' } : { root: message }
    if (message.displayThreadRootId === message.id) return { unavailableReason: 'cycle' }
    next = message.displayThreadRootId ?? message.replyToMessageId
  }
  return { unavailableReason: 'depth_limit' }
}

// Host-proven display roots are direct seeds. Only historical messages without
// this projection need recursive ancestry. Count/filter precede LIMIT in SQLite.
const descendants = `WITH RECURSIVE reply_tree(id,depth,path) AS (
  SELECT id,0,',' || id || ',' FROM room_documents WHERE kind='message' AND room_id=?
    AND (id=? OR json_extract(document,'$.displayThreadRootId')=?)
  UNION ALL
  SELECT child.id,parent.depth+1,parent.path || child.id || ','
  FROM reply_tree parent JOIN room_documents child
    ON json_extract(child.document,'$.replyToMessageId')=parent.id
  WHERE child.kind='message' AND child.room_id=? AND parent.depth<${MAX_ROOM_REPLY_DEPTH}
    AND json_extract(child.document,'$.displayThreadRootId') IS NULL
    AND instr(parent.path,',' || child.id || ',')=0
), selected AS (
  SELECT DISTINCT message.id,message.room_id,message.seq
  FROM room_documents message JOIN reply_tree tree ON tree.id=message.id
  WHERE message.kind='message' AND message.room_id=? AND message.id<>?
)`

function treeArgs(roomId: string, rootId: string): string[] {
  return [roomId, rootId, rootId, roomId, roomId, rootId]
}

export function roomReplyPage(db: DatabaseSync, input: RoomReplyPageInput): RoomReplyPage {
  const resolved = rootMessage(db, input.roomId, input.messageId)
  if (!resolved.root) return { root: null, messages: [], total: 0, unavailableReason: resolved.unavailableReason }
  const root = resolved.root
  const args = treeArgs(input.roomId, root.id)
  const counts = db.prepare(`${descendants} SELECT count(*) AS total FROM selected`).get(...args) as { total: number }
  const truncated = db.prepare(`${descendants} SELECT 1 AS clipped FROM reply_tree tree
    JOIN room_documents child ON json_extract(child.document,'$.replyToMessageId')=tree.id
    WHERE tree.depth=${MAX_ROOM_REPLY_DEPTH} AND child.kind='message' AND child.room_id=?
      AND json_extract(child.document,'$.displayThreadRootId') IS NULL
      AND instr(tree.path,',' || child.id || ',')=0 LIMIT 1`).get(...args, input.roomId)
  const limit = Math.max(1, Math.min(100, input.limit ?? 40))
  const rows = db.prepare(`${descendants}, page AS MATERIALIZED (
    SELECT id,room_id,seq FROM selected
    ${input.beforeSeq === undefined ? '' : 'WHERE seq<?'} ORDER BY seq DESC LIMIT ?
  ) SELECT page.id,page.room_id,page.seq,message.document FROM page
    JOIN room_documents message ON message.kind='message' AND message.id=page.id AND message.room_id=page.room_id
    ORDER BY page.seq DESC`)
    .all(...args, ...(input.beforeSeq === undefined ? [] : [input.beforeSeq]), limit + 1) as MessageRow[]
  const visible = rows.slice(0, limit)
  return { root: { ...root, ...(counts.total ? { replyCount: counts.total } : {}) },
    messages: visible.reverse().map((row) => ({ ...asMessage(row), displayThreadRootId: root.id })), total: counts.total,
    ...(rows.length > limit ? { nextCursor: String(rows[limit - 1].seq) } : {}),
    ...(truncated ? { unavailableReason: 'depth_limit' } : {}) }
}

/** Called only after the canonical main-feed page is selected; no frontend N+1 reads. */
export function projectRoomReplyCounts(db: DatabaseSync, messages: RoomMessage[]): RoomMessage[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object' || typeof message.roomId !== 'string' || typeof message.id !== 'string') return message
    if (message.replyToMessageId || message.displayThreadRootId && message.displayThreadRootId !== message.id) return message
    const args = treeArgs(message.roomId, message.id)
    const total = Number(db.prepare(`${descendants} SELECT count(*) AS total FROM selected`).get(...args)?.total ?? 0)
    return total ? { ...message, replyCount: total } : message
  })
}
