import { DatabaseSync } from 'node:sqlite'
import type { AcpToolOutput } from '../../contracts/acp-tool-output.js'
import { devinSessionDatabasePath } from './devin-session-usage.js'

const TEXT_BYTES = 64 * 1024
const WINDOW_SECONDS = 15 * 60
const MAX_ROWS = 2_048
const MAX_SCAN_BYTES = 16 * 1024 * 1024

type RecordedCall = { sessionId: string; callId: string; finishedAt: string }

/** Devin can finish a search over ACP with no content while retaining the
 * actual response in its session journal. Only return the exact tool message;
 * neither prompts, model replies nor message metadata are display evidence. */
export function readDevinToolOutput({ sessionId, callId, finishedAt }: RecordedCall,
  dbPath = devinSessionDatabasePath('devin', process.env)): AcpToolOutput | null {
  const time = Math.floor(Date.parse(finishedAt) / 1_000)
  if (!dbPath || !sessionId || sessionId.length > 1_024 || !callId || callId.length > 1_024 || !Number.isFinite(time)) return null
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 50; BEGIN')
    // This is one shared, potentially multi-GB database. Require its session
    // index. Time narrows the scan, never identifies a call. Bound row and
    // byte counts using SQLite metadata before evaluating any message JSON.
    const scope = 'FROM message_nodes INDEXED BY idx_message_nodes_session WHERE session_id = ? AND created_at BETWEEN ? AND ?'
    const range = [sessionId, time - WINDOW_SECONDS, time + WINDOW_SECONDS] as const
    const budget = db.prepare(`SELECT count(*) AS rows, sum(size) AS bytes FROM (
      SELECT octet_length(chat_message) AS size ${scope} LIMIT ${MAX_ROWS + 1})`).get(...range)
    if (!budget || !budget.rows || Number(budget.rows) > MAX_ROWS || Number(budget.bytes) > MAX_SCAN_BYTES) return null
    const rows = db.prepare(`SELECT CASE WHEN json_type(chat_message, '$.content') = 'text' THEN
      substr(CAST(json_extract(chat_message, '$.content') AS BLOB), 1, ?) END AS body ${scope}
      AND json_extract(chat_message, '$.role') = 'tool' AND json_extract(chat_message, '$.tool_call_id') = ? LIMIT 2`)
      .all(TEXT_BYTES + 1, ...range, callId)
    const body = rows.length === 1 ? rows[0]?.body : undefined
    if (!(body instanceof Uint8Array) || !body.length) return null
    const truncated = body.length > TEXT_BYTES
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, TEXT_BYTES), { stream: truncated })
    return text.trim() ? { text, truncated } : null
  } catch { return null } finally { db?.close() }
}
