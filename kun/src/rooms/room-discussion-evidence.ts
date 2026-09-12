import type { RoomContextSnapshot } from '../contracts/rooms-product.js'
import type { RoomRequestState } from './room-runtime-types.js'
import { boundedRoomText } from './room-context.js'

type Discussion = NonNullable<RoomRequestState['discussions']>[number]
type EvidenceItem = Pick<Discussion, 'memberId' | 'threadId' | 'turnId' | 'round' | 'continuation' | 'sourceMessageId'> & {
  messageId: string
  response: string
}
export type RoomDiscussionEvidence = {
  authority: 'reference_only'
  truncated: boolean
  responses: EvidenceItem[]
}
const HISTORY_BYTES = 32768
const HISTORY_ITEMS = 64
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))

function attributed(request: RoomRequestState, discussion: Discussion): Discussion {
  // Older persisted rounds encoded their coordinates in the thread identity.
  const suffix = discussion.threadId.startsWith('room-member-' + request.id + '-')
    ? discussion.threadId.slice(('room-member-' + request.id + '-').length).match(/^(\d+)-(\d+)-/) : null
  const continuation = discussion.continuation ?? (suffix ? Number(suffix[1]) : undefined)
  return { ...discussion, continuation,
    round: discussion.round ?? (suffix ? Number(suffix[2]) : undefined),
    sourceMessageId: discussion.sourceMessageId ??
      (continuation === (request.continuation ?? 0) ? request.sourceMessageId : undefined) }
}

function completed(request: RoomRequestState): Discussion[] {
  const unique = new Map<string, Discussion>()
  for (const discussion of [...(request.previousDiscussions ?? []), ...(request.discussions ?? [])]) {
    if (discussion.response !== undefined) unique.set(discussion.threadId, attributed(request, discussion))
  }
  return [...unique.values()]
}

/** Retain bounded response excerpts; the original messages and turn transcripts remain durable. */
export function preserveRoomDiscussions(request: RoomRequestState): void {
  const all = completed(request)
  const saved = all.slice(-HISTORY_ITEMS).map((entry) => ({ ...entry,
    response: boundedRoomText(entry.response!, 4096) }))
  let truncated = saved.length !== all.length || saved.some((entry, index) =>
    entry.response !== all[all.length - saved.length + index].response)
  while (bytes(saved) > HISTORY_BYTES && saved.length) {
    truncated = true
    const longest = saved.reduce((a, b) => bytes(a.response) >= bytes(b.response) ? a : b)
    if (longest.response.length > 64) longest.response = boundedRoomText(longest.response,
      Math.max(64, Buffer.byteLength(longest.response) - Math.max(256, bytes(saved) - HISTORY_BYTES)))
    else saved.shift()
  }
  request.previousDiscussions = saved
  request.discussionHistoryTruncated ||= truncated
}

function evidence(request: RoomRequestState, budget: number): RoomDiscussionEvidence {
  const all = completed(request)
  const result: RoomDiscussionEvidence = { authority: 'reference_only',
    truncated: Boolean(request.discussionHistoryTruncated) || all.length > HISTORY_ITEMS,
    responses: all.slice(-HISTORY_ITEMS).map(({ memberId, threadId, turnId, round, continuation, sourceMessageId, response }) => ({
      memberId, threadId, turnId, round, continuation, sourceMessageId,
      messageId: 'reply-' + threadId, response: boundedRoomText(response!, 2048)
    })) }
  result.truncated ||= result.responses.some((entry, index) => entry.response !== all[all.length - result.responses.length + index].response)
  while (bytes(result) > budget && result.responses.length) {
    result.truncated = true
    const longest = result.responses.reduce((a, b) => bytes(a.response) >= bytes(b.response) ? a : b)
    if (longest.response.length > 64) longest.response = boundedRoomText(longest.response,
      Math.max(64, Buffer.byteLength(longest.response) - Math.max(128, Math.ceil((bytes(result) - budget) / result.responses.length))))
    else {
      const group = (item: EvidenceItem) => `${item.continuation ?? 'unknown'}:${item.round ?? 'unknown'}`
      const index = result.responses.findIndex((item) => result.responses.filter((other) => group(other) === group(item)).length > 1)
      result.responses.splice(index < 0 ? 0 : index, 1)
    }
  }
  return result
}

/** A per-turn view: the admitted context stays immutable while newer discussion is attributed separately. */
export function roomDiscussionContext(request: RoomRequestState, context: RoomContextSnapshot, budget: number) {
  const result: { context: RoomContextSnapshot; discussionEvidence?: RoomDiscussionEvidence } = {
    context: structuredClone(context), discussionEvidence: evidence(request, Math.min(4000, Math.floor(budget / 4))) }
  const view = result.context
  while (bytes(result) > budget && view.messages.length) {
    // Preserve an explicit reply longer than ordinary background history.
    const index = view.messages.findIndex((message) => message.id !== request.message.replyToMessageId)
    if (index < 0) break
    view.messages.splice(index, 1)
    view.truncated = true
  }
  while (bytes(result) > budget && view.summary) {
    view.summary = boundedRoomText(view.summary, Math.max(0, Buffer.byteLength(view.summary) - 256))
    view.truncated = true
  }
  // Explicit user-adopted rules and agreements are never displaced by peer text.
  if (bytes(result) > budget) result.discussionEvidence = undefined
  while (bytes(result) > budget && view.messages.length) {
    const message = view.messages[0]
    if (message.body) message.body = boundedRoomText(message.body, Math.max(0, Buffer.byteLength(message.body) - 256))
    else view.messages.shift()
    view.truncated = true
  }
  if (bytes(result) > budget) throw new Error('room reference metadata and agreements exceed context budget')
  return result
}
