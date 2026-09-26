import type { BashSessionEvent } from '../contracts/events.js'
import type { TurnItem } from '../contracts/items.js'
import type { SessionStore } from '../ports/session-store.js'
import { roomTurnItems } from './room-item-history.js'

type EvidenceItem = { item: TurnItem; order: number }
export type RoomEvidenceHistory = { items: EvidenceItem[]; background: Array<{ event: BashSessionEvent; order: number }> }
const COMMAND_FIELDS = ['command', 'cwd', 'exit_code', 'exitCode', 'session_id', 'status', 'finished_at',
  'output_file', 'full_output_path', 'output_truncated', 'truncation', 'sessions']

function compactEvidence(item: TurnItem): TurnItem {
  if (item.kind !== 'tool_result' || item.toolKind !== 'command_execution' || !item.output || typeof item.output !== 'object') return item
  const output = item.output as Record<string, unknown>
  // Logs stay in the canonical source; retaining just exact execution metadata avoids a second unbounded log in memory.
  return { ...item, output: Object.fromEntries(COMMAND_FIELDS.filter((key) => key in output).map((key) => [key, output[key]])) }
}

/** Runtime events preserve exact commands/results even after public previews or model-history compaction. */
export async function roomEvidenceHistory(sessions: SessionStore, threadId: string, turnId: string): Promise<RoomEvidenceHistory> {
  const items = new Map<string, EvidenceItem>()
  const background = new Map<string, { event: BashSessionEvent; order: number }>()
  if (sessions.iterateEventsSince) {
    for await (const event of sessions.iterateEventsSince(threadId, 0)) {
      if (event.threadId !== threadId || event.turnId !== turnId) continue
      const order = Number.MAX_SAFE_INTEGER - event.seq
      if ('item' in event && (event.item.kind === 'tool_call' || event.item.kind === 'tool_result')) {
        items.set(event.item.id, { item: compactEvidence(event.item), order: event.item.kind === 'tool_call' ? items.get(event.item.id)?.order ?? order : order })
      }
      if (event.kind === 'bash_session_started' || event.kind === 'bash_session_updated' || event.kind === 'bash_session_completed') {
        background.set(event.sessionId, { event: { ...event, output: '' }, order })
      }
    }
  }
  if (!items.size) {
    let order = 0
    for await (const item of roomTurnItems(sessions, threadId, turnId)) {
      order += 1
      if (item.kind === 'tool_call' || item.kind === 'tool_result') items.set(item.id, { item: compactEvidence(item), order })
    }
  }
  return { items: [...items.values()].sort((a, b) => a.order - b.order), background: [...background.values()] }
}

/** Rehydrate only the selected check's output after the metadata scan. */
export async function roomEvidenceOutput(sessions: SessionStore, threadId: string, turnId: string,
  resultId: string, order: number, eventSeq?: number): Promise<Record<string, unknown>> {
  const sequence = eventSeq ?? (order > 1_000_000_000 ? Number.MAX_SAFE_INTEGER - order : undefined)
  try {
    if (sequence !== undefined && sessions.iterateEventsSince) {
      for await (const event of sessions.iterateEventsSince(threadId, Math.max(0, sequence - 1))) {
        if (event.seq > sequence) break
        if (event.threadId !== threadId || event.turnId !== turnId) continue
        if (eventSeq !== undefined && 'output' in event && typeof event.output === 'string') return { output: event.output }
        if ('item' in event && event.item.id === resultId && event.item.kind === 'tool_result' &&
          typeof event.item.output === 'object' && event.item.output) return event.item.output as Record<string, unknown>
      }
    }
    for await (const item of roomTurnItems(sessions, threadId, turnId)) {
      if (item.id === resultId && item.kind === 'tool_result' && typeof item.output === 'object' && item.output) return item.output as Record<string, unknown>
    }
  } catch { /* A missing output must not change the recorded command exit status. */ }
  return { _roomOutputUnavailable: true }
}
