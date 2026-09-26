import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyRoomToolPolicy } from '../loop/room-turn-policy.js'
import { ROOM_REMINDER_LIMITS, RoomReminderSchema, type RoomReminder } from '../contracts/room-reminders.js'
import { RoomMemberSchema, type Room, type RoomMessage } from '../contracts/rooms.js'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomService } from './room-service.js'
import { AgentIdentityService } from '../agents/agent-identity-service.js'
import { AgentDirectRunner } from '../agents/agent-direct-runner.js'
import { quickCreateAgent } from '../agents/agent-chat-entry.js'
import { prepareRoomRun, roomRunId, updateRoomRun } from './room-run-recording.js'
import { bindRoomPeerStore } from './room-peer-tools.js'
import {
  cancelRoomReminder,
  createRoomReminder,
  fireDueRoomReminders,
  listRoomReminders,
  readRoomReminder,
  reminderFireAt,
  updateRoomReminder
} from './room-reminders.js'
import { roomReminderTools, ROOM_REMINDER_TOOL_NAMES } from './room-reminder-tools.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'room-reminders-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const service = new RoomService(store, vi.fn())
  const agents = new AgentIdentityService(store, () => ({}))
  service.setAgentDirectory(agents)
  const h = makeHarness(makeFakeModel([]))
  const deps: RoomRuntimeDeps = {
    dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId),
    model: () => ({ model: 'fake', providerId: 'test' }), profiles: () => ({}),
    agentDirectory: agents, assertOwnership: async () => {}
  }
  bindRoomPeerStore(h.threadStore, store)
  const created = await quickCreateAgent(agents, { clientRequestId: 'agent' }, true)
  const room = await service.get(created.roomId)
  const memberId = room.members[0].id
  const reminder = (overrides: Record<string, unknown> = {}, clientRequestId = 'schedule') => createRoomReminder(store, {
    clientRequestId, roomId: room.id, participantAgentId: created.agentId, memberId,
    note: 'Check on the user request', fireAt: new Date(Date.now() + 3600_000).toISOString(),
    chainDepth: 0, createdByRunId: 'run-1', ...overrides
  })
  cleanups.push(async () => { await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  return { root, store, service, agents, h, deps, created, room, memberId, reminder }
}

describe('room reminder scheduling', () => {
  it('accepts exactly one of delaySeconds or fireAt within the allowed window', () => {
    const now = new Date()
    expect(reminderFireAt({ delaySeconds: 120 }, now)).toBe(new Date(now.getTime() + 120_000).toISOString())
    const at = new Date(now.getTime() + 7200_000).toISOString()
    expect(reminderFireAt({ fireAt: at }, now)).toBe(at)
    expect(() => reminderFireAt({ delaySeconds: 120, fireAt: at }, now)).toThrow('exactly one')
    expect(() => reminderFireAt({}, now)).toThrow('exactly one')
    expect(() => reminderFireAt({ delaySeconds: 59 }, now)).toThrow('at least')
    expect(() => reminderFireAt({ delaySeconds: ROOM_REMINDER_LIMITS.maxDelaySec + 1 }, now)).toThrow('30 days')
    expect(() => reminderFireAt({ fireAt: 'not-a-time' }, now)).toThrow('valid timestamp')
    expect(() => reminderFireAt({ fireAt: new Date(now.getTime() - 1000).toISOString() }, now)).toThrow('at least')
  })

  it('round-trips the document contract and rejects out-of-range chain depth', async () => {
    const f = await fixture()
    const entry = await f.reminder()
    expect(entry).toMatchObject({
      schemaVersion: 1, roomId: f.room.id, participantAgentId: f.created.agentId,
      memberId: f.memberId, status: 'scheduled', chainDepth: 0, revision: 0 })
    const doc = { ...entry } as Record<string, unknown>
    delete doc.revision
    expect(RoomReminderSchema.parse(doc)).toMatchObject({ status: 'scheduled' })
    expect(RoomReminderSchema.safeParse({ ...entry, chainDepth: ROOM_REMINDER_LIMITS.maxChainDepth + 1 }).success).toBe(false)
    expect(await readRoomReminder(f.store, f.room.id, entry.reminderId)).toMatchObject({ reminderId: entry.reminderId })
    await expect(readRoomReminder(f.store, 'other-room', entry.reminderId)).rejects.toThrow('not found')
    await expect(f.reminder({ memberId: 'missing-member' }, 'bad-member')).rejects.toThrow('unavailable')
  })

  it('replays creation idempotently and rejects group rooms', async () => {
    const f = await fixture()
    const fireAt = new Date(Date.now() + 3600_000).toISOString()
    const first = await f.reminder({ fireAt }, 'idem')
    expect(await f.reminder({ fireAt }, 'idem')).toEqual(first)
    expect(await f.store.list('room_reminder', { roomId: f.room.id })).toHaveLength(1)
    const group = (await f.service.create({ clientRequestId: 'group', name: 'Group',
      members: [RoomMemberSchema.parse({ id: 'dev', displayName: 'Dev', role: 'developer',
        presetId: 'developer', revision: 0 })] })).room
    await expect(createRoomReminder(f.store, { clientRequestId: 'g', roomId: group.id,
      participantAgentId: 'agent-x', memberId: 'dev', note: 'n', fireAt: new Date(Date.now() + 3600_000).toISOString(),
      chainDepth: 0, createdByRunId: 'run' })).rejects.toThrow('private agent conversations')
  })

  it('enforces the scheduled cap and the rolling 24-hour fire budget', async () => {
    const f = await fixture()
    const later = new Date(Date.now() + 2 * 86400_000).toISOString()
    for (let index = 0; index < ROOM_REMINDER_LIMITS.maxScheduledPerAgent; index += 1) {
      await f.reminder({ fireAt: later }, 'l' + index)
    }
    await expect(f.reminder({ fireAt: later }, 'overflow-count')).rejects.toThrow('scheduled reminder limit')
    expect((await listRoomReminders(f.store, f.room.id, { status: 'all' })))
      .toHaveLength(ROOM_REMINDER_LIMITS.maxScheduledPerAgent)
    // The 24-hour budget counts upcoming fires plus reminders that already
    // fired inside the window, so an agent cannot churn through re-schedules.
    const g = await fixture()
    const firedAt = new Date().toISOString()
    for (let index = 0; index < ROOM_REMINDER_LIMITS.maxFiresPer24h; index += 1) {
      const value = RoomReminderSchema.parse({ schemaVersion: 1, reminderId: 'seed-fired-' + index,
        roomId: g.room.id, participantAgentId: g.created.agentId, memberId: g.memberId, note: 'seed',
        fireAt: firedAt, status: 'fired', chainDepth: 0, createdByRunId: 'run-seed',
        createdAt: firedAt, updatedAt: firedAt, firedAt })
      await g.store.commit({ requestId: 'seed-fired-' + index,
        checks: [{ kind: 'room_reminder', id: value.reminderId, expectedRevision: null }],
        puts: [{ kind: 'room_reminder', id: value.reminderId, roomId: g.room.id, value }] })
    }
    const soon = new Date(Date.now() + 3600_000).toISOString()
    await expect(g.reminder({ fireAt: soon }, 'overflow-window')).rejects.toThrow('24 hour')
    // Outside the window the budget does not apply.
    await g.reminder({ fireAt: later }, 'outside-window')
  })

  it('updates and cancels only scheduled reminders with revision checks', async () => {
    const f = await fixture()
    const entry = await f.reminder()
    const updated = await updateRoomReminder(f.store, f.room.id, entry.reminderId,
      { clientRequestId: 'u1', note: 'Later note', delaySeconds: 120 })
    expect(updated.note).toBe('Later note')
    expect(Date.parse(updated.fireAt)).toBeGreaterThan(Date.now() + 60_000)
    const cancelled = await cancelRoomReminder(f.store, f.room.id, entry.reminderId,
      { clientRequestId: 'c1', reason: 'user_cancelled', expectedRevision: updated.revision })
    expect(cancelled).toMatchObject({ status: 'cancelled', endedReason: 'user_cancelled' })
    // Ended reminders are immutable; cancelling again is idempotent.
    expect(await cancelRoomReminder(f.store, f.room.id, entry.reminderId,
      { clientRequestId: 'c2', reason: 'agent_cancelled' })).toMatchObject({ status: 'cancelled', endedReason: 'user_cancelled' })
    await expect(updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'u2', note: 'x' }))
      .rejects.toThrow('scheduled')
    const second = await f.reminder({}, 'two')
    await expect(cancelRoomReminder(f.store, f.room.id, second.reminderId,
      { clientRequestId: 'c3', reason: 'user_cancelled', expectedRevision: second.revision + 9 })).rejects.toThrow('changed')
  })
})

describe('fireDueRoomReminders', () => {
  const requests = async (f: Awaited<ReturnType<typeof fixture>>) =>
    f.store.list<RoomRequestState>('request', { roomId: f.room.id })
  const presentations = async (f: Awaited<ReturnType<typeof fixture>>) =>
    (await f.store.list<RoomMessage>('message', { roomId: f.room.id }))
      .filter((row) => row.value.presentationKind === 'reminder')

  it('fires a due reminder once: presentation plus pending private wake request', async () => {
    const f = await fixture()
    const entry = await f.reminder({ fireAt: new Date(Date.now() - 1000).toISOString() })
    const now = new Date().toISOString()
    await fireDueRoomReminders(f.deps, f.service, now)
    const fired = await readRoomReminder(f.store, f.room.id, entry.reminderId)
    expect(fired).toMatchObject({ status: 'fired', firedAt: now, firedRequestId: 'reminder-fire:' + entry.reminderId })
    const wake = (await requests(f)).find((row) => row.id === fired.firedRequestId)
    expect(wake?.value).toMatchObject({
      privateProtocol: 'direct-v1', status: 'pending', roomId: f.room.id,
      privateReminder: { reminderId: entry.reminderId, chainDepth: 0, scheduledFor: entry.fireAt, lateSeconds: 1 } })
    const message = (await presentations(f))[0]
    expect(message.value).toMatchObject({ presentationKind: 'reminder', reminderId: entry.reminderId,
      authorKind: 'system', body: 'Check on the user request' })
    expect(wake?.value.sourceMessageId).toBe(message.id)
    expect(wake?.value.roomSnapshot.conversationKind).toBe('user_agent')
    // Replay (as after a restart) never duplicates effects.
    await fireDueRoomReminders(f.deps, f.service, now)
    await fireDueRoomReminders(f.deps, f.service, new Date(Date.now() + 1000).toISOString())
    expect(await presentations(f)).toHaveLength(1)
    expect((await requests(f)).filter((row) => row.id === fired.firedRequestId)).toHaveLength(1)
  })

  it('leaves future reminders scheduled and expires cancelled or unavailable targets without a wake', async () => {
    const f = await fixture()
    const future = await f.reminder({ fireAt: new Date(Date.now() + 3600_000).toISOString() }, 'future')
    const cancelled = await f.reminder({}, 'cancelled')
    await cancelRoomReminder(f.store, f.room.id, cancelled.reminderId, { clientRequestId: 'cx', reason: 'agent_cancelled' })
    await fireDueRoomReminders(f.deps, f.service, new Date().toISOString())
    expect((await readRoomReminder(f.store, f.room.id, future.reminderId)).status).toBe('scheduled')
    expect((await readRoomReminder(f.store, f.room.id, cancelled.reminderId)).status).toBe('cancelled')
    expect(await requests(f)).toHaveLength(0)
    expect(await presentations(f)).toHaveLength(0)
  })

  it('expires reminders that are too late with a notification but no wake', async () => {
    const f = await fixture()
    const late = await f.reminder({ fireAt: new Date(Date.now() - (ROOM_REMINDER_LIMITS.maxLatenessSec + 60) * 1000).toISOString() }, 'late')
    await fireDueRoomReminders(f.deps, f.service, new Date().toISOString())
    const expired = await readRoomReminder(f.store, f.room.id, late.reminderId)
    expect(expired).toMatchObject({ status: 'expired', endedReason: 'too_late' })
    expect(await requests(f)).toHaveLength(0)
    expect(await presentations(f)).toHaveLength(1)
    // Seven days late is still valid and wakes normally.
    const valid = await f.reminder({ fireAt: new Date(Date.now() - 300_000).toISOString() }, 'valid')
    await fireDueRoomReminders(f.deps, f.service, new Date().toISOString())
    expect((await readRoomReminder(f.store, f.room.id, valid.reminderId)).status).toBe('fired')
    expect(await requests(f)).toHaveLength(1)
  })

  it('expires instead of firing when the room, member or agent is gone', async () => {
    const f = await fixture()
    const past = new Date(Date.now() - 1000).toISOString()
    const gone = await f.reminder({ fireAt: past }, 'gone')
    const roomRow = (await f.store.get<Room>('room', f.room.id))!
    await f.store.commit({ requestId: 'archive-room', checks: [{ kind: 'room', id: f.room.id, expectedRevision: roomRow.revision }],
      puts: [{ kind: 'room', id: f.room.id, roomId: f.room.id,
        value: { ...roomRow.value, archivedAt: new Date().toISOString() } }] })
    await fireDueRoomReminders(f.deps, f.service, new Date().toISOString())
    expect(await readRoomReminder(f.store, f.room.id, gone.reminderId))
      .toMatchObject({ status: 'expired', endedReason: 'room_archived' })
    expect(await requests(f)).toHaveLength(0)
    expect(await presentations(f)).toHaveLength(0)
    const g = await fixture()
    const stale = await g.reminder({ fireAt: past }, 'stale')
    const row = (await g.store.get<Room>('room', g.room.id))!
    const members = row.value.members.map((member) => member.id === g.memberId ? { ...member, enabled: false } : member)
    await g.store.commit({ requestId: 'disable-member', checks: [{ kind: 'room', id: g.room.id, expectedRevision: row.revision }],
      puts: [{ kind: 'room', id: g.room.id, roomId: g.room.id, value: { ...row.value, members } }] })
    await fireDueRoomReminders(g.deps, g.service, new Date().toISOString())
    expect(await readRoomReminder(g.store, g.room.id, stale.reminderId))
      .toMatchObject({ status: 'expired', endedReason: 'agent_unavailable' })
    const h2 = await fixture()
    const orphan = await h2.reminder({ fireAt: past }, 'orphan')
    const agent = (await h2.store.get<AgentIdentity>('agent_identity', h2.created.agentId))!
    await h2.store.commit({ requestId: 'archive-agent', checks: [{ kind: 'agent_identity', id: agent.id, expectedRevision: agent.revision }],
      puts: [{ kind: 'agent_identity', id: agent.id, value: { ...agent.value, archivedAt: new Date().toISOString() } }] })
    await fireDueRoomReminders(h2.deps, h2.service, new Date().toISOString())
    expect(await readRoomReminder(h2.store, h2.room.id, orphan.reminderId))
      .toMatchObject({ status: 'expired', endedReason: 'agent_unavailable' })
  })
})

describe('reminder conversation tools', () => {
  let conversationSeq = 0
  async function conversation(f: Awaited<ReturnType<typeof fixture>>, options: { chainDepth?: number } = {}) {
    const workspace = join(f.root, 'agent-workspace')
    const clientRequestId = 'turn-' + (conversationSeq += 1)
    const thread = await f.h.threads.create({ title: 'Agent', workspace, model: 'fake', mode: 'agent', sandboxMode: 'workspace-write' }, {
      roomContext: { roomId: f.room.id, memberId: f.memberId, participantAgentId: f.created.agentId,
        kind: 'conversation', allowedToolNames: ['send_im_message'],
        blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } })
    const queued = await f.h.turns.enqueueTurn({ threadId: thread.id,
      request: { prompt: 'schedule me', clientRequestId } })
    const fresh = (await f.h.threadStore.get(thread.id))!
    await f.h.threadStore.upsert({ ...fresh, turns: fresh.turns.map((turn) =>
      turn.id === queued.turnId ? { ...turn, status: 'running' } : turn) })
    if (options.chainDepth !== undefined) {
      const wakeRequestId = 'req-wake-' + conversationSeq
      await f.store.commit({ requestId: 'wake-request-' + conversationSeq,
        checks: [{ kind: 'request', id: wakeRequestId, expectedRevision: null }],
        puts: [{ kind: 'request', id: wakeRequestId, roomId: f.room.id, value: {
          id: wakeRequestId, roomId: f.room.id, status: 'running', roomSnapshot: f.room, threadId: thread.id,
          message: { clientRequestId: 'wake', body: 'wake', mentionMemberIds: [], attachmentIds: [] },
          sourceMessageId: 'presentation',
          privateReminder: { reminderId: 'reminder-old', chainDepth: options.chainDepth,
            scheduledFor: new Date().toISOString(), lateSeconds: 0 } } }] })
    }
    await prepareRoomRun(f.deps, (await f.h.threadStore.get(thread.id))!, clientRequestId, 'schedule me', [],
      { phase: 'conversation', ...(options.chainDepth !== undefined ? { requestId: 'req-wake-' + conversationSeq } : {}) })
    await updateRoomRun(f.store, roomRunId(f.room.id, clientRequestId), { turnId: queued.turnId, status: 'running' })
    const tools = roomReminderTools(f.h.threadStore)
    const context: ToolHostContext = applyRoomToolPolicy({
      threadId: thread.id, turnId: queued.turnId, workspace, sandboxMode: 'read-only', approvalPolicy: 'auto',
      threadMode: 'plan', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow',
      activeToolCallId: 'call-1' }, fresh)
    return { thread, tools, context }
  }

  it('advertises only for private agent conversation turns', async () => {
    const f = await fixture()
    const { tools, context } = await conversation(f)
    expect(context.roomStepKind).toBe('conversation')
    expect(context.roomAgent).toBe(true)
    for (const tool of tools) {
      expect(tool.shouldAdvertise?.(context)).toBe(true)
      expect(tool.shouldAdvertise?.({ ...context, roomStepKind: 'discussion' })).toBe(false)
      expect(tool.shouldAdvertise?.({ ...context, roomAgent: false })).toBe(false)
    }
    expect(context.allowedToolNames).toEqual(expect.arrayContaining([...ROOM_REMINDER_TOOL_NAMES]))
  })

  it('schedules, lists, updates and cancels through the bound agent identity only', async () => {
    const f = await fixture()
    const { tools, context } = await conversation(f)
    const byName = (name: string) => tools.find((tool) => tool.name === name)!
    const scheduled = await byName('schedule_reminder').execute({ note: 'Follow up on the draft', delaySeconds: 600 }, context)
    expect(scheduled).toMatchObject({ output: { accepted: true } })
    const reminderId = (scheduled.output as { reminderId: string }).reminderId
    const entry = await readRoomReminder(f.store, f.room.id, reminderId)
    expect(entry).toMatchObject({ participantAgentId: f.created.agentId, memberId: f.memberId, chainDepth: 0 })
    // Identity is host-derived: spoofed fields are rejected by the strict schema.
    expect(await byName('schedule_reminder').execute({ note: 'x', delaySeconds: 60, memberId: 'other' }, context))
      .toMatchObject({ isError: true })
    const listed = await byName('list_reminders').execute({}, context)
    expect((listed.output as { reminders: unknown[] }).reminders).toHaveLength(1)
    expect(await byName('update_reminder').execute({ reminderId, note: 'new note' }, context))
      .toMatchObject({ output: { accepted: true } })
    expect((await readRoomReminder(f.store, f.room.id, reminderId)).note).toBe('new note')
    expect(await byName('cancel_reminder').execute({ reminderId }, context))
      .toMatchObject({ output: { accepted: true, status: 'cancelled' } })
    expect((await readRoomReminder(f.store, f.room.id, reminderId)).endedReason).toBe('agent_cancelled')
    // A foreign reminder cannot be touched. It belongs to another agent, so it
    // is seeded directly — the create path itself would reject the mismatch.
    const foreignAt = new Date().toISOString()
    const foreignValue = RoomReminderSchema.parse({ schemaVersion: 1, reminderId: 'foreign-reminder',
      roomId: f.room.id, participantAgentId: 'agent-foreign', memberId: f.memberId, note: 'not yours',
      fireAt: new Date(Date.now() + 3600_000).toISOString(), status: 'scheduled', chainDepth: 0,
      createdByRunId: 'r', createdAt: foreignAt, updatedAt: foreignAt })
    await f.store.commit({ requestId: 'seed-foreign',
      checks: [{ kind: 'room_reminder', id: foreignValue.reminderId, expectedRevision: null }],
      puts: [{ kind: 'room_reminder', id: foreignValue.reminderId, roomId: f.room.id, value: foreignValue }] })
    const foreign = { reminderId: foreignValue.reminderId }
    expect(await byName('cancel_reminder').execute({ reminderId: foreign.reminderId }, context))
      .toMatchObject({ isError: true, output: { error: expect.stringContaining('own agent') } })
    expect(await byName('update_reminder').execute({ reminderId: foreign.reminderId, note: 'x' }, context))
      .toMatchObject({ isError: true })
  })

  it('rejects scheduling beyond the follow-up chain depth and when the feature is off', async () => {
    const f = await fixture()
    const deep = await conversation(f, { chainDepth: ROOM_REMINDER_LIMITS.maxChainDepth })
    const schedule = deep.tools.find((tool) => tool.name === 'schedule_reminder')!
    expect(await schedule.execute({ note: 'again', delaySeconds: 600 }, deep.context))
      .toMatchObject({ isError: true, output: { error: expect.stringContaining('chain') } })
    const shallow = await conversation(f)
    const features = await f.store.get<{ reminders?: boolean }>('agent_features', 'features')
    await f.store.commit({ requestId: 'features-off',
      checks: [{ kind: 'agent_features', id: 'features', expectedRevision: features?.revision ?? null }],
      puts: [{ kind: 'agent_features', id: 'features',
        value: { identities: true, memory: true, collaboration: true, proposals: true, reminders: false } }] })
    const shallowSchedule = shallow.tools.find((tool) => tool.name === 'schedule_reminder')!
    expect(await shallowSchedule.execute({ note: 'x', delaySeconds: 600 }, shallow.context))
      .toMatchObject({ isError: true, output: { error: expect.stringContaining('disabled') } })
    const shallowList = shallow.tools.find((tool) => tool.name === 'list_reminders')!
    expect(await shallowList.execute({}, shallow.context))
      .toMatchObject({ isError: true, output: { error: expect.stringContaining('disabled') } })
  })
})

describe('reminder wake input', () => {
  it('frames the fired reminder as reference context, not a new user instruction', async () => {
    const f = await fixture()
    const anchor = await f.service.send(f.room.id, { clientRequestId: 'anchor', body: 'Original request text' })
    const entry = await f.reminder({ note: 'Revisit the earlier answer',
      anchorMessageId: anchor.message.id, fireAt: new Date(Date.now() - 5000).toISOString() })
    await fireDueRoomReminders(f.deps, f.service, new Date().toISOString())
    const row = (await f.store.get<RoomRequestState>('request', 'reminder-fire:' + entry.reminderId))!
    const runner = new AgentDirectRunner(f.deps, f.service)
    await runner.tick(row)
    const input = (await f.store.get<RoomRequestState>('request', row.id))!.value.privateInput!
    expect(input).toContain('Scheduled reminder you created earlier')
    expect(input).toContain('not a new user instruction')
    expect(input).toContain('Revisit the earlier answer')
    expect(input).toContain('seconds late')
    expect(input).toContain('Original request text'.slice(0, 1500))
    expect(input).not.toContain('User message:\n')
  })
})
