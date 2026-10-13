import type { GmailAuthorization, GmailConversationStatus, GmailConversationBinding, GmailLocalModelStatus, GmailModelRecipient } from '@shared/gmail-api'
import { roomsRequest } from './rooms-client'

export function gmailBindingQuery(binding: GmailConversationBinding): string {
  const query = new URLSearchParams()
  if (typeof binding.threadId === 'string') query.set('threadId', binding.threadId)
  else if (typeof binding.roomId === 'string' && typeof binding.messageId === 'string') {
    query.set('roomId', binding.roomId); query.set('messageId', binding.messageId)
  } else throw new Error('A Gmail conversation binding is required')
  return query.toString()
}

function sharingRequest(binding: GmailConversationBinding, allowModelSharing: boolean,
  expectedRecipient?: GmailModelRecipient, expectedConsentId?: string) {
  if (allowModelSharing && (!expectedRecipient || !expectedConsentId)) {
    throw new Error('Refresh the Gmail recipient disclosure before granting model sharing')
  }
  return { ...binding, allowModelSharing,
    ...(allowModelSharing ? { expectedRecipient, expectedConsentId } : {}) }
}

export const gmailClient = {
  localStatus: (binding: GmailConversationBinding, signal?: AbortSignal) =>
    roomsRequest<GmailLocalModelStatus>(`/v1/gmail/local-model?${gmailBindingQuery(binding)}`, 'GET', undefined, signal),
  prepareLocal: (binding: GmailConversationBinding) =>
    roomsRequest<GmailLocalModelStatus>('/v1/gmail/local-model', 'POST', binding),
  status: (binding: GmailConversationBinding, signal?: AbortSignal) =>
    roomsRequest<GmailConversationStatus>(`/v1/gmail/status?${gmailBindingQuery(binding)}`, 'GET', undefined, signal),
  authorize: (binding: GmailConversationBinding, allowModelSharing: boolean, expectedRecipient?: GmailModelRecipient, expectedConsentId?: string) =>
    roomsRequest<GmailAuthorization>('/v1/gmail/authorize', 'POST', sharingRequest(binding, allowModelSharing, expectedRecipient, expectedConsentId)),
  poll: (binding: GmailConversationBinding, id: string, signal?: AbortSignal) =>
    roomsRequest<GmailAuthorization>(`/v1/gmail/authorization/${encodeURIComponent(id)}?${gmailBindingQuery(binding)}`, 'GET', undefined, signal),
  cancel: (binding: GmailConversationBinding, id: string) =>
    roomsRequest<GmailAuthorization>(`/v1/gmail/authorization/${encodeURIComponent(id)}?${gmailBindingQuery(binding)}`, 'DELETE'),
  sharing: (binding: GmailConversationBinding, allowModelSharing: boolean, expectedRecipient?: GmailModelRecipient, expectedConsentId?: string) =>
    roomsRequest<GmailConversationStatus>('/v1/gmail/sharing', 'PATCH', sharingRequest(binding, allowModelSharing, expectedRecipient, expectedConsentId)),
  disconnect: (binding: GmailConversationBinding, revoke: boolean) =>
    roomsRequest<GmailConversationStatus>('/v1/gmail/connection', 'DELETE', { ...binding, revoke }),
  continueTask: (threadId: string, sourceTurnId: string, toolCallId: string) =>
    roomsRequest('/v1/gmail/continue', 'POST', { threadId, sourceTurnId, toolCallId })
}
