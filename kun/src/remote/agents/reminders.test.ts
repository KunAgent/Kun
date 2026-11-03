import { expect, it, vi } from 'vitest'
import { RoomReminderSchema, type RoomReminder } from '../../contracts/room-reminders.js'
import { createRoomReminder, cancelRoomReminder, fireDueRoomReminders, readRoomReminder, updateRoomReminder } from '../../rooms/room-reminders.js'
import { interactionId } from '../../rooms/room-interaction-store.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import type { RoomRequestState } from '../../rooms/room-runtime-types.js'
import { REMOTE_REMINDER_RESUME } from '../../rooms/room-reminder-remote-control.js'
import { agentHistoryFixture } from './memory/history.test-support.js'
import { receiptKey } from '../requests/receipts.js'
import { AgentParamSchemas } from './service.js'
async function fixture() {
  const f = await agentHistoryFixture(), member = f.room.members.find((entry) => entry.participantAgentId === f.agent.id)!
  async function create(id = 'reminder', overrides: Partial<RoomReminder> = {}) {
    return createRoomReminder(f.store, { clientRequestId: id, roomId: f.room.id, participantAgentId: f.agent.id,
      memberId: member.id, note: 'PERSONAL_REMINDER_TEXT', anchorMessageId: f.source.id,
      fireAt: new Date(Date.now() + 3600000).toISOString(), chainDepth: 0, createdByRunId: 'private-run',
      clientSurface: 'gui', ...overrides })
  }
  return { ...f, create, params: (entry: { reminderId: string; revision: number }, action: string) => ({
    agentId: f.agent.id, reminderId: entry.reminderId, expectedRevision: entry.revision, action }) }
}

it('executes both reminder contracts through the real installed SDK and facade', async () => {
  const f = await fixture()
  try {
    const entry = await f.create(), call = (method: string, params: unknown, id?: string) =>
      f.facade.execute(f.envelope(method, params, id)) as Promise<any>
    const list = await call('agent.reminders.list', { agentId: f.agent.id })
    expect(list.reminders[0].id).toBe(entry.reminderId)
    const paused = await call('agent.reminders.act', f.params(entry, 'pause'), 'facade-pause')
    expect(paused.receipt).toMatchObject({ status: 'applied', result: { reminder: { status: 'paused' } } })
    expect(JSON.stringify(paused)).not.toContain(entry.note)
    expect((await call('request.get', { requestId: 'facade-pause' })).receipt).toEqual(paused.receipt)
    const catalog = await call('catalog.get', {})
    expect(catalog.capabilityDescriptors.filter((item: any) => item.operation.startsWith('agent.reminders.'))).toHaveLength(2)
  } finally { await f.close() }
})

it('lists only this personal Agent reminders and keeps schedule timezone/rules without leaking routing details', async () => {
  const f = await fixture()
  try {
    const entry = await f.create('rules', { timezone: 'America/New_York', recurrence: { kind: 'weekly', localTime: '09:00', weekdays: [1, 3] },
      quietHours: { start: '22:00', end: '08:00' }, trigger: { kind: 'message', authorKind: 'user', contains: 'ready' },
      imConnectionId: 'PRIVATE_IM_ROUTING', dedupKey: 'PRIVATE_DEDUP' })
    await f.create('second')
    const page = await f.call('agent.reminders.list', { agentId: f.agent.id, limit: 1 })
    expect(page).toMatchObject({ hasMore: true, complete: false, enabled: true })
    const next = await f.call('agent.reminders.list', { agentId: f.agent.id, limit: 1, cursor: page.nextCursor })
    expect(next.reminders[0]).toMatchObject({ id: entry.reminderId, timezone: 'America/New_York', recurrence: entry.recurrence,
      quietHours: entry.quietHours, trigger: entry.trigger, noteTruncated: false, noteTotalChars: entry.note.length })
    expect(next).toMatchObject({ hasMore: false, complete: true })
    const text = JSON.stringify(next)
    for (const hidden of ['PRIVATE_IM_ROUTING', 'PRIVATE_DEDUP', 'createdByRunId', 'firedRequestId', 'clientSurface', 'remoteDeviceId']) expect(text).not.toContain(hidden)
    await expect(f.call('agent.reminders.list', { agentId: f.agent.id, status: 'all', cursor: page.nextCursor })).rejects.toThrow('INVALID_CURSOR')
    const room = (await f.store.get<any>('room', f.room.id))!
    await putRoomDocument(f.store, 'room', room.id, room.id, { ...room.value, conversationKind: 'agent_agent' }, room)
    expect((await f.call('agent.reminders.list', { agentId: f.agent.id })).reminders).toEqual([])
    expect((await f.call('agent.reminders.act', f.params(entry, 'pause'))).error?.code).toBe('INVALID_REQUEST')
  } finally { await f.close() }
})
it('binds both CAS and explicit action, isolates installations and rejects caller-controlled surface or timing fields', async () => {
  const f = await fixture()
  try {
    const entry = await f.create(), params = f.params(entry, 'pause')
    const outcomes = await Promise.all([f.call('agent.reminders.act', params, 'same', 'phone-a'), f.call('agent.reminders.act', f.params(entry, 'cancel'), 'same', 'phone-b')])
    expect(outcomes.filter((value) => value.status === 'applied')).toHaveLength(1)
    expect(outcomes.find((value) => value.error)?.error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })
    for (const patch of [{ expectedRevision: undefined }, { expectedRevision: null }, { expectedRevision: -1 }, { note: 'overwritten' },
      { clientSurface: 'gui' }, { remoteDeviceId: 'forged' }, { fireAt: new Date().toISOString() }, { timezone: 'UTC' }, { roomId: 'group' }])
      expect(() => AgentParamSchemas['agent.reminders.act'].parse({ ...params, ...patch })).toThrow()
    const other = (await f.rooms.agents.create({ clientRequestId: 'other', name: 'Other' })).agent
    expect((await f.call('agent.reminders.act', { ...params, agentId: other.id })).error?.code).toBe('NOT_FOUND')
  } finally { await f.close() }
})
it('atomically narrows a remote resume to API and records its device before a future native wake', async () => {
  const f = await fixture()
  try {
    const entry = await f.create('api-resume', { fireAt: new Date(Date.now() - 60000).toISOString(), clientSurface: 'im', imConnectionId: 'old-channel' })
    const paused = await updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'desktop-pause', expectedRevision: entry.revision, paused: true })
    const before = Date.now(), resumed = await f.call('agent.reminders.act', f.params(paused, 'resume'), 'resume', 'real-phone')
    expect(resumed.status).toBe('applied')
    expect(Date.parse(resumed.result.reminder.fireAt)).toBeGreaterThanOrEqual(before + 60000)
    const saved = await readRoomReminder(f.store, f.room.id, entry.reminderId)
    expect(saved).toMatchObject({ clientSurface: 'api', remoteDeviceId: 'real-phone', status: 'scheduled', note: entry.note })
    expect(saved.imConnectionId).toBeUndefined()
    await fireDueRoomReminders(f.rooms.deps, f.rooms.service, saved.fireAt)
    const requests = await f.store.list<RoomRequestState>('request', { roomId: f.room.id, limit: 100 })
    expect(requests.find((row) => row.value.privateReminder?.reminderId === entry.reminderId)?.value).toMatchObject({ clientSurface: 'api', remoteDeviceId: 'real-phone' })
    expect(JSON.stringify(resumed)).not.toContain(entry.note)
  } finally { await f.close() }
})
it('preserves ordinary desktop resume surface and prevents serialized JSON from forging the internal override', async () => {
  const f = await fixture()
  try {
    const entry = await f.create('desktop'), paused = await updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'pause', paused: true })
    const resumed = await updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'resume', expectedRevision: paused.revision, paused: false })
    expect(resumed.clientSurface).toBe('gui'); expect(resumed.remoteDeviceId).toBeUndefined()
    const parsed = JSON.parse(JSON.stringify({ clientRequestId: 'json', paused: false, [REMOTE_REMINDER_RESUME]: { deviceId: 'forged' } }))
    expect(parsed[REMOTE_REMINDER_RESUME]).toBeUndefined()
    const pausedAgain = await updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'pause-again', expectedRevision: resumed.revision, paused: true })
    const path = '/v1/rooms/' + f.room.id + '/reminders/' + entry.reminderId + '/resume', route = f.router.match('POST', path)!
    const denied = await route.handler(new Request('http://runtime' + path, { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId: 'forged-http', expectedRevision: pausedAgain.revision, clientSurface: 'gui', remoteDeviceId: 'forged' }) }), { params: route.params })
    expect(denied.status).toBe(400)
    expect(await readRoomReminder(f.store, f.room.id, entry.reminderId)).toMatchObject({ clientSurface: 'gui', status: 'paused', revision: pausedAgain.revision })
  } finally { await f.close() }
})
it('never exposes deleted private reminder text through the new applied remote receipt', async () => {
  const f = await fixture()
  try {
    const entry = await f.create('private', { trigger: { kind: 'message', authorKind: 'user', contains: 'PRIVATE_CONDITION_TEXT' } })
    await f.call('agent.reminders.act', f.params(entry, 'pause'), 'safe-receipt')
    const room = (await f.store.get<any>('room', f.room.id))!
    await putRoomDocument(f.store, 'room', room.id, room.id, { ...room.value, deletedAt: new Date().toISOString() }, room)
    expect((await f.call('agent.reminders.list', { agentId: f.agent.id })).reminders).toEqual([])
    const response = await f.facade.execute(f.envelope('request.get', { requestId: 'safe-receipt' })) as any
    expect(response.receipt.status).toBe('applied')
    expect(response.receipt.result.reminder).toMatchObject({ id: entry.reminderId, status: 'paused' })
    expect(JSON.stringify(response)).not.toContain(entry.note)
    expect(JSON.stringify(response)).not.toContain('PRIVATE_CONDITION_TEXT')
    expect(response.receipt.result.reminder).not.toHaveProperty('source')
  } finally { await f.close() }
})
it('recovers only native proofs after lost acknowledgements, never status equality or a second mutation', async () => {
  const f = await fixture()
  try {
    const entry = await f.create(), params = f.params(entry, 'pause'), original = f.store.commit.bind(f.store)
    const commit = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      const result = await original(input)
      if (input.requestId.startsWith('reminder-update-')) throw new Error('native acknowledgement lost')
      return result
    })
    const unknown = await f.call('agent.reminders.act', params, 'pause-once')
    commit.mockRestore()
    expect(unknown.status).toBe('reconciliation_required'); expect(unknown.error).toBeUndefined()
    const envelope = f.envelope('agent.reminders.act', params, 'pause-once')
    const recovered = await f.agents.recover(envelope, unknown)
    expect(recovered).toMatchObject({ reminder: { status: 'paused', revision: 1 } })
    expect(await f.agents.recover({ ...envelope, deviceId: 'other-phone' }, unknown)).toBeUndefined()
    expect((await f.call('agent.reminders.act', params, 'pause-once')).status).toBe('reconciliation_required')
    expect((await readRoomReminder(f.store, f.room.id, entry.reminderId)).revision).toBe(1)
  } finally { await f.close() }
})
it('commits an exact no-op cancel proof and refuses stale revision even when current state is already cancelled', async () => {
  const f = await fixture()
  try {
    const entry = await f.create(), cancelled = await cancelRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'desktop', expectedRevision: entry.revision, reason: 'user_cancelled' })
    const before = await f.store.latestEventSeq!()
    const result = await f.call('agent.reminders.act', f.params(cancelled, 'cancel'), 'noop')
    expect(result.status).toBe('applied'); expect(result.result.reminder.revision).toBe(cancelled.revision)
    const key = interactionId('reminder-cancel', f.room.id, entry.reminderId, receiptKey(f.envelope('', {}), 'noop'))
    expect((await f.store.getRequest(key))?.result).toMatchObject({ reminderId: entry.reminderId, revision: cancelled.revision })
    expect(await f.store.latestEventSeq!()).toBe(before)
    expect((await f.call('agent.reminders.act', f.params(entry, 'cancel'), 'stale')).error?.code).toBe('REVISION_CONFLICT')
    expect((await readRoomReminder(f.store, f.room.id, entry.reminderId)).revision).toBe(cancelled.revision)
  } finally { await f.close() }
})
it('retains cleanup controls when reminders are disabled and makes clipped legacy notes explicitly read-only', async () => {
  const f = await fixture()
  try {
    const entry = await f.create(), paused = (await f.call('agent.reminders.act', f.params(entry, 'pause'))).result.reminder
    const features = await f.store.get('agent_features', 'features')
    await putRoomDocument(f.store, 'agent_features', 'features', f.room.id, { reminders: false }, features)
    const page = await f.call('agent.reminders.list', { agentId: f.agent.id })
    expect(page.enabled).toBe(false); expect(page.reminders[0]).toMatchObject({ canResume: false, canCancel: true })
    expect((await f.call('agent.reminders.act', { agentId: f.agent.id, reminderId: entry.reminderId, expectedRevision: paused.revision, action: 'resume' })).error?.code).toBe('AGENT_NOT_AVAILABLE')
    const row = (await f.store.get<RoomReminder>('room_reminder', entry.reminderId))!
    await putRoomDocument(f.store, 'room_reminder', row.id, f.room.id, { ...row.value, note: 'x'.repeat(1100) }, row)
    const clipped = (await f.call('agent.reminders.list', { agentId: f.agent.id })).reminders[0]
    expect(clipped).toMatchObject({ noteTruncated: true, noteTotalChars: 1100, canPause: false, canResume: false, canCancel: false })
    expect(clipped.note.length).toBe(1000)
  } finally { await f.close() }
})
it('refuses remote resume past expiry or occurrence limits without changing ordinary desktop behavior', async () => {
  const f = await fixture()
  try {
    for (const [index, patch] of [{ expiresAt: new Date(Date.now() - 1000).toISOString() }, { maxOccurrences: 1, occurrence: 1 }].entries()) {
      const entry = await f.create('ended-policy-' + index), row = (await f.store.get<RoomReminder>('room_reminder', entry.reminderId))!
      await putRoomDocument(f.store, 'room_reminder', row.id, f.room.id, RoomReminderSchema.parse({ ...row.value, status: 'paused', ...patch }), row)
      const page = await f.call('agent.reminders.list', { agentId: f.agent.id }), item = page.reminders.find((reminder: any) => reminder.id === entry.reminderId)
      expect(item).toMatchObject({ canResume: false, canCancel: true })
      const denied = await f.call('agent.reminders.act', { agentId: f.agent.id, reminderId: entry.reminderId, expectedRevision: item.revision, action: 'resume' })
      expect(denied.error).toEqual({ code: 'INVALID_REQUEST', definitive: true })
      expect((await readRoomReminder(f.store, f.room.id, entry.reminderId)).revision).toBe(item.revision)
      const desktop = await updateRoomReminder(f.store, f.room.id, entry.reminderId, { clientRequestId: 'desktop-' + index, expectedRevision: item.revision, paused: false })
      expect(desktop.status).toBe('scheduled'); expect(desktop.clientSurface).toBe('gui')
    }
  } finally { await f.close() }
})
it('keeps old active rows reachable behind ended history without using the unbounded native list', async () => {
  const f = await fixture()
  try {
    const entry = await f.create()
    const { revision: _revision, ...base } = entry
    const records = Array.from({ length: 120 }, (_, index) => RoomReminderSchema.parse({ ...base,
      reminderId: 'old-ended-' + index, status: 'fired' }))
    await f.store.commit({ requestId: 'seed-ended',
      checks: records.map((value) => ({ kind: 'room_reminder', id: value.reminderId, expectedRevision: null })),
      puts: records.map((value) => ({ kind: 'room_reminder', id: value.reminderId, roomId: f.room.id, value })) })
    const page = await f.call('agent.reminders.list', { agentId: f.agent.id })
    expect(page.reminders.map((item: any) => item.id)).toEqual([entry.reminderId])
    expect(page).toMatchObject({ hasMore: false, complete: true })
  } finally { await f.close() }
})
