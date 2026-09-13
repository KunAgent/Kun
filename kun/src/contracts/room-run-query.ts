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
  context?: { prompt?: string; attachmentIds?: string[] }
  availability: RoomRunAvailability
  eventsCursor: string
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
export type RoomRunListPage = { runs: RoomRunRecord[]; nextCursor?: string }
export type RoomMessageRunSource = { runId?: string; unavailableReason?: string }
export type RoomRunEvent = {
  kind: 'run.updated' | 'run.items_changed' | 'run.cursor' | 'run.reset'
  roomId: string
  runId: string
  cursor: string
}
