export type PersonalAgentImRequest = {
  action: 'start' | 'poll' | 'cancel' | 'status' | 'disconnect'
  roomId: string
  cardId: string
  attemptId?: string
  isLark?: boolean
}
export type PersonalAgentImResult =
  | { status: 'requested' | 'pending' | 'cancelled' | 'disconnected' }
  | { status: 'qr'; attemptId: string; url: string; expiresAt: number; interval: number }
  | { status: 'connected'; connectionId: string }
  | { status: 'error'; message: string }
