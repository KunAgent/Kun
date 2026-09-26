import { applyRoomToolPolicy } from '../loop/room-turn-policy.js'
import { submitRoomPollAction } from './room-poll-actions.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoomMemberSchema, type RoomMessage } from '../contracts/rooms.js'
import type { RoomPoll } from '../contracts/room-interactions.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { createRoomPoll, commitRoomPollVote, closeRoomPoll, readRoomPoll } from './room-polls.js'
import { setRoomMessageReaction, readRoomMessageInteractions } from './room-interactions.js'
import { RoomPeerRunner } from './room-peer-runner.js'
import { roomPollVoteTool } from './room-poll-vote-tool.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'room-interactions-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') }), wake = vi.fn()
  const service = new RoomService(store, wake)
  const room = (await service.create({ clientRequestId: 'room', name: 'Polls', collaborationMode: 'peer',
    members: [RoomMemberSchema.parse({ id: 'developer', displayName: 'Developer', role: 'developer', presetId: 'developer', revision: 0 })] })).room
  cleanups.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const poll = (await createRoomPoll(store, room.id, { clientRequestId: 'poll', question: 'Which API shape?', options: ['A', 'B'] })).poll
  const h = makeHarness(makeFakeModel([]))
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate, dataDir: root,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: async () => {} }
  const runner = new RoomPeerRunner(deps, () => {})
  cleanups.push(async () => { await runner.close(); await h.turns.interruptActiveTurns() })
  const invite = async (structured = true) => {
    const sent = await service.send(room.id, { clientRequestId: structured ? 'invite' : 'text-only', body: 'Please vote in ' + poll.pollId,
      executionIntent: 'discussion', mentionMemberIds: ['developer'], replyToMessageId: poll.messageId,
      ...(structured ? { pollInvitation: { pollId: poll.pollId, memberIds: ['developer'] } } : {}) })
    const request = (await store.get<RoomRequestState>('request', sent.requestId))!
    await runner.state.initialize(request.value)
    await runner.tick()
    const member = (await runner.state.member(request.id, 'developer'))!, active = member.value.activation!
    const thread = (await h.threads.getMetadata(active.threadId))!
    await h.threadStore.upsert({ ...thread, turns: thread.turns.map((turn) => turn.id === active.turnId ? { ...turn, status: 'running' } : turn) })
    const context: ToolHostContext = applyRoomToolPolicy({ threadId: thread.id, turnId: active.turnId!, workspace: thread.workspace,
      sandboxMode: 'read-only', approvalPolicy: 'auto', threadMode: 'plan', abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow', roomStepKind: 'discussion', roomPeer: true, allowedToolNames: thread.roomContext?.allowedToolNames }, thread)
    return { request, thread, context, active }
  }
  return { root, store, service, room, poll, h, deps, runner, wake, invite, tool: roomPollVoteTool(h.threadStore, () => store) }
}

describe('presentation-only room polls and reactions', () => {
  it('creates, votes, changes ballots, reacts and closes without waking members or rewriting messages', async () => {
    const f = await fixture(), before = (await f.store.get<RoomMessage>('message', f.poll.messageId))!
    expect((await createRoomPoll(f.store, f.room.id, { clientRequestId: 'poll', question: 'Which API shape?', options: ['A', 'B'] })).poll.pollId).toBe(f.poll.pollId)
    await expect(createRoomPoll(f.store, f.room.id, { clientRequestId: 'poll', question: 'Different', options: ['A', 'B'] })).rejects.toThrow('identity')
    await commitRoomPollVote(f.store, f.room.id, f.poll.pollId, { clientRequestId: 'vote', optionIds: ['option-1'] })
    await commitRoomPollVote(f.store, f.room.id, f.poll.pollId, { clientRequestId: 'vote', optionIds: ['option-1'] })
    const changed = await commitRoomPollVote(f.store, f.room.id, f.poll.pollId, { clientRequestId: 'change', optionIds: ['option-2'] })
    expect(Object.keys(changed.ballots)).toEqual(['local-user'])
    expect(changed.ballots['local-user'].optionIds).toEqual(['option-2'])
    await setRoomMessageReaction(f.store, f.room.id, f.poll.messageId, { clientRequestId: 'reaction', emoji: '👍', active: true })
    await setRoomMessageReaction(f.store, f.room.id, f.poll.messageId, { clientRequestId: 'reaction', emoji: '👍', active: true })
    expect((await readRoomMessageInteractions(f.store, f.room.id, f.poll.messageId)).reactions.reactions).toEqual([{ emoji: '👍', count: 1, reacted: true }])
    await closeRoomPoll(f.store, f.room.id, f.poll.pollId, { clientRequestId: 'close' })
    expect(await f.store.get('message', f.poll.messageId)).toEqual(before)
    expect(f.wake).not.toHaveBeenCalled()
    for (const kind of ['request', 'peer_inbox', 'peer_topic', 'task', 'room_run'] as const) expect(await f.store.list(kind, { roomId: f.room.id })).toHaveLength(0)
    expect((await f.store.events(f.room.id)).filter((event) => event.kind === 'message.updated')).toHaveLength(0)
  })

  it('merges concurrent voters and rejects bad options and cross-room access', async () => {
    const f = await fixture()
    await Promise.all([
      commitRoomPollVote(f.store, f.room.id, f.poll.pollId, { clientRequestId: 'one', optionIds: ['option-1'] }),
      commitRoomPollVote(f.store, f.room.id, f.poll.pollId, { clientRequestId: 'two', optionIds: ['option-2'] }, { id: 'member-test', memberId: 'test' })
    ])
    expect(Object.keys((await readRoomPoll(f.store, f.room.id, f.poll.pollId)).ballots)).toHaveLength(2)
    await expect(commitRoomPollVote(f.store, f.room.id, f.poll.pollId, { clientRequestId: 'bad', optionIds: ['option-1', 'option-2'] })).rejects.toThrow('selection')
    await expect(commitRoomPollVote(f.store, f.room.id, f.poll.pollId, { clientRequestId: 'unknown', optionIds: ['made-up'] })).rejects.toThrow('selection')
    await expect(readRoomPoll(f.store, 'other-room', f.poll.pollId)).rejects.toThrow('not found')
    const multiple = (await createRoomPoll(f.store, f.room.id, { clientRequestId: 'multi', question: 'Pick several', options: ['A', 'B', 'C'], multiple: true })).poll
    expect((await commitRoomPollVote(f.store, f.room.id, multiple.pollId, { clientRequestId: 'many', optionIds: ['option-1', 'option-3'] })).ballots['local-user'].optionIds).toEqual(['option-1', 'option-3'])
  })

  it('freezes explicit invitation/results requests and replays them without new model work after votes change', async () => {
    const f = await fixture(), input = { store: f.store, service: f.service }
    const invited = await submitRoomPollAction(input, f.room.id, f.poll.pollId, 'invite', { clientRequestId: 'explicit', memberIds: ['developer'] })
    const first = await submitRoomPollAction(input, f.room.id, f.poll.pollId, 'discuss', { clientRequestId: 'results' })
    await commitRoomPollVote(f.store, f.room.id, f.poll.pollId, { clientRequestId: 'changed', optionIds: ['option-1'] })
    expect(await submitRoomPollAction(input, f.room.id, f.poll.pollId, 'discuss', { clientRequestId: 'results' })).toEqual(first)
    expect(await submitRoomPollAction(input, f.room.id, f.poll.pollId, 'invite', { clientRequestId: 'explicit', memberIds: ['developer'] })).toEqual(invited)
    expect(f.wake).toHaveBeenCalledTimes(2)
    const request = (await f.store.get<RoomRequestState>('request', invited.requestId))!.value
    expect(request.pollInvitation).toMatchObject({ options: f.poll.options, memberIds: ['developer'], pollRevision: 0 })
    expect(request.message.executionIntent).toBe('discussion')
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
  })

  it('derives expiry from its durable deadline without writes and rejects late votes', async () => {
    const f = await fixture()
    const deadline = Date.now() + 1000
    const poll = (await createRoomPoll(f.store, f.room.id, { clientRequestId: 'expiry', question: 'Expires soon', options: ['A', 'B'], closesAt: new Date(deadline).toISOString() })).poll
    const before = await f.store.events(f.room.id)
    vi.useFakeTimers(); vi.setSystemTime(deadline + 100)
    expect((await readRoomPoll(f.store, f.room.id, poll.pollId)).state).toBe('expired')
    await expect(commitRoomPollVote(f.store, f.room.id, poll.pollId, { clientRequestId: 'late', optionIds: ['option-1'] })).rejects.toThrow('expired')
    expect(await f.store.events(f.room.id)).toEqual(before)
    expect(f.wake).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('host-bound explicit member voting', () => {
  it('freezes invitation, permits only its native turn and leaves discussion version/budget unchanged', async () => {
    const f = await fixture(), run = await f.invite()
    const before = (await f.runner.state.topic(run.request.id))!.value
    expect(run.request.value.pollInvitation).toMatchObject({ pollId: f.poll.pollId, memberIds: ['developer'], question: f.poll.question })
    expect(run.thread.roomContext?.allowedToolNames).toContain('vote_room_poll')
    expect(run.context.allowedToolNames).toContain('vote_room_poll')
    expect(f.tool.shouldAdvertise?.(run.context)).toBe(true)
    expect(await f.tool.execute({ pollId: f.poll.pollId, optionIds: ['option-1'] }, run.context)).toMatchObject({ output: { accepted: true } })
    const first = await readRoomPoll(f.store, f.room.id, f.poll.pollId)
    expect(first.ballots['member-developer']).toMatchObject({ optionIds: ['option-1'], requestId: run.request.id, threadId: run.thread.id, turnId: run.context.turnId })
    expect(await f.tool.execute({ pollId: f.poll.pollId, optionIds: ['option-1'] }, run.context)).toMatchObject({ output: { accepted: true } })
    expect((await readRoomPoll(f.store, f.room.id, f.poll.pollId)).revision).toBe(first.revision)
    expect(await f.tool.execute({ pollId: f.poll.pollId, optionIds: ['option-2'] }, run.context)).toMatchObject({ isError: true })
    expect((await f.runner.state.topic(run.request.id))!.value).toEqual(before)
    expect(f.wake).toHaveBeenCalledTimes(1)
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
  })

  it('checks cancellation in the same vote transaction even after model admission', async () => {
    const f = await fixture(), run = await f.invite()
    const commit = f.store.commit.bind(f.store)
    let cancelBeforeVote = true
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (cancelBeforeVote && input.puts?.some((put) => put.kind === 'room_poll')) {
        cancelBeforeVote = false
        const request = (await f.store.get<RoomRequestState>('request', run.request.id))!
        await commit({ requestId: 'user-cancel-before-vote', checks: [{ kind: 'request', id: request.id, expectedRevision: request.revision }],
          puts: [{ kind: 'request', id: request.id, roomId: f.room.id, value: { ...request.value, cancellationRequested: true } }] })
      }
      return commit(input)
    })
    expect(await f.tool.execute({ pollId: f.poll.pollId, optionIds: ['option-1'] }, run.context)).toMatchObject({ isError: true })
    expect((await readRoomPoll(f.store, f.room.id, f.poll.pollId)).ballots).toEqual({})
  })

  it('rejects text-only invitations, spoofed arguments, wrong turns, cancellation and expired polls', async () => {
    const f = await fixture(), run = await f.invite(false)
    expect(run.thread.roomContext?.allowedToolNames).not.toContain('vote_room_poll')
    expect(await f.tool.execute({ pollId: f.poll.pollId, optionIds: ['option-1'] }, run.context)).toMatchObject({ isError: true })
    const g = await fixture(), invited = await g.invite()
    expect(await g.tool.execute({ pollId: g.poll.pollId, optionIds: ['option-1'], memberId: 'spoof' }, invited.context)).toMatchObject({ isError: true })
    expect(await g.tool.execute({ pollId: g.poll.pollId, optionIds: ['option-1'] }, { ...invited.context, turnId: 'wrong' })).toMatchObject({ isError: true })
    await g.runner.state.stop(invited.request.id)
    expect(await g.tool.execute({ pollId: g.poll.pollId, optionIds: ['option-1'] }, invited.context)).toMatchObject({ isError: true })
    const row = (await g.store.get<RoomPoll>('room_poll', g.poll.pollId))!
    await putRoomDocument(g.store, 'room_poll', row.id, g.room.id, { ...row.value, closesAt: '2000-01-01T00:00:00.000Z' }, row)
    expect(await g.tool.execute({ pollId: g.poll.pollId, optionIds: ['option-1'] }, invited.context)).toMatchObject({ isError: true })
    expect((await readRoomPoll(g.store, g.room.id, g.poll.pollId)).ballots).toEqual({})
  })
})
