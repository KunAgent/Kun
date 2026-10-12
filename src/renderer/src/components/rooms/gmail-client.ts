import type { GmailAuthorization, GmailConversationStatus, GmailConversationBinding, GmailLocalModelStatus } from '@shared/gmail-api'
import { roomsRequest } from './rooms-client'

export function gmailBindingQuery(binding: GmailConversationBinding): string {
  const query = new URLSearchParams()
  if (typeof binding.threadId === 'string') query.set('threadId', binding.threadId)
  else if (typeof binding.roomId === 'string' && typeof binding.messageId === 'string') {
    query.set('roomId', binding.roomId); query.set('messageId', binding.messageId)
  } else throw new Error('A Gmail conversation binding is required')
  return query.toString()
}

export const gmailClient = {
  localStatus: (binding: GmailConversationBinding, signal?: AbortSignal) =>
    roomsRequest<GmailLocalModelStatus>(`/v1/gmail/local-model?${gmailBindingQuery(binding)}`, 'GET', undefined, signal),
  prepareLocal: (binding: GmailConversationBinding) =>
    roomsRequest<GmailLocalModelStatus>('/v1/gmail/local-model', 'POST', binding),
  status: (binding: GmailConversationBinding, signal?: AbortSignal) =>
    roomsRequest<GmailConversationStatus>(`/v1/gmail/status?${gmailBindingQuery(binding)}`, 'GET', undefined, signal),
  authorize: (binding: GmailConversationBinding, allowModelSharing: boolean) =>
    roomsRequest<GmailAuthorization>('/v1/gmail/authorize', 'POST', { ...binding, allowModelSharing }),
  poll: (binding: GmailConversationBinding, id: string, signal?: AbortSignal) =>
    roomsRequest<GmailAuthorization>(`/v1/gmail/authorization/${encodeURIComponent(id)}?${gmailBindingQuery(binding)}`, 'GET', undefined, signal),
  cancel: (binding: GmailConversationBinding, id: string) =>
    roomsRequest<GmailAuthorization>(`/v1/gmail/authorization/${encodeURIComponent(id)}?${gmailBindingQuery(binding)}`, 'DELETE'),
  sharing: (binding: GmailConversationBinding, allowModelSharing: boolean) =>
    roomsRequest<GmailConversationStatus>('/v1/gmail/sharing', 'PATCH', { ...binding, allowModelSharing }),
  disconnect: (binding: GmailConversationBinding, revoke: boolean) =>
    roomsRequest<GmailConversationStatus>('/v1/gmail/connection', 'DELETE', { ...binding, revoke }),
  continueTask: (threadId: string, sourceTurnId: string, toolCallId: string) =>
    roomsRequest('/v1/gmail/continue', 'POST', { threadId, sourceTurnId, toolCallId })
}
