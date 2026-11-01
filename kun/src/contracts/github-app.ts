import { z } from 'zod'

export const GitHubScopeSchema = z.string().regex(/^(?:room|thread):[A-Za-z0-9_-]{1,128}$/u)
export const GITHUB_SHARING_POLICY = 'configured-models-v1' as const
export const GITHUB_CALLBACK = 'http://127.0.0.1:42813/oauth/github/callback'
export const GitHubBindingSchema = z.union([
  z.object({ threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u) }).strict(),
  z.object({ roomId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
    messageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u) }).strict()
])
export type GitHubBinding = z.infer<typeof GitHubBindingSchema>
export type GitHubAuthorization = {
  id: string; status: 'pending' | 'connected' | 'cancelled' | 'expired' | 'failed'
  expiresAt: string; error?: string
}
/**
 * A login is either an account login or a conversation consent. Account logins carry no
 * conversation scope, so callers must never fabricate one to reach the account path.
 */
export type GitHubAuthorizationContext =
  | { readonly kind: 'account' }
  | { readonly kind: 'scope'; readonly scopeId: string }
export const GITHUB_ACCOUNT_CONTEXT: GitHubAuthorizationContext = { kind: 'account' }
export function githubScopeContext(scopeId: string): GitHubAuthorizationContext {
  return { kind: 'scope', scopeId: GitHubScopeSchema.parse(scopeId) }
}
export function sameGitHubAuthorizationContext(a: GitHubAuthorizationContext, b: GitHubAuthorizationContext): boolean {
  return a.kind === 'account' ? b.kind === 'account' : b.kind === 'scope' && a.scopeId === b.scopeId
}
export type GitHubConnectionStatus = {
  configured: boolean; connected: boolean; allowModelSharing: boolean
  reconnectRequired: boolean; login?: string; repositoryCount: number
  repositories: string[]; pendingAuthorization?: GitHubAuthorization
  pendingAccountAuthorization?: GitHubAuthorization
}
export function githubReady(status: GitHubConnectionStatus): boolean {
  return status.connected && status.allowModelSharing && status.repositoryCount > 0
}
