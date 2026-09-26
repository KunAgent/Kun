import type { DatabaseSync } from 'node:sqlite'
import type { RoomRequestOutcome } from '../contracts/rooms-product.js'
import type { RoomOutcomeQuery } from './room-store.js'

export function initializeRoomProjections(db: DatabaseSync) {
  db.exec("CREATE INDEX IF NOT EXISTS room_review_delivery ON room_documents(room_id,task_id,json_extract(document,'$.deliveryId'),seq) WHERE kind='review';")
  db.exec("CREATE INDEX IF NOT EXISTS room_request_status ON room_documents(room_id,status,seq) WHERE kind='request';")
  db.exec("CREATE TABLE IF NOT EXISTS room_projection_state (id INTEGER PRIMARY KEY, cursor INTEGER NOT NULL, complete INTEGER NOT NULL);")
  db.exec("INSERT OR IGNORE INTO room_projection_state VALUES(1,0,0);")
  db.exec("CREATE TABLE IF NOT EXISTS room_task_projection (task_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, request_id TEXT NOT NULL, title TEXT NOT NULL, repository_id TEXT NOT NULL, status TEXT NOT NULL, delivery TEXT NOT NULL, accepted TEXT NOT NULL);")
  db.exec("CREATE INDEX IF NOT EXISTS room_task_projection_request ON room_task_projection(request_id,task_id);")
  db.exec("CREATE TABLE IF NOT EXISTS room_request_projection (request_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, revision INTEGER NOT NULL, total INTEGER NOT NULL, counts TEXT NOT NULL);")
  if (!db.prepare("SELECT 1 FROM room_documents WHERE kind='task' LIMIT 1").get()) db.exec('UPDATE room_projection_state SET complete=1 WHERE id=1')
}
type TaskRow = { task_id: string; room_id: string; request_id: string; title: string; repository_id: string; status: string; delivery: string; accepted: string }
type ProjectionRow = { request_id: string; room_id: string; revision: number; total: number; counts: string }
function applyCount(db: DatabaseSync, task: TaskRow, delta: number) {
  const old = db.prepare('SELECT * FROM room_request_projection WHERE request_id=?').get(task.request_id) as ProjectionRow | undefined
  const counts = JSON.parse(old?.counts ?? '{}') as Record<string, number>
  counts[task.status] = Math.max(0, (counts[task.status] ?? 0) + delta)
  db.prepare('INSERT INTO room_request_projection(request_id,room_id,revision,total,counts) VALUES(?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET revision=excluded.revision,total=excluded.total,counts=excluded.counts')
    .run(task.request_id, task.room_id, (old?.revision ?? 0) + 1, Math.max(0, (old?.total ?? 0) + delta), JSON.stringify(counts))
}
export function projectRoomTask(db: DatabaseSync, taskId: string, roomId: string, value: unknown) {
  const task = (value as { task?: Record<string, unknown> })?.task
  if (!task || typeof task.requestId !== 'string') return
  const next: TaskRow = { task_id: taskId, room_id: roomId, request_id: task.requestId,
    title: String(task.title ?? ''), repository_id: String(task.repositoryId ?? ''),
    status: String(task.status ?? ''), delivery: String(task.latestDeliveryId ?? ''), accepted: String(task.acceptedDeliveryId ?? '') }
  const old = db.prepare('SELECT * FROM room_task_projection WHERE task_id=?').get(taskId) as TaskRow | undefined
  if (old && Object.keys(next).every((key) => old[key as keyof TaskRow] === next[key as keyof TaskRow])) return
  if (old) applyCount(db, old, -1)
  applyCount(db, next, 1)
  db.prepare('INSERT INTO room_task_projection VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET room_id=excluded.room_id,request_id=excluded.request_id,title=excluded.title,repository_id=excluded.repository_id,status=excluded.status,delivery=excluded.delivery,accepted=excluded.accepted')
    .run(next.task_id, next.room_id, next.request_id, next.title, next.repository_id, next.status, next.delivery, next.accepted)
}
export function backfillRoomProjections(db: DatabaseSync) {
  const state = db.prepare('SELECT cursor,complete FROM room_projection_state WHERE id=1').get()!
  if (state.complete === 1) return true
  const rows = db.prepare("SELECT id,room_id,seq,document FROM room_documents WHERE kind='task' AND seq>? ORDER BY seq LIMIT 128").all(Number(state.cursor))
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const row of rows) projectRoomTask(db, String(row.id), String(row.room_id), JSON.parse(String(row.document)))
    db.prepare('UPDATE room_projection_state SET cursor=?,complete=? WHERE id=1').run(rows.at(-1)?.seq ?? state.cursor, rows.length < 128 ? 1 : 0)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return rows.length < 128
}
export function queryRoomOutcomes(db: DatabaseSync, input: RoomOutcomeQuery) {
  const initializing = db.prepare('SELECT complete FROM room_projection_state WHERE id=1').get()?.complete !== 1
  const clauses = ['p.total>0']
  const args: Array<string | number> = []
  if (input.roomId) { clauses.push('p.room_id=?'); args.push(input.roomId) }
  if (input.requestIds) {
    if (!input.requestIds.length) return { outcomes: [], initializing }
    clauses.push('p.request_id IN (' + input.requestIds.map(() => '?').join(',') + ')')
    args.push(...input.requestIds)
  }
  if (input.pendingOnly) clauses.push("NOT EXISTS (SELECT 1 FROM room_documents d WHERE d.kind='outcome' AND d.id=p.request_id AND json_extract(d.document,'$.revision')=CAST(p.revision AS TEXT))")
  args.push(input.limit ?? 100)
  const rows = db.prepare('SELECT p.* FROM room_request_projection p WHERE ' + clauses.join(' AND ') + ' ORDER BY p.request_id LIMIT ?').all(...args) as ProjectionRow[]
  const outcomes: RoomRequestOutcome[] = rows.map((row) => {
    const counts = JSON.parse(row.counts) as Record<string, number>
    const sum = (...statuses: string[]) => statuses.reduce((total, status) => total + (counts[status] ?? 0), 0)
    const completed = sum('completed'), delivered = sum('completed', 'awaiting_acceptance')
    const failed = sum('failed', 'cancelled'), active = sum('queued', 'running', 'waiting_dependency', 'stopping')
    const status: RoomRequestOutcome['status'] = active ? 'running' : sum('needs_input', 'needs_approval', 'recovery_required') ? 'needs_attention' :
      completed === row.total ? 'completed' : delivered === row.total ? 'awaiting_acceptance' :
        delivered && failed ? 'partial' : sum('cancelled') === row.total ? 'cancelled' : 'failed'
    const preview = db.prepare('SELECT task_id,title,repository_id,status FROM room_task_projection WHERE request_id=? ORDER BY task_id LIMIT 20').all(row.request_id)
    return { requestId: row.request_id, roomId: row.room_id, status, total: row.total, completed, delivered, failed, active,
      taskIds: preview.map((task) => String(task.task_id)), tasksTruncated: row.total > preview.length,
      summary: preview.map((task) => task.title + ' [' + task.repository_id + ']: ' + task.status).join('\n') +
        (row.total > preview.length ? '\n… ' + (row.total - preview.length) + ' more tasks' : ''),
      revision: String(row.revision) }
  })
  return { outcomes, initializing }
}
