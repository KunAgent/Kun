import { z } from 'zod'

export const GmailScopeIdSchema = z.string().regex(/^(?:room|thread):[A-Za-z0-9_-]{1,128}$/u)
export const GmailAuthorizeInputSchema = z.object({
  scopeId: GmailScopeIdSchema,
  allowModelSharing: z.boolean()
}).strict()
export const GmailSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(1_000),
  maxResults: z.number().int().min(1).max(20).default(10)
}).strict()
export const GmailReadInputSchema = z.object({
  messageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u)
}).strict()
// Only unambiguous bare addresses: quoted names, comments and address groups are unsupported.
export const GmailMailboxSchema = z.email().trim().max(254)
export const GmailSendInputSchema = z.object({
  to: z.array(GmailMailboxSchema).min(1).max(20),
  cc: z.array(GmailMailboxSchema).max(20).optional(),
  bcc: z.array(GmailMailboxSchema).max(20).optional(),
  subject: z.string().max(998).refine((value) => !hasHeaderControl(value)),
  body: z.string().min(1).max(100_000)
}).strict()
export type GmailAuthorizeInput = z.infer<typeof GmailAuthorizeInputSchema>
export type GmailSearchInput = z.infer<typeof GmailSearchInputSchema>
export type GmailReadInput = z.infer<typeof GmailReadInputSchema>
export type GmailSendInput = z.infer<typeof GmailSendInputSchema>

export type GmailConnectionStatus = {
  configured: boolean
  connected: boolean
  reconnectRequired: boolean
  email?: string
  scopes: string[]
  allowModelSharing: boolean
}
export type GmailAuthorization = {
  id: string
  url: string
  status: 'pending' | 'connected' | 'cancelled' | 'expired' | 'failed'
  expiresAt: string
  error?: 'access_denied' | 'authorization_failed' | 'browser_unavailable' | 'scope_missing'
}
export type GmailMessageSummary = {
  id: string
  threadId?: string
  from: string
  to: string
  subject: string
  date: string
  snippet: string
  untrusted: true
}
export type GmailMessage = GmailMessageSummary & { body: string; truncated: boolean }
export type GmailSearchResult = {
  messages: GmailMessageSummary[]
  hasMore: boolean
  untrusted: true
}
export type GmailSendResult = { id: string; threadId?: string; status: 'sent' }

function hasHeaderControl(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}
