import type { ThreadStore } from '../../ports/thread-store.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { Room } from '../../contracts/rooms.js'
import { roomPeerStoreBinding } from '../../rooms/room-peer-tools.js'
import { GitHubAppError } from '../../github-app/client.js'
import { GitHubScopeSchema } from '../../contracts/github-app.js'

export const GITHUB_BLOCKED_IDS = ['github-app', 'github', 'mcp:github', 'native:github']
export async function githubToolScope(threads: ThreadStore, context: ToolHostContext): Promise<string> {
  if (context.clientSurface !== 'gui' || context.imContext || (context.harnessId ?? 'kun') !== 'kun') {
    throw new GitHubAppError('desktop_only', 'Connect GitHub in a native Kun desktop conversation')
  }
  context.abortSignal.throwIfAborted()
  const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
  const turn = thread?.turns.find((entry) => entry.id === context.turnId)
  if (!thread || thread.status === 'archived' || thread.status === 'deleted' || turn?.status !== 'running' ||
      !context.activeToolCallId || (turn.harnessId ?? thread.harnessId ?? 'kun') !== 'kun') {
    throw new GitHubAppError('invalid_context', 'An active Kun conversation is required')
  }
  if (context.blockedProviderIds?.some((id) => GITHUB_BLOCKED_IDS.includes(id))) {
    throw new GitHubAppError('provider_blocked', 'GitHub is blocked for this Agent')
  }
  const scope = thread.roomContext
  if (!scope) return GitHubScopeSchema.parse(`thread:${thread.id}`)
  if (!context.roomAgent || context.roomStepKind !== 'conversation' || scope.kind !== 'conversation' ||
      scope.blockedProviderIds.some((id) => GITHUB_BLOCKED_IDS.includes(id))) {
    throw new GitHubAppError('provider_blocked', 'GitHub requires a private Agent conversation')
  }
  const room = await roomPeerStoreBinding(threads)?.get<Room>('room', scope.roomId)
  const member = room?.value.members.find((entry) => entry.id === scope.memberId)
  if (!room || room.value.archivedAt || room.value.conversationKind !== 'user_agent' || !member?.enabled ||
      member.removedAt || !member.participantAgentId || member.participantAgentId !== scope.participantAgentId) {
    throw new GitHubAppError('invalid_context', 'The private Agent is no longer active')
  }
  return GitHubScopeSchema.parse(`room:${scope.roomId}`)
}
