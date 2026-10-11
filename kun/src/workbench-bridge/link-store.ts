import {
  WORKBENCH_ACTIVE_STATUSES, WORKBENCH_LIMITS, WorkbenchLinkSchema, isWorkbenchTerminal,
  type WorkbenchLink, type WorkbenchLinkEntry, type WorkbenchLinkStatus
} from '../contracts/workbench-links.js'
import { RoomMessageSchema, type Room, type RoomMessage } from '../contracts/rooms.js'
import { attachRoomRunPublication } from '../rooms/room-run-recording.js'
import { roomRunSegmentMessageId } from '../rooms/room-run-segments.js'
import { interactionFingerprint, interactionId, interactionReplay, retryRoomInteraction } from '../rooms/room-interaction-store.js'
import { RoomStoreConflictError, type RoomStore, type RoomStoreCommit, type RoomStoredDocument } from '../rooms/room-store.js'

/** Deterministic identity: one link per tool call (or per user action), so retries replay. */
export function workbenchLinkId(origin: WorkbenchLink['origin'], roomId: string, clientRequestId?: string): string {
  return origin.kind === 'tool'
    ? interactionId('workbench-link', origin.runId, origin.toolCallId)
    : origin.kind === 'series'
      ? interactionId('workbench-series-run', origin.seriesId, origin.occurrence)
      : interactionId('workbench-link', roomId, origin.action, clientRequestId ?? '')
}

const entry = (row: RoomStoredDocument<WorkbenchLink>): WorkbenchLinkEntry => ({ ...row.value, revision: row.revision })

export async function readWorkbenchLink(store: RoomStore, roomId: string, linkId: string): Promise<WorkbenchLinkEntry> {
  const row = await store.get<WorkbenchLink>('workbench_link', linkId)
  if (!row || row.roomId !== roomId) throw new Error('workbench link not found')
  return entry(row)
}

export async function listWorkbenchLinks(store: RoomStore, roomId: string, input: {
  status?: WorkbenchLinkStatus | readonly WorkbenchLinkStatus[]
  limit?: number
  beforeSeq?: number
} = {}): Promise<{ links: WorkbenchLinkEntry[]; nextCursor?: string }> {
  const limit = Math.min(input.limit ?? 50, 200)
  const rows = await store.list<WorkbenchLink>('workbench_link', {
    roomId, limit: limit + 1, order: 'desc', ...(input.beforeSeq ? { beforeSeq: input.beforeSeq } : {}),
    ...(input.status ? { status: Array.isArray(input.status) ? [...input.status] : input.status as string } : {}) })
  const page = rows.slice(0, limit)
  return { links: page.map(entry), ...(rows.length > limit ? { nextCursor: String(page.at(-1)!.seq) } : {}) }
}

/** Links that occupy a concurrency slot: accepted, in flight, or waiting on the user's attention. */
export async function countActiveLinks(store: RoomStore, roomId: string, participantAgentId: string): Promise<number> {
  const rows = await store.list<WorkbenchLink>('workbench_link', {
    roomId, participantAgentId, status: [...WORKBENCH_ACTIVE_STATUSES], limit: 100 })
  return rows.length
}

export async function countOpenConfirmations(store: RoomStore, roomId: string): Promise<number> {
  return (await store.list<WorkbenchLink>('workbench_link', {
    roomId, status: 'awaiting_confirmation', limit: WORKBENCH_LIMITS.maxOpenConfirmations })).length
}

export async function countRunLinks(store: RoomStore, roomId: string, runId: string): Promise<number> {
  return (await store.list<WorkbenchLink>('workbench_link', {
    roomId, originRunId: runId, limit: WORKBENCH_LIMITS.maxRunLinks })).length
}

export type CreateWorkbenchLinkInput = Pick<WorkbenchLink, 'roomId' | 'participantAgentId' | 'memberId' | 'kind' |
  'surface' | 'status' | 'origin' | 'request'> & Partial<Pick<WorkbenchLink, 'threadId' | 'turnId'>> &
  Partial<Pick<WorkbenchLink, 'seriesId' | 'occurrence'>> & { memberLabel: string; clientRequestId?: string }

/**
 * Stores the link and its timeline card in one transaction. A repeated call for
 * the same tool call (or user action) replays the first result.
 */
export async function createWorkbenchLink(store: RoomStore, input: CreateWorkbenchLinkInput):
  Promise<{ link: WorkbenchLinkEntry; message: RoomMessage; duplicate: boolean }> {
  const { memberLabel, clientRequestId, ...fields } = input
  const id = workbenchLinkId(input.origin, input.roomId, clientRequestId)
  const receipt = 'workbench-create:' + id
  const fingerprint = interactionFingerprint({ id, kind: input.kind, request: input.request })
  const replay = await interactionReplay<{ link: WorkbenchLinkEntry; message: RoomMessage }>(store, receipt, fingerprint)
  if (replay) return { ...replay, duplicate: true }
  const room = await store.get<Room>('room', input.roomId)
  if (!room || room.value.archivedAt) throw new RoomStoreConflictError('room is unavailable')
  const runId = input.origin.kind === 'tool' ? input.origin.runId : undefined
  const messageId = input.origin.kind === 'tool'
    ? roomRunSegmentMessageId(input.origin.runId, input.origin.toolCallId)
    : interactionId('workbench-card', id)
  const now = new Date().toISOString()
  const link = WorkbenchLinkSchema.parse({ schemaVersion: 1, id, ...fields, ...(runId ? { originRunId: runId } : {}),
    messageId, createdAt: now, updatedAt: now,
    ...(input.status === 'queued' ? { confirmedAt: now } : {}) })
  const message = RoomMessageSchema.parse({ id: messageId, roomId: input.roomId, messageSeq: 1,
    authorKind: 'member', authorMemberId: input.memberId, authorLabelSnapshot: memberLabel,
    ...(input.origin.kind === 'tool' ? { originItemId: input.origin.toolCallId } : {}),
    presentationKind: 'workbench_task', workbenchLinkId: id, body: input.request.title.slice(0, 500),
    bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], status: 'final', createdAt: now })
  const result = { link: { ...link, revision: 0 }, message }
  const commit: RoomStoreCommit = { requestId: receipt, fingerprint,
    checks: [{ kind: 'workbench_link', id, expectedRevision: null }, { kind: 'message', id: messageId, expectedRevision: null }],
    puts: [{ kind: 'workbench_link', id, roomId: input.roomId, value: link },
      { kind: 'message', id: messageId, roomId: input.roomId, value: message }],
    events: [{ roomId: input.roomId, kind: 'message.created', payload: { id: messageId } },
      { roomId: input.roomId, kind: 'workbench.link.updated', payload: { linkId: id, messageId, status: link.status } }],
    result }
  await attachRoomRunPublication(store, commit, message, runId)
  await store.commit(commit)
  return { ...result, duplicate: false }
}

/**
 * Read-modify-write with a revision check. `update` returns the next link or
 * null to leave it untouched. Callers that already hold a revision (a user
 * decision on a card) pass it so a stale card cannot overwrite a newer state.
 */
export async function updateWorkbenchLink(store: RoomStore, roomId: string, linkId: string,
  update: (link: WorkbenchLinkEntry) => Partial<WorkbenchLink> | null,
  options: { expectedRevision?: number; requestId?: string; fingerprint?: string } = {}): Promise<WorkbenchLinkEntry> {
  const run = async (): Promise<WorkbenchLinkEntry> => {
    const row = await store.get<WorkbenchLink>('workbench_link', linkId)
    if (!row || row.roomId !== roomId) throw new Error('workbench link not found')
    if (options.expectedRevision !== undefined && row.revision !== options.expectedRevision) {
      throw new RoomStoreConflictError('workbench link changed since it was read', row.revision)
    }
    const current = entry(row)
    const patch = update(current)
    if (!patch) return current
    const next = WorkbenchLinkSchema.parse({ ...row.value, ...patch, id: row.value.id, roomId: row.value.roomId,
      updatedAt: new Date().toISOString(),
      ...(isWorkbenchTerminal(patch.status ?? row.value.status) && !row.value.finishedAt ? { finishedAt: new Date().toISOString() } : {}) })
    const result = { ...next, revision: row.revision + 1 }
    await store.commit({ requestId: options.requestId ?? interactionId('workbench-update', linkId, row.revision, next.status),
      ...(options.fingerprint ? { fingerprint: options.fingerprint } : {}),
      checks: [{ kind: 'workbench_link', id: linkId, expectedRevision: row.revision }],
      puts: [{ kind: 'workbench_link', id: linkId, roomId, value: next }],
      events: [{ roomId, kind: 'workbench.link.updated', payload: { linkId, messageId: next.messageId, status: next.status } }],
      result })
    return result
  }
  // A caller-supplied revision is authoritative: conflicts must surface, not retry.
  return options.expectedRevision === undefined ? retryRoomInteraction(run) : run()
}
