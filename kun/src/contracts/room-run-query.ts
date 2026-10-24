import type { MemoryInjectionReceipt } from '../memory/memory-injection-receipt.js'
import type { TurnItem } from './items.js'
import type { RoomMessage } from './rooms.js'
import type { RoomRunRecord } from './room-runs.js'

export type RoomRunAvailability = {
  status: 'available' | 'pending' | 'no_session' | 'missing_thread' | 'missing_turn' |
    'scope_mismatch' | 'history_unavailable'
  reason?: string
}
export type RoomRunDetail = {
  run: RoomRunRecord
  trigger?: RoomMessage
  context?: { prompt?: string; attachmentIds?: string[]; memoryIds?: string[]; memoryReceipt?: MemoryInjectionReceipt }
  availability: RoomRunAvailability
  eventsCursor: string
  /** Authorized source workspace, present only after exact run/thread validation. */
  workspaceRoot?: string
}
export type RoomRunContentPage = {
  itemId: string
  field: 'text' | 'arguments' | 'output' | 'details'
  text: string
  offset: number
  nextOffset?: number
  totalChars: number
}
export type RoomRunItemsPage = {
  items: TurnItem[]
  nextCursor?: string
  hasMore: boolean
  itemBytes: number
  content?: RoomRunContentPage
  availability: RoomRunAvailability
  eventsCursor: string
}
export type RoomRunStepStatus = 'running' | 'done' | 'failed' | 'cancelled'
/** One unit of visible work in a run: a tool call, or an approval the user decided. No outputs. */
export type RoomRunStep =
  | { id: string; kind: 'tool'; toolName: string; toolKind: 'tool_call' | 'command_execution' | 'file_change'
      label?: string; target?: string; status: RoomRunStepStatus; startedAt: string; endedAt?: string }
  | { id: string; kind: 'approval'; toolName: string; label: string
      status: 'pending' | 'allowed' | 'denied' | 'expired'; startedAt: string; endedAt?: string }
export type RoomRunSteps = {
  run: Pick<RoomRunRecord, 'id' | 'status' | 'startedAt' | 'endedAt' | 'elapsedMs' | 'error'>
  steps: RoomRunStep[]
  /** The turn had more items than one bounded read returns; its earliest steps are missing. */
  truncated: boolean
  availability: RoomRunAvailability
}
export type RoomRunListPage = { runs: RoomRunRecord[]; nextCursor?: string }
export type RoomMessageRunSource = { runId?: string; unavailableReason?: string }
export type RoomRunEvent = {
  kind: 'run.updated' | 'run.items_changed' | 'run.cursor' | 'run.reset'
  roomId: string
  runId: string
  cursor: string
  message?: RoomMessage | null
}
