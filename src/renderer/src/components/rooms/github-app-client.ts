import type { GitHubBinding, GitHubAuthorization, GitHubConnectionStatus } from '@shared/github-app-api'
import { roomsRequest } from './rooms-client'

export function githubBindingQuery(binding: GitHubBinding): string {
  return new URLSearchParams('threadId' in binding ? { threadId: binding.threadId }
    : { roomId: binding.roomId, messageId: binding.messageId }).toString()
}
const permission = (binding: GitHubBinding, allowModelSharing = true) => ({ binding, allowModelSharing,
  ...(allowModelSharing ? { sharingPolicy: 'configured-models-v1' } : {}) })
export const githubAppClient = {
  status: (binding: GitHubBinding, signal?: AbortSignal) =>
    roomsRequest<GitHubConnectionStatus>(`/v1/github/status?${githubBindingQuery(binding)}`, 'GET', undefined, signal),
  authorize: (binding: GitHubBinding) =>
    roomsRequest<GitHubAuthorization>('/v1/github/authorize', 'POST', permission(binding)),
  poll: (binding: GitHubBinding, id: string, signal?: AbortSignal) =>
    roomsRequest<GitHubAuthorization>(`/v1/github/authorization/${encodeURIComponent(id)}?${githubBindingQuery(binding)}`, 'GET', undefined, signal),
  cancel: (binding: GitHubBinding, id: string) =>
    roomsRequest<GitHubAuthorization>(`/v1/github/authorization/${encodeURIComponent(id)}?${githubBindingQuery(binding)}`, 'DELETE'),
  sharing: (binding: GitHubBinding, allow: boolean) =>
    roomsRequest<GitHubConnectionStatus>('/v1/github/sharing', 'PATCH', permission(binding, allow)),
  disconnect: (binding: GitHubBinding) =>
    roomsRequest<GitHubConnectionStatus>('/v1/github/connection', 'DELETE', { binding }),
  repositories: (binding: GitHubBinding) => roomsRequest('/v1/github/repositories', 'POST', { binding }),
  continueTask: (threadId: string, sourceTurnId: string, toolCallId: string) =>
    roomsRequest<{ pending?: boolean }>('/v1/github/continue', 'POST', { threadId, sourceTurnId, toolCallId })
}
