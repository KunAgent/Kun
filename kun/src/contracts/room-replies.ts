import type { RoomMessage } from './rooms.js'

export type RoomReplyPageInput = {
  roomId: string
  messageId: string
  beforeSeq?: number
  limit?: number
}

export type RoomReplyPage = {
  root: RoomMessage | null
  messages: RoomMessage[]
  total: number
  nextCursor?: string
  unavailableReason?: string
}
