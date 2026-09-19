import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomService } from './room-service.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import { getRoomNotificationPreference, updateRoomNotificationPreference } from './room-notification-preferences.js'
import { roomNotificationSuppressed } from '../contracts/room-experience.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-experience-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') }), wake = vi.fn()
  const service = new RoomService(store, wake)
  const { room: first } = await service.create({ clientRequestId: 'first', name: 'Needle first' })
  const { room: second } = await service.create({ clientRequestId: 'second', name: 'Needle second' })
  cleanup.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  return { store, service, wake, first, second }
}
describe('room experience projections and notification preferences', () => {
  it('shares reference-only cards as discussion unless the user explicitly chooses execution', async () => {
    const f = await fixture()
    f.service.setContentReferenceValidator(async () => undefined)
    const sent = await f.service.send(f.first.id, { clientRequestId: 'share', body: '', references: [{ kind: 'task', taskId: 'task' }] })
    const request = await f.store.get<{ message: { executionIntent: string } }>('request', sent.requestId)
    expect(request?.value.message.executionIntent).toBe('discussion')
    const replay = await f.service.send(f.first.id, { clientRequestId: 'share', body: '', references: [{ kind: 'task', taskId: 'task' }] })
    expect(replay.requestId).toBe(sent.requestId)
  })
  it('filters unread, repository and attention before page selection', async () => {
    const f = await fixture()
    const sentA = await f.service.send(f.first.id, { clientRequestId: 'a', body: 'Needle old room' })
    const sentB = await f.service.send(f.second.id, { clientRequestId: 'b', body: 'Needle new room' })
    const b = (await f.store.get('message', sentB.message.id))!
    await f.store.commit({ requestId: 'read-b', checks: [{ kind: 'read_state', id: f.second.id, expectedRevision: null }],
      puts: [{ kind: 'read_state', id: f.second.id, roomId: f.second.id, value: { seq: b.seq } }] })
    expect((await f.store.listRooms({ unreadOnly: true, limit: 1 })).rooms.map((row) => row.id)).toEqual([f.first.id])
    const old = (await f.store.get('room', f.first.id))!
    await f.store.commit({ requestId: 'bind-repo', checks: [{ kind: 'room', id: f.first.id, expectedRevision: old.revision }],
      puts: [{ kind: 'room', id: f.first.id, roomId: f.first.id, value: { ...f.first,
        repositories: [{ id: 'repo', canonicalRoot: '/test/project', displayName: 'Project', displayPath: '/test/project', gitCommonDir: '/test/project/.git', availability: 'available' }] } }] })
    expect((await f.store.listRooms({ repositoryRoot: '/test/project', limit: 1 })).rooms.map((row) => row.id)).toEqual([f.first.id])
    expect(await f.store.roomRepositories()).toEqual([{ canonicalRoot: '/test/project', displayName: 'Project', roomCount: 1 }])
    await f.store.commit({ requestId: 'failed-integration', checks: [
      { kind: 'task', id: 'failed-task', expectedRevision: null }, { kind: 'integration', id: 'integration', expectedRevision: null }
    ], puts: [
      { kind: 'task', id: 'failed-task', roomId: f.second.id, value: { task: { id: 'failed-task', status: 'completed' } } },
      { kind: 'integration', id: 'integration', roomId: f.second.id, taskId: 'failed-task',
        value: { id: 'integration', taskId: 'failed-task', status: 'failed' } }
    ] })
    expect((await f.store.listRooms({ attentionOnly: true, limit: 1 })).rooms.map((row) => row.id)).toEqual([f.second.id])
    expect(sentA.message.rootRequestId).toBeDefined()
  })

  it('pages universal search with exact room/member/message targets and bounded previews', async () => {
    const f = await fixture()
    const first = await f.service.send(f.first.id, { clientRequestId: 's1', body: 'Needle ' + 'x'.repeat(60000) })
    await f.service.send(f.second.id, { clientRequestId: 's2', body: 'Needle other room' })
    const page = await f.store.searchRooms({ q: 'needle', kind: 'messages', limit: 1 })
    expect(page.results).toHaveLength(1)
    const older = await f.store.searchRooms({ q: 'needle', kind: 'messages', limit: 1, cursor: page.nextCursor })
    expect(older.results[0]).toMatchObject({ roomId: f.first.id, messageId: first.message.id })
    expect(older.results[0].preview.length).toBeLessThanOrEqual(800)
    expect((await f.store.searchRooms({ q: 'needle', kind: 'messages', roomId: f.first.id })).results).toHaveLength(1)
    expect((await f.store.searchRooms({ q: '开发', kind: 'members' })).results).toHaveLength(2)
    expect((await f.store.searchRooms({ q: 'needle', kind: 'rooms' })).results).toHaveLength(2)
    await expect(f.store.searchRooms({ q: 'needle', kind: 'rooms', cursor: page.nextCursor })).rejects.toThrow()
  })

  it('persists mute separately from room authority and discards expired deferred notifications', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-09-13T00:00:00Z')
    const f = await fixture()
    const authority = await f.store.get('room', f.first.id)
    const mute = await updateRoomNotificationPreference(f.store, f.first.id, {
      clientRequestId: 'mute', expectedRevision: null, mode: 'until', mutedUntil: '2026-09-13T01:00:00Z' })
    expect(roomNotificationSuppressed(mute.preference, '2026-09-13T00:30:00Z')).toBe(true)
    vi.setSystemTime('2026-09-13T02:00:00Z')
    expect(roomNotificationSuppressed(mute.preference, '2026-09-13T00:30:00Z')).toBe(true)
    expect(roomNotificationSuppressed(mute.preference, '2026-09-13T01:30:00Z')).toBe(false)
    const unmute = await updateRoomNotificationPreference(f.store, f.first.id, { clientRequestId: 'unmute', expectedRevision: mute.revision, mode: 'all' })
    expect(roomNotificationSuppressed(unmute.preference, '2026-09-13T00:30:00Z')).toBe(true)
    expect((await getRoomNotificationPreference(f.store, f.first.id)).preference.mode).toBe('all')
    expect(await f.store.get('room', f.first.id)).toEqual(authority)
    expect(f.wake).not.toHaveBeenCalled()
    expect((await f.store.events(f.first.id)).filter((event) => event.kind === 'presentation.preference.updated')).toHaveLength(2)
  })

  it('counts distinct run facts and preserves unknown versus partial accounting', async () => {
    const f = await fixture(), now = new Date().toISOString()
    for (const [index, usageStatus] of ['complete', 'partial', 'unavailable'].entries()) {
      const id = 'run-' + index
      await f.store.commit({ requestId: 'record-' + id,
        checks: [{ kind: 'room_run', id, expectedRevision: null }], puts: [{ kind: 'room_run', id, roomId: f.first.id,
          value: { id, roomId: f.first.id, rootRequestId: 'topic', requestId: 'request', memberId: 'developer', memberLabel: 'Dev',
            phase: index === 2 ? 'triage' : 'discussion', attempt: index + 1, clientRequestId: id, input: 'Needle request',
            attachmentIds: [], status: 'completed', outcome: index === 2 ? 'skipped' : 'published', createdAt: now, updatedAt: now,
            usageStatus, ...(index === 2 ? {} : { elapsedMs: 100, usage: { ...emptyUsageSnapshot(), totalTokens: 10 } }) } }] })
    }
    const summary = await f.store.runSummary({ roomId: f.first.id, rootRequestId: 'topic' })
    expect(summary).toMatchObject({ runs: 3, responses: 2, triages: 1, knownUsageRuns: 1, partialUsageRuns: 1,
      unknownUsageRuns: 1, knownTokens: 20, knownElapsedMs: 200, skipped: 1 })
    expect((await f.store.runSummary({ roomId: f.second.id })).knownTokens).toBeNull()
    expect((await f.store.list('room_run', { roomId: f.first.id, search: 'Needle' }))).toHaveLength(3)
  })
})
