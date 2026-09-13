import { executeAgentHandoffRoomTool } from '../agents/agent-handoff-tools.js'
import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RoomStore } from './room-store.js'
import type { RoomPeerMemberState, RoomPeerTopic, RoomPeerInboxItem } from './room-peer-types.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'

const bindings = new WeakMap<ThreadStore, RoomStore>()
export function roomPeerStoreBinding(threads: ThreadStore) { return bindings.get(threads) }
export function bindRoomPeerStore(threads: ThreadStore, store: RoomStore) { bindings.set(threads, store) }
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
      description: 'Submit one public reply, with optional member invitations, or skip:true if you have no new contribution. Finish the turn after submission. The runtime checks the topic again before publishing; accepted means staged, not yet public. This never creates execution tasks.' }
  ].map(({ name, schema, description }) => LocalToolHost.defineTool({
    name, description, toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise: (context) => context.roomStepKind === 'discussion' && context.roomPeer === true,
    inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    execute: async (args, context) => {
      try {
        const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
        const room = thread?.roomContext, store = bindings.get(threads)
        if (room?.handoffId) return await executeAgentHandoffRoomTool(threads, name, args, context)
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
        if (name === 'send_room_message') {
          const input = RoomPeerMessageInput.parse(args)
          const allowed = new Set(topic.value.roomSnapshot.members.filter((member) => member.enabled && !member.removedAt).map((member) => member.id))
          if ([...input.mentionMemberIds, ...input.inviteMemberIds].some((id) => id === room.memberId || !allowed.has(id))) {
            throw new Error('invitation must address another enabled room member')
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
