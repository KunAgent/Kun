import { z } from 'zod'
import type { RoomLatestMessage } from './room-list.js'
import type { RoomAvatarReference } from './room-content.js'
import type { RoomMember } from './rooms.js'

export const RoomSidebarQuery = z.object({
  kind: z.enum(['all', 'agents', 'group', 'agent_agent']).default('all'),
  archivedOnly: z.boolean().default(false), unreadOnly: z.boolean().default(false), attentionOnly: z.boolean().default(false),
  search: z.string().trim().max(200).default(''), repositoryRoot: z.string().max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40), cursor: z.string().max(2048).optional()
}).strict()
export type RoomSidebarQuery = z.input<typeof RoomSidebarQuery>
export type RoomSidebarEntry = {
  id: string; roomId?: string; agentId?: string; name: string; title: string; avatar?: RoomAvatarReference
  kind: 'user_agent' | 'group' | 'agent_agent'; members: RoomMember[]; pinned: boolean; archived: boolean
  latestMessage?: RoomLatestMessage; latestMessageSeq: number; readSeq: number; runningCount: number; attentionCount: number
}
export type RoomSidebarPage = { entries: RoomSidebarEntry[]; nextCursor?: string }
