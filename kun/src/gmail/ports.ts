import type { SecretEncryptor } from '../security/secret-store.js'
import type {
  GmailAuthorization, GmailAuthorizeInput, GmailModelRecipientBinding, GmailConnectionStatus, GmailMessage,
  GmailReadInput, GmailSearchInput, GmailSearchResult, GmailSendInput, GmailSendResult
} from '../contracts/gmail.js'

export interface GmailServicePort {
  initialize(): Promise<void>
  status(scopeId?: string, recipient?: GmailModelRecipientBinding): Promise<GmailConnectionStatus>
  /** Host-only synchronous revision fence; capture before awaiting consent status. */
  captureModelSharingFence(scopeId: string): () => void
  hasGoogleData(scopeId: string): Promise<boolean>
  /** Host-only inherited-history classification; this never grants Gmail access. */
  markGoogleData(scopeId: string): Promise<void>
  startAuthorize(input: GmailAuthorizeInput): Promise<GmailAuthorization>
  pollAuthorization(id: string, scopeId?: string): Promise<GmailAuthorization>
  cancelAuthorization(id: string, scopeId?: string): Promise<GmailAuthorization>
  disconnect(input: { revoke: boolean }): Promise<void>
  setModelSharing(scopeId: string, allow: boolean, recipient?: GmailModelRecipientBinding): Promise<GmailConnectionStatus>
  search(input: GmailSearchInput, scopeId: string): Promise<GmailSearchResult>
  read(input: GmailReadInput, scopeId: string): Promise<GmailMessage>
  send(input: GmailSendInput, scopeId: string, operationId: string, expectedSenderEmail?: string): Promise<GmailSendResult>
  dispose(): Promise<void>
}

export type NativeGmailOptions = {
  dataDir: string
  encryptor: SecretEncryptor
  clientId?: string
  /** Optional installed-app identifier from Google credentials, never a user token. */
  clientSecret?: string
  /** Production composition requires the Google Desktop client configuration. */
  requireClientSecret?: boolean
  fetchImpl?: typeof fetch
  openExternal: (url: string) => Promise<void>
  /** Host checks the protected local storage boundary before reading or granting Gmail access. */
  assertDataProtection?: () => Promise<void>
  now?: () => number
}

export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
export const GMAIL_SCOPES = [GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE] as const
export const KUN_GMAIL_CLIENT_ID =
  '990070335975-u7j7e7ja3m3ppaf5cr54p0cee5a5pg2f.apps.googleusercontent.com'

export class GmailError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'GmailError'
  }
}
