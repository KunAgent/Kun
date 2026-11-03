import type { RoomCommitChange } from '../../rooms/room-commit-signal.js'
import type { DirectoryResource } from '@kun/remote-protocol'

export type { DirectoryResource } from '@kun/remote-protocol'
const AGENT_DOCUMENTS = new Set(['agent_identity', 'agent_lifecycle', 'agent_features', 'agent_mapping',
  'agent_conversation_cursor', 'room_wardrobe'])
const CONVERSATION_DOCUMENTS = new Set(['room', 'message', 'request', 'task', 'integration', 'read_state',
  'room_preference', 'room_avatar', 'peer_topic', 'peer_member', 'peer_inbox'])

/** Receipt/history bookkeeping is deliberately excluded: a list read must not invalidate itself. */
export function roomDirectoryChanges(change?: RoomCommitChange): DirectoryResource[] {
  if (!change) return []
  const conversations = change.documents.some((kind) => CONVERSATION_DOCUMENTS.has(kind)) ||
    change.events.some((kind) => /^(room|message|request|task|integration|peer)\./.test(kind))
  if (conversations) return ['agent', 'group']
  return change.documents.some((kind) => AGENT_DOCUMENTS.has(kind)) ||
    change.events.some((kind) => kind.startsWith('agent.')) ? ['agent'] : []
}
