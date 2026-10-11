import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

export const RoomMemoryErasure = z.object({
  preserveOperationId: z.string().min(1).max(256).optional(),
  memoryIds: z.array(z.string().min(1).max(256)).min(1).max(1000)
}).strict()
export type RoomMemoryErasure = z.infer<typeof RoomMemoryErasure>

function referencesMemory(value: unknown, ids: Set<string>): boolean {
  if (Array.isArray(value)) return value.some((item) => referencesMemory(item, ids))
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) =>
    ['id', 'memoryId', 'targetId', 'supersedes', 'replacementMemoryId', 'previousMemoryId'].includes(key) &&
      typeof child === 'string' && ids.has(child) ||
    key === 'sourceMemoryIds' && Array.isArray(child) && child.some((id) => ids.has(String(id))) ||
    referencesMemory(child, ids))
}

function scrubResult(value: unknown, ids: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => scrubResult(item, ids))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (typeof record.id === 'string' && ids.has(record.id) && typeof record.content === 'string') {
    return { id: record.id, erased: true }
  }
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, scrubResult(child, ids)]))
}

/** Only memory-specific derived state is scrubbed. Conversation/context archives remain intact. */
export function eraseRoomMemoryProjections(db: DatabaseSync, raw: RoomMemoryErasure): { scrubbed: number } {
  const input = RoomMemoryErasure.parse(raw), ids = new Set(input.memoryIds)
  let scrubbed = 0
  db.exec('PRAGMA secure_delete = ON; BEGIN IMMEDIATE')
  try {
    let documentCursor = 0
    const changedJobs = new Set<string>()
    while (true) {
      const rows = db.prepare(`SELECT seq,kind,id,document FROM room_documents WHERE seq>? AND
        (kind='agent_memory_job' OR (kind='room_run' AND json_extract(document,'$.phase')='memory'))
        ORDER BY seq LIMIT 100`).all(documentCursor) as Array<{ seq: number; kind: string; id: string; document: string }>
      for (const row of rows) {
        if (row.id === input.preserveOperationId) continue
        const value = JSON.parse(row.document) as Record<string, unknown>
        if (!referencesMemory(value, ids)) continue
        changedJobs.add(row.id)
        const next = { ...value, snapshot: undefined, candidate: undefined,
          input: row.kind === 'room_run' ? '[Erased memory input]' : undefined,
          ...(row.kind === 'agent_memory_job' ? { status: value.phase === 'capture' ? 'cancelled' : 'skipped', reason: 'memory_erased' } : {}),
          ...(value.phase === 'edit' ? { input: undefined, status: 'completed', erased: true } : {}) }
        db.prepare('UPDATE room_documents SET document=?,revision=revision+1 WHERE kind=? AND id=?')
          .run(JSON.stringify(next), row.kind, row.id)
        scrubbed += 1
      }
      if (rows.length < 100) break
      documentCursor = rows.at(-1)!.seq
    }
    // Request IDs and fingerprints survive: old retries stay terminal without retaining snapshots.
    let receiptCursor = 0
    while (true) {
      const receipts = db.prepare('SELECT rowid,id,result,events FROM room_requests WHERE rowid>? ORDER BY rowid LIMIT 100')
        .all(receiptCursor) as Array<{ rowid: number; id: string; result: string; events: string }>
      for (const receipt of receipts) {
        const result: unknown = JSON.parse(receipt.result), events: unknown = JSON.parse(receipt.events)
        if (!referencesMemory(result, ids) && !referencesMemory(events, ids) && !changedJobs.has(receipt.id)) continue
        db.prepare('UPDATE room_requests SET result=?,events=? WHERE id=?').run(
          JSON.stringify(referencesMemory(result, ids) ? { erased: true, affectedIds: input.memoryIds } : scrubResult(result, ids)),
          JSON.stringify(scrubResult(events, ids)), receipt.id)
        scrubbed += 1
      }
      if (receipts.length < 100) break
      receiptCursor = receipts.at(-1)!.rowid
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  const checkpoint = () => {
    const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all() as Array<{ busy?: number }>
    if (result.some((row) => row.busy !== 0)) throw new Error('memory erasure checkpoint is busy; retry required')
  }
  checkpoint(); db.exec('VACUUM'); checkpoint()
  return { scrubbed }
}
