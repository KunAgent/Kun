import { posix, win32 } from 'node:path'
import {
  RoomEventSchema, RoomMessageSchema, RoomSummarySchema, RoomTaskSummarySchema,
  type RoomEvent, type RoomMessage, type RoomSummary, type RoomTaskSummary
} from '@kun/extension-api'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { Room, RoomMessage as StoredRoomMessage } from '../contracts/rooms.js'
import { RoomIdSchema } from '../contracts/rooms.js'
import { RoomTaskStatusSchema } from '../contracts/room-tasks.js'
import type { RoomTaskExecution } from '../rooms/room-runtime-types.js'
import type { RoomStore, RoomStoreEvent } from '../rooms/room-store.js'

export type ExtensionRoomAttachments = Pick<AttachmentStore, 'get'>

/** File metadata can contain paths even in its name; only expose a leaf label. */
function displayName(name: string, fallback: string): string {
  const value = posix.basename(win32.basename(name)).trim()
  return value && value !== '.' && value !== '..' ? value.slice(0, 256) : fallback
}

export async function projectRoomSummary(store: RoomStore, room: Room): Promise<RoomSummary> {
  const taskCounts = Object.fromEntries(RoomTaskStatusSchema.options.map((status) => [status, 0])) as
    RoomSummary['taskCounts']
  let afterSeq: number | undefined
  for (;;) {
    // Fetch only the store's status projection, never complete prompts or execution histories.
    const rows = await store.list<Pick<RoomTaskExecution, 'task'>>('task', {
      roomId: room.id, activityOnly: true, order: 'asc', afterSeq, limit: 1000
    })
    for (const row of rows) {
      const status = RoomTaskStatusSchema.safeParse(row.value.task.status)
      if (status.success) taskCounts[status.data] += 1
    }
    if (rows.length < 1000) break
    afterSeq = rows.at(-1)!.seq
  }
  return RoomSummarySchema.parse({
    id: room.id, name: room.name, collaborationMode: room.collaborationMode,
    updatedAt: room.updatedAt, memberCount: room.members.filter((member) => !member.removedAt).length,
    taskCounts
  })
}

export async function projectRoomMessage(
  message: StoredRoomMessage,
  attachments?: ExtensionRoomAttachments
): Promise<RoomMessage> {
  const visibleAttachments = await Promise.all(message.attachmentIds
    .filter((id) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(id))
    .map(async (id) => {
      const metadata = await attachments?.get(id)
      return { id, displayName: metadata ? displayName(metadata.name, 'Attachment') : 'Attachment' }
    }))
  return RoomMessageSchema.parse({
    id: message.id,
    ...(message.authorMemberId ? { authorMemberId: message.authorMemberId } : {}),
    authorDisplayName: message.authorLabelSnapshot, body: message.body, createdAt: message.createdAt,
    ...(message.replyToMessageId ? { replyToMessageId: message.replyToMessageId } : {}),
    mentionedMemberIds: [...message.mentionMemberIds], attachments: visibleAttachments
  })
}

export function projectRoomTask(execution: RoomTaskExecution, room: Room): RoomTaskSummary {
  const task = execution.task
  const repository = room.repositories.find((candidate) => candidate.id === task.repositoryId)
  return RoomTaskSummarySchema.parse({
    id: task.id, status: task.status, title: task.title, memberId: task.ownerMemberId,
    ...(repository ? { repositoryDisplayName: displayName(repository.displayName, 'Repository') } : {}),
    updatedAt: task.updatedAt
  })
}

/** Internal events advance replay cursors but never expose their type or payload. */
export function projectRoomEvent(event: RoomStoreEvent): RoomEvent | undefined {
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown> : {}
  const id = RoomIdSchema.safeParse(payload.id)
  if (!id.success) return undefined
  const taskId = RoomIdSchema.safeParse(payload.taskId)
  const result = RoomEventSchema.safeParse({
    type: event.kind, sequence: event.seq, timestamp: event.createdAt, roomId: event.roomId,
    payload: { id: id.data, ...(taskId.success ? { taskId: taskId.data } : {}) }
  })
  return result.success ? result.data : undefined
}
