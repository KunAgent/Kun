export type WeixinLocalSendRequest = {
  channelId: string
  conversationId: string
  text: string
  idempotencyKey: string
}

export type WeixinLocalSendAccepted = {
  status: 'accepted'
  messageId: string
  idempotencyKey: string
}

export type WeixinLocalSendRejected = {
  status: 'rejected'
  error: {
    code:
      | 'invalid_request'
      | 'unauthorized'
      | 'channel_not_found'
      | 'conversation_not_found'
      | 'channel_not_configured'
      | 'idempotency_conflict'
      | 'send_failed'
    message: string
  }
  idempotencyKey?: string
}

export type WeixinLocalSendResponse = WeixinLocalSendAccepted | WeixinLocalSendRejected
