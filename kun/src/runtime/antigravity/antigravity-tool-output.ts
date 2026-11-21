import { lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AcpToolOutput } from '../../contracts/acp-tool-output.js'

export const ANTIGRAVITY_SESSION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const TEXT_BYTES = 64 * 1024

/** Read just one length-delimited protobuf field, skipping unknown fields without decoding their contents. */
function field(bytes: Uint8Array | undefined, wanted: number): Uint8Array | undefined {
  if (!bytes) return
  let offset = 0
  const integer = (skip = false): number => {
    let value = 0
    for (let n = 0; n < (skip ? 10 : 5) && offset < bytes.length; n++) {
      const byte = bytes[offset++]!
      if (!skip) value += (byte & 127) * 2 ** (7 * n)
      if (byte < 128) return value
    }
    throw new Error('Unsupported native record')
  }
  while (offset < bytes.length) {
    const tag = integer(), wire = tag % 8
    if (tag < 8) return
    if (wire === 0) { integer(true); continue }
    const length = wire === 2 ? integer() : wire === 1 ? 8 : wire === 5 ? 4 : -1
    if (length < 0 || length > bytes.length - offset) return
    const start = offset
    offset += length
    if (wire === 2 && Math.floor(tag / 8) === wanted) return bytes.subarray(start, offset)
  }
}

type NativeRow = { metadata: Uint8Array; payload: Uint8Array | null; failure: Uint8Array | null }
type NativeTool = { sessionId: string; callId: string; name: string; failed: boolean }

/** Antigravity 1.5.x stores its generic tools (step 132) by the very same ACP
 * call ID. Never search other databases, infer results by tool order, read
 * planner responses, or run the tool again. Unknown formats remain unavailable. */
export function readAntigravityToolOutput({ sessionId, callId, name, failed }: NativeTool,
  directory = join(homedir(), '.gemini', 'antigravity-cli', 'conversations')): AcpToolOutput | null {
  if (!ANTIGRAVITY_SESSION_ID.test(sessionId) || !callId || callId.length > 1024 || !name || name.length > 1024) return null
  const path = join(directory, sessionId + '.db')
  let db: DatabaseSync | undefined
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.size > 256 * 1024 * 1024) return null // No unbounded metadata scans on the runtime thread.
    db = new DatabaseSync(path, { readOnly: true })
    db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; BEGIN')
    if (!db.prepare('SELECT 1 FROM trajectory_meta WHERE cascade_id = ?').get(sessionId)) return null
    const rows = db.prepare(`SELECT metadata,
        CASE WHEN length(step_payload) <= 4194304 THEN step_payload END AS payload,
        CASE WHEN length(error_details) <= 262144 THEN error_details END AS failure
      FROM steps WHERE step_type = 132 AND step_format = 0 AND status = ?
        AND length(metadata) <= 262144 AND instr(metadata, ?) > 0 LIMIT 3`)
      .all(failed ? 7 : 3, Buffer.from(callId)) as NativeRow[]
    const utf8 = new TextDecoder('utf-8', { fatal: true })
    const matches = rows.filter(row => {
      const identity = field(row.metadata, 4)
      return utf8.decode(field(identity, 1)) === callId && utf8.decode(field(identity, 2)) === name
    })
    if (matches.length !== 1 || rows.length === 3) return null
    const row = matches[0]!
    // Generic tool -> result -> displayed text. Failed steps can instead carry a public error message.
    const raw = field(field(field(row.payload ?? undefined, 140), 2), 1)
    const bytes = raw?.length ? raw : failed ? field(row.failure ?? undefined, 2) : undefined
    if (!bytes?.length) return null
    const truncated = bytes.length > TEXT_BYTES
    const text = utf8.decode(bytes.subarray(0, TEXT_BYTES), { stream: truncated })
      .replace(/^Created At: [\dT:.+Z-]+\r?\nCompleted At: [\dT:.+Z-]+\r?\n/u, '')
    return text.trim() ? { text, truncated } : null
  } catch {
    return null // Missing, busy, outdated or malformed native stores must not affect the conversation.
  } finally { db?.close() }
}
