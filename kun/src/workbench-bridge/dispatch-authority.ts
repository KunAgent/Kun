import { defaultAgentExecutionPolicy } from '../agents/agent-permission-snapshot.js'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import { kunToolPermissionModeFromSettings, type KunToolPermissionSettings } from '../contracts/policy.js'
import type { Room } from '../contracts/rooms.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { WorkbenchBridge } from './bridge.js'

const rank = { 'ask-for-approval': 0, 'approve-for-me': 1, 'full-access': 2 }
const sandboxRank = { 'read-only': 0, 'workspace-write': 1, 'external-sandbox': 1, 'danger-full-access': 2 }

/** Preserve the exact accepted policy, including restrictive legacy combinations. */
export function sourceDispatchAuthority(thread: ThreadRecord, turn: Turn): KunToolPermissionSettings {
  return { approvalPolicy: turn.approvalPolicy ?? thread.approvalPolicy,
    sandboxMode: turn.sandboxMode ?? thread.sandboxMode,
    approvalReviewer: turn.approvalReviewer ?? thread.approvalReviewer ?? 'user' }
}

/** Live room/profile limits can narrow an accepted source but can never widen it. */
export async function effectiveDispatchAuthority(bridge: WorkbenchBridge, roomId: string, memberId: string,
  inherited: KunToolPermissionSettings): Promise<KunToolPermissionSettings> {
  const room = (await bridge.store.get<Room>('room', roomId))?.value
  const member = room?.members.find((entry) => entry.id === memberId)
  const agent = member?.participantAgentId
    ? (await bridge.store.get<AgentIdentity>('agent_identity', member.participantAgentId))?.value : undefined
  if (!room || room.archivedAt || !member?.enabled || member.removedAt || !agent || agent.archivedAt) {
    throw new Error('The source Agent conversation is no longer available')
  }
  const readOnly = member.presetSnapshot?.toolPolicy === 'readOnly' ||
    bridge.deps.profiles()[member.presetId]?.toolPolicy === 'readOnly'
  const live = room.privateExecutionPolicy ?? defaultAgentExecutionPolicy()
  const directoryLimited = agent.allowedRepositoryRoots !== undefined
  const livePolicy = directoryLimited ? defaultAgentExecutionPolicy() : live
  const authority = rank[kunToolPermissionModeFromSettings(inherited)] <= rank[kunToolPermissionModeFromSettings(livePolicy)]
    ? { ...inherited } : { ...livePolicy }
  if (sandboxRank[inherited.sandboxMode] < sandboxRank[authority.sandboxMode]) authority.sandboxMode = inherited.sandboxMode
  if (readOnly) authority.sandboxMode = 'read-only'
  return authority
}
