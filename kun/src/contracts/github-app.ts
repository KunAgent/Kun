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
export type GitHubConnectionStatus = {
  configured: boolean; connected: boolean; allowModelSharing: boolean
  reconnectRequired: boolean; login?: string; repositoryCount: number
  repositories: string[]; pendingAuthorization?: GitHubAuthorization
}
export function githubReady(status: GitHubConnectionStatus): boolean {
  return status.connected && status.allowModelSharing && status.repositoryCount > 0
}
