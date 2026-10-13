/** Public Gmail views contain no OAuth credentials or email HTML. */
export type {
  GmailAuthorization,
  GmailConnectionStatus,
  GmailMessage,
  GmailMessageSummary,
  GmailSearchResult,
  GmailSendResult
} from '../../kun/src/contracts/gmail'

export type GmailConversationBinding =
  | { roomId: string; messageId: string; threadId?: never }
  | { threadId: string; roomId?: never; messageId?: never }

export type GmailModelRecipient = 'configured-models'

export type GmailConversationStatus = import('../../kun/src/contracts/gmail').GmailConnectionStatus & {
  modelProviderName?: string
  modelSharingAvailable?: boolean
  modelSharingReason?: string
  modelProcessingRecipient?: GmailModelRecipient
  modelProcessingEndpoint?: string
  modelProcessingConsentId?: string
  modelSharingRecipient?: GmailModelRecipient
}

export type GmailLocalModelStatus = {
  installed: boolean
  running: boolean
  ready: boolean
  preparing: boolean
  model: string
  error?: string
}
