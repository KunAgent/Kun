import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROOM_REMINDER_LIMITS, RoomReminderSchema } from '../contracts/room-reminders.js'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomService } from './room-service.js'
import { AgentIdentityService } from '../agents/agent-identity-service.js'
import { quickCreateAgent } from '../agents/agent-chat-entry.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import { createRoomReminder, updateRoomReminder, cancelRoomReminder, readRoomReminder, listRoomReminders, fireDueRoomReminders } from './room-reminders.js'
import { nextReminderOccurrence, quietHoursEnd, reminderFireAt, validateReminderOptions } from './room-reminder-schedule.js'
import { registerRoomReminderRoutes } from '../server/routes/register-room-reminder-routes.js'
import type { RoomRuntime } from './room-runtime.js'
import type { RouteContext } from '../server/router.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'room-schedules-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const service = new RoomService(store, vi.fn())
  const agents = new AgentIdentityService(store, () => ({}))
  service.setAgentDirectory(agents)
  const h = makeHarness(makeFakeModel([]))
  const deps: RoomRuntimeDeps = { dataDir: root, store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), model: () => ({ model: 'fake', providerId: 'test' }),
    profiles: () => ({}), agentDirectory: agents, assertOwnership: async () => {} }
  const created = await quickCreateAgent(agents, { clientRequestId: 'agent' }, true)
  const room = await service.get(created.roomId)
  const reminder = (overrides: Record<string, unknown> = {}, clientRequestId = 'schedule') => createRoomReminder(store, {
    clientRequestId, roomId: room.id, participantAgentId: created.agentId, memberId: room.defaultMemberId!,
    note: 'Check current context', fireAt: new Date(Date.now() + 3600_000).toISOString(),
    chainDepth: 0, createdByRunId: 'run-1', ...overrides })
  const read = (id: string) => readRoomReminder(store, room.id, id)
  const tick = (now = new Date().toISOString()) => fireDueRoomReminders(deps, service, now)
  const wakes = async () => (await store.list<RoomRequestState>('request', { roomId: room.id, limit: 1000 }))
    .filter((row) => row.value.privateReminder)
  cleanups.push(async () => { await h.turns.interruptActiveTurns(); await store.close(); await rm(root, { recursive: true, force: true }) })
  return { root, store, service, agents, deps, created, room, reminder, read, tick, wakes }
}

async function seedFires(f: Awaited<ReturnType<typeof fixture>>, at: string, count = 24) {
  for (let index = 0; index < count; index++) {
    const id = 'seed-' + index
    const value = RoomReminderSchema.parse({ schemaVersion: 1, reminderId: id, roomId: f.room.id,
      participantAgentId: f.created.agentId, memberId: f.room.defaultMemberId, note: 'seed',
      fireAt: at, firedAt: at, status: 'fired', chainDepth: 0, createdByRunId: 'run', createdAt: at, updatedAt: at })
    await f.store.commit({ requestId: id, checks: [{ kind: 'room_reminder', id, expectedRevision: null }], puts: [{ kind: 'room_reminder', id, roomId: f.room.id, value }] })
  }
}

const clock = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)) }
describe('timezone-aware reminder schedules', () => {
  it('validates explicit IANA zones and concrete schedule fields', () => {
    expect(() => validateReminderOptions({ recurrence: { kind: 'interval', everySeconds: 3600 } })).toThrow('explicit')
    expect(() => validateReminderOptions({ timezone: 'not/a/zone' })).toThrow('IANA')
    expect(() => validateReminderOptions({ timezone: 'UTC', quietHours: { start: '22:00', end: '22:00' } })).toThrow('different')
    expect(() => validateReminderOptions({ timezone: 'UTC', recurrence: { kind: 'interval', everySeconds: 1 } })).toThrow()
    expect(validateReminderOptions({})).toEqual({ timezone: 'UTC' })
  })
  it('keeps local daily time across spring DST, skips gaps, and emits folds only once', () => {
    const base = { timezone: 'America/New_York', fireAt: '2026-03-07T14:00:00.000Z' }
    expect(nextReminderOccurrence({ ...base, recurrence: { kind: 'daily', localTime: '09:00' } }, base.fireAt))
      .toBe('2026-03-08T13:00:00.000Z')
    expect(nextReminderOccurrence({ ...base, recurrence: { kind: 'daily', localTime: '02:30' } }, '2026-03-07T12:00:00.000Z'))
      .toBe('2026-03-09T06:30:00.000Z')
    expect(nextReminderOccurrence({ ...base, recurrence: { kind: 'daily', localTime: '01:30' } }, '2026-11-01T05:30:00.000Z'))
      .toBe('2026-11-02T06:30:00.000Z')
  })
  it('supports weekly local times and bounded interval initial scheduling', () => {
    const now = new Date('2026-09-30T00:00:00.000Z')
    expect(reminderFireAt({ recurrence: { kind: 'weekly', localTime: '09:00', weekdays: [1] }, timezone: 'Asia/Tokyo' }, now))
      .toBe('2026-10-05T00:00:00.000Z')
    expect(reminderFireAt({ recurrence: { kind: 'interval', everySeconds: 3600 }, timezone: 'UTC' }, now))
      .toBe('2026-09-30T01:00:00.000Z')
    expect(reminderFireAt({ trigger: { kind: 'room_idle', idleSeconds: 600 } }, now))
      .toBe('2026-09-30T00:01:00.000Z')
  })
  it('defers overnight quiet hours using the schedule timezone', () => {
    const options = { timezone: 'America/New_York', quietHours: { start: '22:00', end: '08:00' } }
    expect(quietHoursEnd(options, '2026-03-08T05:00:00.000Z')).toBe('2026-03-08T12:00:00.000Z')
    expect(quietHoursEnd(options, '2026-03-08T12:00:00.000Z')).toBeUndefined()
  })
})

describe('durable recurring execution', () => {
  it('commits separate occurrence IDs, resumes after restart, and stops at the limit', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ timezone: 'UTC', recurrence: { kind: 'interval', everySeconds: 3600 },
      fireAt: '2026-09-30T11:59:00.000Z', maxOccurrences: 2 })
    expect(await f.tick()).toMatchObject({ fired: 1, nextFireAt: '2026-09-30T12:59:00.000Z' })
    expect(await f.read(entry.reminderId)).toMatchObject({ status: 'scheduled', occurrence: 1 })
    await f.tick()
    expect(await f.wakes()).toHaveLength(1)
    // A fresh service and persisted store state use the same occurrence identity.
    const restarted = new RoomService(f.store, vi.fn()); restarted.setAgentDirectory(f.agents)
    await fireDueRoomReminders(f.deps, restarted, '2026-09-30T12:59:00.000Z')
    expect(await f.read(entry.reminderId)).toMatchObject({ status: 'fired', occurrence: 2, endedReason: 'schedule_complete' })
    expect((await f.wakes()).map((row) => row.id).sort()).toEqual([
      'reminder-fire:' + entry.reminderId, 'reminder-fire:' + entry.reminderId + ':1'].sort())
    await f.tick('2026-10-01T00:00:00.000Z')
    expect(await f.wakes()).toHaveLength(2)
  })
  it('skips a stale recurrence backlog instead of replaying missed wakes', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ timezone: 'UTC', recurrence: { kind: 'daily', localTime: '09:00' },
      fireAt: '2026-09-01T09:00:00.000Z' })
    await f.tick()
    expect(await f.wakes()).toHaveLength(0)
    expect(await f.read(entry.reminderId)).toMatchObject({ status: 'scheduled', fireAt: '2026-10-01T09:00:00.000Z' })
  })
  it('persists quiet-hours deferral and fires after the window ends', async () => {
    clock('2026-09-30T23:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ timezone: 'UTC', quietHours: { start: '22:00', end: '08:00' },
      fireAt: '2026-09-30T22:59:00.000Z' })
    expect(await f.tick()).toEqual({ fired: 0, nextFireAt: '2026-10-01T08:00:00.000Z' })
    expect(await f.read(entry.reminderId)).toMatchObject({ deferredReason: 'quiet_hours' })
    await f.tick('2026-10-01T08:00:00.000Z')
    expect(await f.wakes()).toHaveLength(1)
  })
  it('ignores old messages, evaluates new matching events, and deduplicates repeated ticks', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    await f.service.send(f.room.id, { clientRequestId: 'old', body: 'Ready' })
    const entry = await f.reminder({ trigger: { kind: 'message', authorKind: 'user', contains: 'ready' },
      fireAt: '2026-09-30T11:59:00.000Z' })
    await f.tick()
    expect(await f.wakes()).toHaveLength(0)
    expect(await f.read(entry.reminderId)).toMatchObject({ deferredReason: 'condition_pending' })
    await f.service.send(f.room.id, { clientRequestId: 'new', body: 'READY for the next step' })
    await f.tick('2026-09-30T12:01:00.000Z')
    await f.tick('2026-09-30T12:02:00.000Z')
    expect(await f.wakes()).toHaveLength(1)
  })
  it('checks current inactivity and expires unmet conditions without waking', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ trigger: { kind: 'room_idle', idleSeconds: 600 },
      fireAt: '2026-09-30T11:59:00.000Z', expiresAt: '2026-09-30T12:05:00.000Z' })
    await f.service.send(f.room.id, { clientRequestId: 'current', body: 'Still here' })
    await f.tick()
    expect(await f.wakes()).toHaveLength(0)
    await f.tick('2026-09-30T12:05:00.000Z')
    expect(await f.read(entry.reminderId)).toMatchObject({ status: 'expired', endedReason: 'condition_expired' })
  })
  it('rechecks the feature flag at execution and resumes only when enabled', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ fireAt: '2026-09-30T11:59:00.000Z' })
    await f.store.commit({ requestId: 'off', checks: [{ kind: 'agent_features', id: 'features', expectedRevision: (await f.store.get('agent_features', 'features'))?.revision ?? null }], puts: [{ kind: 'agent_features', id: 'features', value: { reminders: false } }] })
    await f.tick()
    expect(await f.read(entry.reminderId)).toMatchObject({ deferredReason: 'feature_disabled' })
    expect(await f.wakes()).toHaveLength(0)
    await f.store.commit({ requestId: 'on', checks: [{ kind: 'agent_features', id: 'features', expectedRevision: (await f.store.get('agent_features', 'features'))!.revision }], puts: [{ kind: 'agent_features', id: 'features', value: { reminders: true } }] })
    await f.tick('2026-09-30T12:01:00.000Z')
    expect(await f.wakes()).toHaveLength(1)
  })
})

describe('schedule safety and controls', () => {
  it('enforces the fire budget when an outside-window reminder is moved into it', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ fireAt: '2026-10-02T12:00:00.000Z' })
    await seedFires(f, new Date().toISOString())
    await expect(updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'move', delaySeconds: 60 }))
      .rejects.toThrow('24 hour')
    expect((await f.read(entry.reminderId)).fireAt).toBe(entry.fireAt)
  })
  it('enforces a rolling budget at fire time and recovers after the window', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ fireAt: '2026-09-30T11:59:00.000Z' })
    await seedFires(f, new Date().toISOString())
    expect(await f.tick()).toEqual({ fired: 0, nextFireAt: '2026-10-01T12:00:00.000Z' })
    expect(await f.read(entry.reminderId)).toMatchObject({ deferredReason: 'fire_budget' })
    await f.tick('2026-10-01T12:00:00.000Z')
    expect(await f.wakes()).toHaveLength(1)
  })
  it('keeps recurring history in the rolling budget, even while the schedule remains active', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ timezone: 'UTC', recurrence: { kind: 'interval', everySeconds: 3600 },
      fireAt: '2026-09-30T11:59:00.000Z' })
    await seedFires(f, new Date().toISOString(), ROOM_REMINDER_LIMITS.maxFiresPer24h - 1)
    await f.tick()
    expect(await f.read(entry.reminderId)).toMatchObject({ status: 'scheduled', occurrence: 1 })
    await f.tick('2026-09-30T13:00:00.000Z')
    expect(await f.wakes()).toHaveLength(1)
    expect(await f.read(entry.reminderId)).toMatchObject({ deferredReason: 'fire_budget' })
  })
  it('serializes concurrent fires and concurrent dedup creation with CAS', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const results = await Promise.allSettled([f.reminder({ dedupKey: 'draft' }, 'a'), f.reminder({ dedupKey: 'draft' }, 'b')])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const entry = await f.reminder({ fireAt: '2026-09-30T11:59:00.000Z' }, 'due')
    await Promise.all([f.tick(), f.tick()])
    expect(await f.wakes()).toHaveLength(1)
    expect(await f.read(entry.reminderId)).toMatchObject({ status: 'fired' })
  })
  it('pauses, rejects stale revisions, resumes overdue work safely, and cancels paused work', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ fireAt: '2026-09-30T11:59:00.000Z', dedupKey: 'unique' })
    const paused = await updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'pause', paused: true })
    await f.tick()
    expect(await f.wakes()).toHaveLength(0)
    await expect(f.reminder({ dedupKey: 'unique' }, 'duplicate')).rejects.toThrow('dedupKey')
    await expect(updateRoomReminder(f.store, f.room.id, entry.reminderId,
      { clientRequestId: 'stale', paused: false, expectedRevision: entry.revision })).rejects.toThrow('changed')
    const resumed = await updateRoomReminder(f.store, f.room.id, entry.reminderId,
      { clientRequestId: 'resume', paused: false, expectedRevision: paused.revision })
    expect(resumed).toMatchObject({ status: 'scheduled', fireAt: '2026-09-30T12:01:00.000Z' })
    await updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'pause-again', paused: true })
    await cancelRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'cancel', reason: 'user_cancelled' })
    expect(await f.read(entry.reminderId)).toMatchObject({ status: 'cancelled' })
  })
  it('does not emit another wake after the occurrence limit is reduced to the completed count', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ timezone: 'UTC', recurrence: { kind: 'interval', everySeconds: 3600 },
      fireAt: '2026-09-30T11:59:00.000Z' })
    await f.tick()
    await updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'limit', maxOccurrences: 1 })
    await f.tick('2026-09-30T13:00:00.000Z')
    expect(await f.wakes()).toHaveLength(1)
    expect(await f.read(entry.reminderId)).toMatchObject({ endedReason: 'schedule_complete' })
  })

  it('keeps an old active reminder visible behind more than a thousand ended records', async () => {
    const f = await fixture(), active = await f.reminder()
    for (let offset = 0; offset < 1001; offset += 500) {
      const records = Array.from({ length: Math.min(500, 1001 - offset) }, (_, index) => {
        const { revision: _revision, ...value } = active
        return { ...value, reminderId: `history-${offset + index}`, status: 'cancelled' as const }
      })
      await f.store.commit({ requestId: `history-batch-${offset}`,
        checks: records.map((value) => ({ kind: 'room_reminder' as const, id: value.reminderId, expectedRevision: null })),
        puts: records.map((value) => ({ kind: 'room_reminder' as const, id: value.reminderId, roomId: f.room.id, value })) })
    }
    expect((await listRoomReminders(f.store, f.room.id, { status: 'all' }))[0].reminderId).toBe(active.reminderId)
  })

  it('recomputes edited daily times and wakes for expiry before a later occurrence', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ timezone: 'UTC', recurrence: { kind: 'daily', localTime: '14:00' } })
    const updated = await updateRoomReminder(f.store, f.room.id, entry.reminderId,
      { clientRequestId: 'edit-time', recurrence: { kind: 'daily', localTime: '16:00' }, expiresAt: '2026-09-30T15:00:00.000Z' })
    expect(updated.fireAt).toBe('2026-09-30T16:00:00.000Z')
    expect(await f.tick()).toEqual({ fired: 0, nextFireAt: '2026-09-30T15:00:00.000Z' })
    await f.tick('2026-09-30T15:00:00.000Z')
    expect(await f.read(entry.reminderId)).toMatchObject({ status: 'expired', endedReason: 'condition_expired' })
    expect(await f.wakes()).toHaveLength(0)
  })

  it('lets a concurrent pause win before committing a wake', async () => {
    clock('2026-09-30T12:00:00.000Z')
    const f = await fixture()
    const entry = await f.reminder({ fireAt: '2026-09-30T11:59:00.000Z' })
    const original = f.service.privateDirectRequest.bind(f.service)
    vi.spyOn(f.service, 'privateDirectRequest').mockImplementation(async (...args) => {
      const result = await original(...args)
      await updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'race', paused: true })
      return result
    })
    await f.tick()
    expect(await f.read(entry.reminderId)).toMatchObject({ status: 'paused' })
    expect(await f.wakes()).toHaveLength(0)
  })
  it('wires user pause/resume routes with room scoping and revision checks', async () => {
    const f = await fixture()
    const entry = await f.reminder()
    const handlers = new Map<string, Parameters<typeof registerRoomReminderRoutes>[0] extends
      (method: string, path: string, handler: infer H) => void ? H : never>()
    registerRoomReminderRoutes((_method, path, handler) => handlers.set(path, handler))
    const runtime = { service: f.service, deps: f.deps, exclusive: async (fn: () => Promise<unknown>) => fn(), wake: vi.fn() } as unknown as RoomRuntime
    const call = async (action: string, revision: number, roomId = f.room.id) => handlers.get(`/v1/rooms/:roomId/reminders/:reminderId/${action}`)!(
      runtime, new Request('http://local/', { method: 'POST', body: JSON.stringify({ clientRequestId: action + revision, expectedRevision: revision }) }),
      { params: { roomId, reminderId: entry.reminderId } } as unknown as RouteContext)
    expect(await call('pause', entry.revision)).toMatchObject({ status: 'paused' })
    await expect(call('resume', entry.revision)).rejects.toThrow('changed')
    expect(await call('resume', entry.revision + 1)).toMatchObject({ status: 'scheduled' })
    await expect(call('pause', entry.revision + 2, 'missing-room')).rejects.toThrow()
    expect(runtime.wake).toHaveBeenCalled()
  })
})
