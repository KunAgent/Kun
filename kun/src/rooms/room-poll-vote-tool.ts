import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomRequestState } from './room-runtime-types.js'
import type { RoomPeerMemberState, RoomPeerTopic } from './room-peer-types.js'
import type { RoomStore, RoomStoreCommit } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { roomRunId } from './room-run-recording.js'
import { commitRoomPollVote, readRoomPoll, assertRoomPollOpen } from './room-polls.js'
import { interactionId } from './room-interaction-store.js'

const Input = z.object({ pollId: z.string().min(1).max(128), optionIds: z.array(z.string().min(1).max(128)).min(1).max(10) }).strict()
async function authorizeVote(threads: ThreadStore, store: RoomStore, context: ToolHostContext, pollId: string) {
  if (context.abortSignal.aborted) throw new Error('poll vote turn was cancelled')
  const thread = await threads.getMetadata?.(context.threadId)
  const turn = thread?.turns.find((entry) => entry.id === context.turnId)
  const scope = thread?.roomContext
  if (!scope || scope.kind !== 'discussion' || !scope.allowedToolNames?.includes('vote_room_poll') || scope.blockedToolNames.includes('vote_room_poll') || !turn?.clientRequestId || turn.status !== 'running' || turn.threadId !== thread!.id) {
    throw new Error('an active invited room discussion turn is required')
  }
  const run = await store.get<RoomRunRecord>('room_run', roomRunId(scope.roomId, turn.clientRequestId))
  if (!run?.value.requestId || run.value.threadId !== thread!.id || (run.value.turnId && run.value.turnId !== turn.id) ||
    run.value.memberId !== scope.memberId || run.roomId !== scope.roomId) throw new Error('exact room run invitation identity required')
  const request = await store.get<RoomRequestState>('request', run.value.requestId)
  const invitation = request?.value.pollInvitation
  if (!request || request.roomId !== scope.roomId || request.value.cancellationRequested ||
    !['pending', 'running', 'completed'].includes(request.value.status) || !invitation || invitation.pollId !== pollId ||
    !invitation.memberIds.includes(scope.memberId) || request.value.message.executionIntent !== 'discussion') {
    throw new Error('the user did not invite this member on the current request')
  }
  const checks: NonNullable<RoomStoreCommit['checks']> = [{ kind: 'request', id: request.id, expectedRevision: request.revision }]
  if (request.value.collaborationProtocol === 'peer') {
    const rootId = request.value.rootRequestId ?? request.id
    const root = rootId === request.id ? request : await store.get<RoomRequestState>('request', rootId)
    const topic = await store.get<RoomPeerTopic>('peer_topic', rootId)
    const states = await store.list<RoomPeerMemberState>('peer_member', { roomId: scope.roomId,
      rootRequestId: rootId, memberId: scope.memberId, limit: 1 })
    const state = states[0], active = state?.value.activation
    if (!root || (root.value.peerLatestRequestId ?? root.id) !== request.id || scope.rootRequestId !== rootId ||
      !topic || topic.value.requestId !== request.id || !['active', 'idle', 'paused'].includes(topic.value.status) ||
      (topic.value.status === 'paused' && topic.value.pauseReason !== 'budget_exhausted') ||
      active?.threadId !== thread!.id || active.clientRequestId !== turn.clientRequestId ||
      (active.turnId && active.turnId !== turn.id) || active.phase !== 'respond' || active.generation !== topic.value.generation) {
      throw new Error('poll vote belongs to a superseded or stopped topic activation')
    }
    checks.push({ kind: 'peer_topic', id: topic.id, expectedRevision: topic.revision },
      { kind: 'peer_member', id: state.id, expectedRevision: state.revision })
    if (root.id !== request.id) checks.push({ kind: 'request', id: root.id, expectedRevision: root.revision })
  } else if (request.value.stage !== 'discuss' || !request.value.discussions?.some((entry) =>
    entry.memberId === scope.memberId && entry.threadId === thread!.id && entry.turnId === turn.id)) {
    throw new Error('poll vote is not the current invited discussion attempt')
  }
  const poll = await readRoomPoll(store, scope.roomId, pollId)
  assertRoomPollOpen(poll)
  if (invitation.closesAt && Date.parse(invitation.closesAt) <= Date.now()) throw new Error('poll invitation expired')
  if (poll.closesAt !== invitation.closesAt || JSON.stringify(poll.options) !== JSON.stringify(invitation.options) || poll.question !== invitation.question || poll.multiple !== invitation.multiple) {
    throw new RoomStoreConflictError('poll invitation snapshot does not match this poll')
  }
  if (context.abortSignal.aborted) throw new Error('poll vote turn was cancelled')
  return { roomId: scope.roomId, memberId: scope.memberId, requestId: request.id, checks }
}

export function roomPollVoteTool(threads: ThreadStore, getStore: () => RoomStore | undefined) {
  return LocalToolHost.defineTool({ name: 'vote_room_poll',
    description: 'Cast the single ballot explicitly requested by the user for this exact poll invitation. Supply option IDs from the frozen invitation. Never creates tasks or grants execution permission.',
    toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise: (context) => context.roomStepKind === 'discussion' && context.allowedToolNames?.includes('vote_room_poll') === true,
    inputSchema: z.toJSONSchema(Input), execute: async (args, context) => {
      try {
        const input = Input.parse(args), store = getStore()
        if (!store) throw new Error('room poll store is unavailable')
        await store.assertOwnership()
        const bound = await authorizeVote(threads, store, context, input.pollId)
        const poll = await commitRoomPollVote(store, bound.roomId, input.pollId, {
          clientRequestId: interactionId('member-ballot', bound.requestId, bound.memberId), optionIds: input.optionIds
        }, { id: 'member-' + bound.memberId, memberId: bound.memberId, requestId: bound.requestId,
          threadId: context.threadId, turnId: context.turnId }, async (commit) => {
          const fresh = await authorizeVote(threads, store, context, input.pollId)
          commit.checks!.push(...fresh.checks)
          const room = await store.get<import('../contracts/rooms.js').Room>('room', bound.roomId)
          if (!room?.value.members.some((member) => member.id === bound.memberId && member.enabled && !member.removedAt)) {
            throw new Error('invited member is no longer enabled')
          }
        })
        return { output: { accepted: true, pollId: poll.pollId, optionIds: input.optionIds } }
      } catch (error) { return { isError: true, output: { error: error instanceof Error ? error.message : String(error) } } }
    } })
}
