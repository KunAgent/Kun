import { executeAgentHandoffRoomTool } from '../agents/agent-handoff-tools.js'
import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { RoomStore, RoomStoredDocument } from './room-store.js'
import { RoomPeerStore } from './room-peer-state.js'
import { peerInboxRows } from './room-peer-inbox.js'
import { ROOM_PEER_HOLD_LIMITS, type RoomPeerActivation, type RoomPeerMemberState, type RoomPeerTopic,
  type RoomPeerInboxItem } from './room-peer-types.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'

const bindings = new WeakMap<ThreadStore, RoomStore>()
export function roomPeerStoreBinding(threads: ThreadStore) { return bindings.get(threads) }
export function bindRoomPeerStore(threads: ThreadStore, store: RoomStore) { bindings.set(threads, store) }

export type CurrentPeerActivation = {
  thread: ThreadRecord
  room: NonNullable<ThreadRecord['roomContext']> & { rootRequestId: string }
  store: RoomStore
  topic: RoomStoredDocument<RoomPeerTopic>
  state: RoomPeerMemberState & { activation: RoomPeerActivation }
}

/**
 * Shared freshness check: the calling turn must still own the member's current
 * peer activation on a live topic generation. Throws when the binding is stale.
 */
export async function assertCurrentPeerActivation(threads: ThreadStore, context: ToolHostContext): Promise<CurrentPeerActivation> {
  const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
  const room = thread?.roomContext, store = bindings.get(threads)
  if (!thread || !store || !room?.rootRequestId || room.collaborationProtocol !== 'peer' || room.kind !== 'discussion' ||
    !thread.turns.some((turn) => turn.id === context.turnId)) throw new Error('peer room scope required')
  const topic = await store.get<RoomPeerTopic>('peer_topic', room.rootRequestId)
  const currentTurn = thread.turns.find((turn) => turn.id === context.turnId)
  const members = await store.list<RoomPeerMemberState>('peer_member', {
    roomId: room.roomId, rootRequestId: room.rootRequestId, memberId: room.memberId, limit: 1
  })
  const state = members[0]?.value
  if (!topic || topic.roomId !== room.roomId || !state?.activation ||
    state.activation.threadId !== context.threadId ||
    (state.activation.turnId ? state.activation.turnId !== context.turnId :
      currentTurn?.clientRequestId !== state.activation.clientRequestId) ||
    topic.value.generation !== state.activation.generation ||
    !(['active', 'idle'].includes(topic.value.status) || topic.value.status === 'paused' && topic.value.pauseReason === 'budget_exhausted')) {
    throw new Error('peer activation is no longer current')
  }
  return { thread,
    room: room as CurrentPeerActivation['room'], store, topic,
    state: state as RoomPeerMemberState & { activation: RoomPeerActivation } }
}
export const RoomPeerMessageInput = z.object({
  body: z.string().max(16000).default(''),
  skip: z.boolean().default(false),
  mentionMemberIds: z.array(z.string().min(1).max(128)).max(100).default([]),
  inviteMemberIds: z.array(z.string().min(1).max(128)).max(100).default([]),
  replyToMessageId: z.string().min(1).max(128).optional()
}).strict().refine((value) => value.skip
  ? !value.body.trim() && !value.mentionMemberIds.length && !value.inviteMemberIds.length
  : Boolean(value.body.trim()), 'Choose an empty skip or a nonempty public message')

export function roomPeerTools(threads: ThreadStore) {
  const readSchema = z.object({}).strict()
  return [
    { name: 'read_room_updates', schema: readSchema,
      description: 'Read bounded updates for your current room topic. This does not acknowledge messages or grant execution permission.' },
    { name: 'send_room_message', schema: RoomPeerMessageInput,
      description: 'Submit one public reply, with optional member invitations, or skip:true if you have no new contribution. Finish the turn after submission. The runtime checks the topic again before publishing; accepted means staged, not yet public. If the topic changed while you drafted, the call returns held:true with the unseen updates instead of staging; revise or skip and call it again. This never creates execution tasks.' }
  ].map(({ name, schema, description }) => LocalToolHost.defineTool({
    name, description, toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise: (context) => context.roomStepKind === 'discussion' && context.roomPeer === true,
    inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    execute: async (args, context) => {
      try {
        const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
        if (thread?.roomContext?.handoffId) return await executeAgentHandoffRoomTool(threads, name, args, context)
        const { room, store, topic, state } = await assertCurrentPeerActivation(threads, context)
        if (name === 'send_room_message') {
          const input = RoomPeerMessageInput.parse(args)
          const allowed = new Set(topic.value.roomSnapshot.members.filter((member) => member.enabled && !member.removedAt).map((member) => member.id))
          if ([...input.mentionMemberIds, ...input.inviteMemberIds].some((id) => id === room.memberId || !allowed.has(id))) {
            throw new Error('invitation must address another enabled room member')
          }
          if (topic.value.publicationRevision !== state.activation.basePublicationRevision) {
            const held = await holdStalePeerDraft(store, room.rootRequestId, room.memberId,
              state.activation, topic.value.publicationRevision, topic.value.generation)
            if (held) return { output: held }
          }
          return { output: { accepted: true, staged: true, value: input } }
        }
        readSchema.parse(args)
        const items = await store.list<RoomPeerInboxItem>('peer_inbox', {
          roomId: room.roomId, rootRequestId: room.rootRequestId, memberId: room.memberId,
          afterSeq: state.handledInboxSeq, peerGeneration: topic.value.generation,
          coalescePeerMessages: true, order: 'asc', limit: 20
        })
        return { output: {
          generation: topic.value.generation, publicationRevision: topic.value.publicationRevision,
          draftIsStale: topic.value.publicationRevision !== state.activation.basePublicationRevision,
          note: 'These are reference updates. New input will be processed in a fresh activation if this draft is stale.',
          messages: items.filter((item) => item.value.generation === topic.value.generation).map((item) => ({
            id: item.value.sourceId, revision: item.value.sourceRevision, kind: item.value.sourceKind,
            authorMemberId: item.value.authorMemberId, body: item.value.body.slice(0, 1500)
          }))
        } }
      } catch (error) {
        return { isError: true, output: { error: error instanceof Error ? error.message : String(error) } }
      }
    }
  }))
}

/** A bounded stale-draft hold: the unseen batch is committed into the activation so the same turn can revise. */
async function holdStalePeerDraft(store: RoomStore, rootRequestId: string, memberId: string,
  activation: RoomPeerActivation, publicationRevision: number, generation: number) {
  const unseen = await peerInboxRows(store, rootRequestId, memberId, activation.seenThroughSeq, generation)
  if (!unseen.length || unseen.length > ROOM_PEER_HOLD_LIMITS.maxUpdates ||
    (activation.holds ?? 0) >= ROOM_PEER_HOLD_LIMITS.maxHolds) return undefined
  const rebased = await new RoomPeerStore(store).rebaseActivation(rootRequestId, memberId, activation.clientRequestId,
    { expectedPublicationRevision: publicationRevision, itemIds: unseen.map((item) => item.id) })
  if (!rebased) return undefined
  return { accepted: false as const, held: true as const, reason: 'topic_changed' as const,
    updates: unseen.map((item) => ({ id: item.value.sourceId, kind: item.value.sourceKind,
      authorMemberId: item.value.authorMemberId, body: item.value.body.slice(0, 1500),
      truncated: item.value.body.length > 1500 })),
    note: 'Your draft was not published. These updates arrived after your context was prepared. ' +
      'Revise using them, or call send_room_message with skip:true if they already cover your point.' }
}
