import { Buffer } from 'node:buffer'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { RoomSearchQuerySchema, RoomRunSummaryQuerySchema,
  type RoomRepositoryChoice, type RoomSearchHit, type RoomSearchPage, type RoomSearchQuery,
  type RoomRunSummary, type RoomRunSummaryQuery } from '../contracts/room-experience.js'

const SearchCursor = z.object({ kind: z.string(), seq: z.number().int().nonnegative(), id: z.string().max(256) }).strict()
export function queryRoomSearch(db: DatabaseSync, raw: RoomSearchQuery): RoomSearchPage {
  const input = RoomSearchQuerySchema.parse(raw)
  let cursor: z.infer<typeof SearchCursor> | undefined
  if (input.cursor) {
    let parsed: unknown
    try { parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) } catch { parsed = null }
    cursor = SearchCursor.parse(parsed)
    z.literal(input.kind).parse(cursor.kind)
  }
  const common = ["r.kind='room'"]
  const args: Array<string | number> = []
  if (!input.includeArchived) common.push('r.archived=0')
  if (input.roomId) { common.push('r.id=?'); args.push(input.roomId) }
  if (input.repositoryRoot) {
    common.push("EXISTS(SELECT 1 FROM json_each(r.document,'$.repositories') repo WHERE json_extract(repo.value,'$.canonicalRoot')=?)")
    args.push(input.repositoryRoot)
  }
  const roomName = "json_extract(r.document,'$.name')"
  let relation = 'room_documents r', id = 'r.id', seq = 'r.seq'
  let title = roomName, preview = "COALESCE(json_extract(r.document,'$.description'),'')"
  let target = "''", predicate = `${title} || ' ' || ${preview}`
  if (input.kind === 'members') {
    relation += ", json_each(r.document,'$.members') m"
    id = "r.id || ':' || json_extract(m.value,'$.id')"
    title = "json_extract(m.value,'$.displayName')"
    preview = "COALESCE(json_extract(m.value,'$.roleNotes'),'')"
    target = "json_extract(m.value,'$.id')"
    predicate = `${title} || ' ' || ${preview}`
    common.push("json_extract(m.value,'$.removedAt') IS NULL")
  } else if (input.kind === 'messages' || input.kind === 'tasks') {
    const kind = input.kind === 'messages' ? 'message' : 'task'
    relation += ` JOIN room_documents m ON m.room_id=r.id AND m.kind='${kind}'`
    id = 'm.id'; seq = 'm.seq'; target = 'm.id'
    title = input.kind === 'messages' ? "json_extract(m.document,'$.authorLabelSnapshot')" : "json_extract(m.document,'$.task.title')"
    preview = input.kind === 'messages' ? "COALESCE(json_extract(m.document,'$.body'),'')" : "COALESCE(json_extract(m.document,'$.task.latestProgress'),'')"
    predicate = input.kind === 'messages' ? preview : `${title} || ' ' || ${preview}`
  }
  common.push(`instr(lower(${predicate}),lower(?))>0`); args.push(input.q)
  if (cursor) { common.push(`(${seq}<? OR (${seq}=? AND ${id}>?))`); args.push(cursor.seq, cursor.seq, cursor.id) }
  args.push(input.limit + 1)
  const rows = db.prepare(`SELECT ${id} AS id,${seq} AS seq,r.id AS room_id,${roomName} AS room_name,
    substr(${title},1,300) AS title,substr(${preview},1,800) AS preview,${target} AS target
    FROM ${relation} WHERE ${common.join(' AND ')} ORDER BY ${seq} DESC,${id} ASC LIMIT ?`).all(...args) as
      Array<{ id: string; seq: number; room_id: string; room_name: string; title: string; preview: string; target: string }>
  const selected = rows.slice(0, input.limit)
  return { results: selected.map((row): RoomSearchHit => ({ kind: input.kind, id: row.id,
    roomId: row.room_id, roomName: row.room_name, title: row.title, preview: row.preview,
    ...(input.kind === 'members' ? { memberId: row.target } : input.kind === 'messages' ? { messageId: row.target }
      : input.kind === 'tasks' ? { taskId: row.target } : {}) })),
    nextCursor: rows.length > input.limit ? Buffer.from(JSON.stringify({ kind: input.kind,
      seq: selected.at(-1)!.seq, id: selected.at(-1)!.id })).toString('base64url') : undefined }
}

export function queryRoomRepositories(db: DatabaseSync): RoomRepositoryChoice[] {
  return db.prepare(`SELECT json_extract(repo.value,'$.canonicalRoot') AS canonicalRoot,
    MIN(json_extract(repo.value,'$.displayName')) AS displayName,COUNT(DISTINCT r.id) AS roomCount
    FROM room_documents r,json_each(r.document,'$.repositories') repo
    WHERE r.kind='room' AND r.archived=0 GROUP BY canonicalRoot ORDER BY canonicalRoot LIMIT 500`).all() as RoomRepositoryChoice[]
}

export function queryRoomRunSummary(db: DatabaseSync, raw: RoomRunSummaryQuery): RoomRunSummary {
  const input = RoomRunSummaryQuerySchema.parse(raw)
  const where = ["kind='room_run'", 'room_id=?']
  const args: Array<string | number> = [input.roomId]
  if (input.rootRequestId) { where.push("json_extract(document,'$.rootRequestId')=?"); args.push(input.rootRequestId) }
  if (input.since) { where.push("json_extract(document,'$.createdAt')>=?"); args.push(new Date(input.since).toISOString()) }
  const value = (field: string) => `json_extract(document,'$.${field}')`
  const count = (predicate: string) => `COALESCE(SUM(CASE WHEN ${predicate} THEN 1 ELSE 0 END),0)`
  const tokens = value('usage.totalTokens'), hasUsage = `typeof(${tokens}) IN ('integer','real')`
  const completeUsage = `${hasUsage} AND ${value('usageStatus')}='complete'`
  const partialUsage = `${hasUsage} AND COALESCE(${value('usageStatus')},'partial')!='complete'`
  const row = db.prepare(`SELECT COUNT(*) AS runs,
    ${count(`${value('phase')}='discussion'`)} AS responses,${count(`${value('phase')}='triage'`)} AS triages,
    ${count(completeUsage)} AS knownUsageRuns,${count(partialUsage)} AS partialUsageRuns,
    ${count(`NOT (${hasUsage})`)} AS unknownUsageRuns,
    SUM(CASE WHEN ${hasUsage} THEN ${tokens} END) AS knownTokens,
    SUM(${value('elapsedMs')}) AS knownElapsedMs,COUNT(${value('elapsedMs')}) AS knownDurationRuns,
    ${count("status='failed'")} AS failed,${count("status='cancelled'")} AS cancelled,
    ${count(`${value('outcome')}='stale'`)} AS stale,${count(`${value('outcome')}='duplicate'`)} AS duplicate,
    ${count(`${value('outcome')}='skipped'`)} AS skipped
    FROM room_documents WHERE ${where.join(' AND ')}`).get(...args) as Omit<RoomRunSummary, 'roomId' | 'rootRequestId' | 'budgetPauses'>
  const topics = db.prepare(`SELECT json_extract(document,'$.rootRequestId') AS rootRequestId,
    json_extract(document,'$.pauseReason') AS reason,
    MAX(0,32-COALESCE(json_extract(document,'$.responseCount'),0)) AS responsesRemaining,
    MAX(0,128-COALESCE(json_extract(document,'$.triageCount'),0)) AS triagesRemaining
    FROM room_documents WHERE kind='peer_topic' AND room_id=? AND status='paused'
    ${input.rootRequestId ? "AND json_extract(document,'$.rootRequestId')=?" : ''}
    ORDER BY seq DESC LIMIT 50`).all(input.roomId, ...(input.rootRequestId ? [input.rootRequestId] : [])) as RoomRunSummary['budgetPauses']
  return { ...row, roomId: input.roomId, rootRequestId: input.rootRequestId, budgetPauses: topics }
}
