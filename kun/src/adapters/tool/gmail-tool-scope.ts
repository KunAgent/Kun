import type { ThreadStore } from '../../ports/thread-store.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { Room } from '../../contracts/rooms.js'
import { GmailError } from '../../gmail/ports.js'
import { GmailScopeIdSchema } from '../../contracts/gmail.js'
import { roomPeerStoreBinding } from '../../rooms/room-peer-tools.js'
import { assertGmailRoomNotMirrored } from '../../gmail/room-data-boundary.js'

const blockedIds = ['gmail', 'google_gmail', 'mcp:google_gmail', 'native:gmail']

/** Resolve only persisted host identity. Model arguments cannot select an account or scope. */
export async function gmailToolScope(threads: ThreadStore, context: ToolHostContext): Promise<string> {
  if (context.clientSurface !== 'gui' || context.imContext) {
    throw new GmailError('gmail_desktop_only', 'Gmail is currently available only from Kun’s desktop conversation')
  }
  if (context.abortSignal.aborted) throw new GmailError('cancelled', 'Gmail action was cancelled')
  const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
  const turn = thread?.turns.find((item) => item.id === context.turnId)
  if (!thread || thread.status === 'archived' || thread.status === 'deleted' ||
      !turn || turn.status !== 'running' || !context.activeToolCallId) {
    throw new GmailError('invalid_context', 'An active Kun conversation and tool call are required')
  }
  const scope = thread.roomContext
  if (thread.turns.some((item) => item.imContext || item.clientSurface === 'im')) {
    throw new GmailError('gmail_desktop_only', 'Use a separate desktop conversation for Gmail; this thread is linked to messaging')
  }
  if (context.blockedProviderIds?.some((id) => blockedIds.includes(id) && !(
    // Private Rooms automatically hide the legacy remote Gmail provider. That
    // rule does not disable native Gmail; explicitly saved Agent denies do.
    id === 'mcp:google_gmail' && scope?.kind === 'conversation' &&
    !scope.blockedProviderIds.some((blocked) => blockedIds.includes(blocked))
  ))) throw new GmailError('provider_blocked', 'Gmail is blocked for this Agent')
  if (!scope) return GmailScopeIdSchema.parse(`thread:${thread.id}`)
  if (context.roomAgent !== true || context.roomStepKind !== 'conversation' ||
      scope.kind !== 'conversation' || !scope.participantAgentId ||
      scope.blockedProviderIds.some((id) => blockedIds.includes(id))) {
    throw new GmailError('provider_blocked', 'Gmail is unavailable in this Agent conversation')
  }
  const store = roomPeerStoreBinding(threads)
  const room = await store?.get<Room>('room', scope.roomId)
  const member = room?.value.members.find((item) => item.id === scope.memberId)
  if (!room || room.value.archivedAt || room.value.conversationKind !== 'user_agent' ||
      !member?.enabled || member.removedAt || member.participantAgentId !== scope.participantAgentId) {
    throw new GmailError('invalid_context', 'The private Agent identity is no longer active')
  }
  await assertGmailRoomNotMirrored(store!, scope.roomId)
  return GmailScopeIdSchema.parse(`room:${scope.roomId}`)
}
