import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { RoomReminderSchema, type RoomReminder, type RoomReminderEntry } from '../../contracts/room-reminders.js'
import { RoomStoreConflictError } from '../../rooms/room-store.js'
import { cancelRoomReminder, remindersEnabled, updateRoomReminder } from '../../rooms/room-reminders.js'
import { REMOTE_REMINDER_RESUME, reminderUpdateFingerprint } from '../../rooms/room-reminder-remote-control.js'
import { interactionFingerprint, interactionId } from '../../rooms/room-interaction-store.js'
import { requireAgent } from './access.js'
import { readableAgentRoom, libraryCursor, libraryPage } from './library/access.js'
import { memoryContentSlice } from './memory/content-window.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { ReminderParamSchemas } from './reminders-contracts.js'

function hasFutureOccurrence(r: RoomReminder) {
  return (!r.expiresAt || Date.parse(r.expiresAt) > Date.now()) &&
    (r.maxOccurrences === undefined || (r.occurrence ?? 0) < r.maxOccurrences)
}

function mutationInput(p: any, scope: RemoteScope, requestId: string) {
  const clientRequestId = receiptKey(scope, requestId)
  return p.action === 'cancel' ? { clientRequestId, reason: 'user_cancelled' as const, expectedRevision: p.expectedRevision }
    : { clientRequestId, expectedRevision: p.expectedRevision, paused: p.action === 'pause',
      ...(p.action === 'resume' ? { [REMOTE_REMINDER_RESUME]: { deviceId: scope.deviceId } } : {}) }
}
/** Durable remote receipts contain status only; reminder text is fetched under current read authority. */
export function reminderControlResult(entry: RoomReminderEntry) {
  return { reminder: { id: entry.reminderId, revision: entry.revision, status: entry.status,
    fireAt: entry.fireAt, timezone: entry.timezone ?? 'UTC', updatedAt: entry.updatedAt } }
}
export class RemoteAgentReminders {
  constructor(private readonly runtime: ServerRuntime) {}
  private async checked(agentId: string, reminderId: string) {
    const rooms = this.runtime.rooms!, agent = await requireAgent(rooms, agentId)
    const row = await rooms.deps.store.get<RoomReminder>('room_reminder', reminderId)
    if (!row || row.id !== row.value.reminderId || row.roomId !== row.value.roomId || row.value.participantAgentId !== agentId)
      throw new RemoteNoEffect('NOT_FOUND')
    const note = typeof row.value.note === 'string' ? row.value.note : ''
    const parsed = RoomReminderSchema.safeParse({ ...row.value, note: memoryContentSlice(note, 0, 1000).text })
    if (!parsed.success) throw new RemoteNoEffect('INVALID_REQUEST')
    const room = await readableAgentRoom(this.runtime, agentId, row.roomId!)
    const member = room.members.find((item) => item.id === parsed.data.memberId && item.participantAgentId === agentId)
    if (!member) throw new RemoteNoEffect('NOT_FOUND')
    return { row, value: parsed.data, room, member, agent, note, nativeValid: RoomReminderSchema.safeParse(row.value).success }
  }
  private async project(agentId: string, reminderId: string) {
    const { row, value: r, room, member, agent, note, nativeValid } = await this.checked(agentId, reminderId)
    const active = ['scheduled', 'paused'].includes(r.status), editable = !room.archivedAt && nativeValid
    const enabled = await remindersEnabled(this.runtime.rooms!.deps.store)
    const source: { resource: { kind: 'agent'; id: string }; roomId: string; anchorMessageId?: string } = {
      resource: { kind: 'agent', id: agentId }, roomId: room.id }
    if (r.anchorMessageId) {
      const message = await this.runtime.rooms!.deps.store.get<any>('message', r.anchorMessageId)
      if (message?.roomId === room.id && message.value.roomId === room.id && message.value.presentationKind !== 'setup') source.anchorMessageId = r.anchorMessageId
    }
    return { id: r.reminderId, revision: row.revision, agentId, note: r.note, noteTotalChars: note.length,
      noteTruncated: note.length > r.note.length, fireAt: r.fireAt, status: r.status, timezone: r.timezone ?? 'UTC',
      ...(r.recurrence ? { recurrence: r.recurrence } : {}), ...(r.quietHours ? { quietHours: r.quietHours } : {}),
      ...(r.trigger ? { trigger: r.trigger } : {}), ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}),
      occurrence: r.occurrence ?? 0, ...(r.maxOccurrences !== undefined ? { maxOccurrences: r.maxOccurrences } : {}),
      ...(r.deferredReason ? { deferredReason: r.deferredReason } : {}), ...(r.endedReason ? { endedReason: r.endedReason } : {}),
      createdAt: r.createdAt, updatedAt: r.updatedAt, ...(r.firedAt ? { firedAt: r.firedAt } : {}), source,
      canPause: editable && r.status === 'scheduled', canCancel: editable && active,
      canResume: editable && r.status === 'paused' && hasFutureOccurrence(r) && enabled && !agent.archivedAt && member.enabled && !member.removedAt && room.defaultMemberId === member.id }
  }
  async list(p: any) {
    await requireAgent(this.runtime.rooms!, p.agentId)
    const page = libraryCursor('agent.reminders.list', [p.agentId, p.status], p.cursor)
    const status = p.status === 'active' ? ['scheduled', 'paused'] : p.status === 'all' ? undefined : p.status
    const reminders = [], deadline = Date.now() + 1000
    let before = page.before, hasMore = false, incomplete = Boolean(page.incomplete)
    for (let scanned = 0; scanned < 100 && reminders.length < p.limit && Date.now() < deadline; scanned++) {
      const rows = await this.runtime.rooms!.deps.store.list<RoomReminder>('room_reminder', {
        participantAgentId: p.agentId, status, beforeSeq: before, limit: 1 })
      if (!rows.length) { hasMore = false; break }
      before = rows[0].seq; hasMore = true
      const sourceRoom = await this.runtime.rooms!.deps.store.get<{ conversationKind?: string }>('room', rows[0].value.roomId)
      if (sourceRoom && sourceRoom.value.conversationKind !== 'user_agent') continue
      try { reminders.push(await this.project(p.agentId, rows[0].id)) }
      catch (error) { if (!(error instanceof RemoteNoEffect)) throw error; if (error.code === 'INVALID_REQUEST') incomplete = true }
    }
    if (hasMore) hasMore = Boolean((await this.runtime.rooms!.deps.store.list('room_reminder', {
      participantAgentId: p.agentId, status, beforeSeq: before, limit: 1 })).length)
    return { agentId: p.agentId, enabled: await remindersEnabled(this.runtime.rooms!.deps.store), reminders,
      ...libraryPage(page.scope, before, hasMore, incomplete) }
  }
  async preflight(p: any) {
    const data = await this.checked(p.agentId, p.reminderId), r = data.row.value
    if (!data.nativeValid) throw new RemoteNoEffect('INVALID_REQUEST')
    if (data.row.revision !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
    if (data.room.archivedAt) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    if (p.action === 'cancel' && !['scheduled', 'paused', 'cancelled'].includes(r.status) ||
      p.action === 'pause' && r.status !== 'scheduled' || p.action === 'resume' && r.status !== 'paused') throw new RemoteNoEffect('INVALID_REQUEST')
    if (p.action === 'resume' && !hasFutureOccurrence(r)) throw new RemoteNoEffect('INVALID_REQUEST')
    if (p.action === 'resume' && (data.agent.archivedAt || !data.member.enabled || data.member.removedAt ||
      data.room.defaultMemberId !== data.member.id || !await remindersEnabled(this.runtime.rooms!.deps.store))) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    return data
  }
  async act(p: any, scope: Envelope) {
    const rooms = this.runtime.rooms!
    try {
      return await rooms.exclusive(async () => {
        const data = await this.preflight(p), input = mutationInput(p, scope, scope.call.requestId)
        try {
          const result = p.action === 'cancel' ? await cancelRoomReminder(rooms.deps.store, data.room.id, p.reminderId, input as Extract<typeof input, { reason: string }>)
            : await updateRoomReminder(rooms.deps.store, data.room.id, p.reminderId, input)
          return reminderControlResult(result)
        } catch (error) {
          if (error instanceof RoomStoreConflictError && error.currentRevision !== null) throw new RemoteNoEffect('REVISION_CONFLICT')
          throw error
        }
      })
    } finally { rooms.wake() }
  }
  async recover(scope: RemoteScope, receipt: Receipt) {
    if (receipt.method !== 'agent.reminders.act') return undefined
    const parsed = ReminderParamSchemas['agent.reminders.act'].safeParse(receipt.params)
    if (!parsed.success) return undefined
    const p = parsed.data, row = await this.runtime.rooms!.deps.store.get<RoomReminder>('room_reminder', p.reminderId)
    if (!row || row.value.participantAgentId !== p.agentId) return undefined
    const input = mutationInput(p, scope, receipt.requestId), roomId = row.value.roomId
    const key = interactionId(p.action === 'cancel' ? 'reminder-cancel' : 'reminder-update', roomId, p.reminderId, input.clientRequestId)
    const proof = await this.runtime.rooms!.deps.store.getRequest(key), result = proof?.result as RoomReminderEntry | undefined
    const fingerprint = p.action === 'cancel' ? interactionFingerprint({ roomId, reminderId: p.reminderId, ...input })
      : reminderUpdateFingerprint(roomId, p.reminderId, input)
    if (!result || proof?.fingerprint !== fingerprint || result.reminderId !== p.reminderId || result.roomId !== roomId || result.participantAgentId !== p.agentId) return undefined
    return reminderControlResult(result)
  }
}
