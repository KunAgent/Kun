import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoomMessageSchema, RoomSchema, type Room } from '../contracts/rooms.js'
import { RoomTaskSchema } from '../contracts/room-tasks.js'
import { AttachmentMetadata } from '../contracts/attachments.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomService } from '../rooms/room-service.js'
import type { RoomStoreCommit } from '../rooms/room-store.js'
import { ExtensionRoomsService, EXTENSION_ROOM_MESSAGE_PAGE_BYTES,
  type ExtensionRoomsOperation } from './extension-rooms-service.js'
import type { ExtensionPrincipal } from './extension-agent-service-contracts.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
const timestamp = '2026-09-13T00:00:00Z'
const principal: ExtensionPrincipal = {
  extensionId: 'reader', extensionVersion: '1.0.0', permissions: ['rooms.read'],
  workspaceRoots: [], workspaceTrusted: false
}
const denied: ExtensionPrincipal = { ...principal, permissions: ['agent.run', 'agent.threads.readOwn'] }
const operations: ExtensionRoomsOperation[] = ['list', 'listMessages', 'listTasks', 'listEvents']

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-extension-rooms-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanups.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const service = new RoomService(store, () => { throw new Error('read-only service must not wake rooms') })
  const metadata = AttachmentMetadata.parse({
    id: 'att_012345678901234567890123', name: 'C:\\private\\secret\\report.pdf',
    mimeType: 'application/pdf', kind: 'document', byteSize: 10, hash: 'hash',
    documentText: 'private extracted text', localFilePath: '/private/source/report.pdf',
    workspaces: ['/private/workspace'], createdAt: timestamp, updatedAt: timestamp
  })
  const attachments = { get: vi.fn(async () => metadata) }
  const api = new ExtensionRoomsService({ rooms: { service }, attachments })
  const save = async (puts: NonNullable<RoomStoreCommit['puts']>, events: RoomStoreCommit['events'] = []) => {
    const checks = await Promise.all(puts.map(async ({ kind, id }) => ({
      kind, id, expectedRevision: (await store.get(kind, id))?.revision ?? null
    })))
    return store.commit({ requestId: crypto.randomUUID(), checks, puts, events })
  }
  const room = async (id = 'room', values: Partial<Room> = {}) => {
    const value = RoomSchema.parse({
      schemaVersion: 1, id, name: 'Review room', description: 'private instructions',
      collaborationMode: 'peer', defaultMemberId: 'reviewer', revision: 0,
      members: [{ id: 'reviewer', displayName: 'Reviewer', presetId: 'reviewer', role: 'reviewer',
        roleNotes: 'private role notes', revision: 0, allowedRepositoryIds: ['repo'],
        modelRef: { providerId: 'private-provider', accountId: 'private-account', model: 'model' } }],
      repositories: [{ id: 'repo', displayName: 'Project', displayPath: '/private/workspace',
        canonicalRoot: '/private/canonical', gitCommonDir: '/private/git', availability: 'available' }],
      createdAt: timestamp, updatedAt: timestamp, ...values
    })
    await save([{ kind: 'room', id, roomId: id, value }])
    return value
  }
  const message = async (id: string, roomId = 'room', overrides: Record<string, unknown> = {}) => {
    const value = RoomMessageSchema.parse({
      id, roomId, messageSeq: 1, authorKind: 'member', authorMemberId: 'reviewer',
      authorLabelSnapshot: 'Historical reviewer', body: `Message ${id}`, bodyRevision: 0,
      mentionMemberIds: ['reviewer'], attachmentIds: [], createdAt: timestamp, ...overrides
    })
    await save([{ kind: 'message', id, roomId, value: { ...value, credential: 'private-token' } }])
    return value
  }
  const taskValue = (id: string, roomValue: Room, status: 'completed' | 'running' | 'queued' = 'completed') => ({
    task: RoomTaskSchema.parse({
      id, roomId: roomValue.id, requestId: 'request', sourceMessageId: 'message',
      title: `Task ${id}`, ownerMemberId: 'reviewer', memberSnapshot: roomValue.members[0],
      repositoryId: 'repo', workspaceId: 'private-workspace', executionThreadId: 'private-thread',
      status, stage: 'review', requirementRevision: 0, revision: 0, updatedAt: timestamp
    }),
    prompt: 'private raw prompt', toolArguments: { command: 'private command' },
    toolResult: 'private tool result', credential: 'private-token', turnId: 'private-turn',
    lease: { token: 'private-lease' }, dispatch: { id: 'private-dispatch' },
    attachmentIds: [], dependencyTaskIds: [], attempt: 1, reworkRounds: 0, configuration: null
  })
  const task = async (id: string, roomValue: Room, status?: 'completed' | 'running' | 'queued') => {
    const value = taskValue(id, roomValue, status)
    await save([{ kind: 'task', id, roomId: roomValue.id, taskId: id, value }])
    return value
  }
  return { store, service, api, attachments, metadata, save, room, message, task, taskValue }
}

describe('ExtensionRoomsService authorization and request boundaries', () => {
  it.each(operations)('rejects %s without rooms.read before accessing any room data', async (operation) => {
    const f = await fixture()
    const spies = [vi.spyOn(f.store, 'get'), vi.spyOn(f.store, 'list'),
      vi.spyOn(f.store, 'listRooms'), vi.spyOn(f.store, 'events')]
    await expect(operation === 'list' ? f.api.list(denied) : f.api[operation](denied, { roomId: 'room' }))
      .rejects.toMatchObject({ code: 'permission_denied', message: 'Missing permission: rooms.read' })
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it.each(operations)('authorizes %s independently and lets custom policy narrow the scope', async (operation) => {
    const f = await fixture()
    await f.room()
    const authorize = vi.fn(() => {})
    const api = new ExtensionRoomsService({ rooms: { service: f.service }, authorizer: { authorize } })
    await (operation === 'list' ? api.list(principal) : api[operation](principal, { roomId: 'room' }))
    expect(authorize).toHaveBeenCalledExactlyOnceWith(principal, { operation, permission: 'rooms.read' })
    authorize.mockImplementation(() => { throw new Error('private policy detail') })
    await expect(operation === 'list' ? api.list(principal) : api[operation](principal, { roomId: 'room' }))
      .rejects.toMatchObject({ code: 'permission_denied', message: 'Rooms access denied' })
  })

  it.each(operations)('validates bounded limits and unknown fields for %s', async (operation) => {
    const f = await fixture()
    for (const limit of [0, -1, 101, 1.5, Infinity, NaN]) {
      await expect(operation === 'list' ? f.api.list(principal, { limit }) :
        f.api[operation](principal, { roomId: 'room', limit }))
        .rejects.toMatchObject({ code: 'validation_error' })
    }
    const request = { roomId: 'room', limit: 1, localFilePath: '/private/path' }
    await expect(operation === 'list' ? f.api.list(principal, request) : f.api[operation](principal, request))
      .rejects.toMatchObject({ code: 'validation_error' })
  })

  it('rejects malformed, unsafe and forged cursors and invalid event/task filters', async () => {
    const f = await fixture()
    for (const cursor of ['', '-1', '01', '1.5', '9007199254740992', '/private/path']) {
      await expect(f.api.listMessages(principal, { roomId: 'room', cursor })).rejects.toMatchObject({ code: 'validation_error' })
      await expect(f.api.listTasks(principal, { roomId: 'room', cursor })).rejects.toMatchObject({ code: 'validation_error' })
    }
    for (const cursor of ['nonsense', Buffer.from(JSON.stringify({ offset: 1 })).toString('base64url')]) {
      await expect(f.api.list(principal, { cursor })).rejects.toMatchObject({ code: 'validation_error' })
    }
    await expect(f.api.listEvents(principal, { roomId: '*', after: 0 })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(f.api.listEvents(principal, { roomId: 'room', after: -1 })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(f.api.listTasks(principal, { roomId: 'room', status: 'internal' as 'running' }))
      .rejects.toMatchObject({ code: 'validation_error' })
  })

  it('returns opaque missing-room and persistence errors and resolves the current lazy store', async () => {
    const f = await fixture()
    await expect(f.api.listMessages(principal, { roomId: 'missing' })).rejects.toMatchObject({ code: 'not_found' })
    let ready = false
    const api = new ExtensionRoomsService({ rooms: () => ready ? { service: f.service } : undefined })
    await expect(api.list(principal)).rejects.toMatchObject({ code: 'conflict' })
    ready = true
    expect(await api.list(principal)).toEqual({ items: [], page: { hasMore: false } })
    vi.spyOn(f.store, 'listRooms').mockRejectedValueOnce(new Error('/private/store.sqlite credential=secret'))
    await expect(api.list(principal)).rejects.toMatchObject({ code: 'conflict', message: 'Room data is temporarily unavailable' })
  })
})

describe('ExtensionRoomsService projections and pagination', () => {
  it('projects only room summary fields and counts all tasks beyond one internal page', async () => {
    const f = await fixture()
    const room = await f.room()
    const entries: NonNullable<RoomStoreCommit['puts']> = Array.from({ length: 1002 }, (_, index) => ({
      kind: 'task', id: `task-${index}`, roomId: room.id,
      value: f.taskValue(`task-${index}`, room, index % 2 ? 'completed' : 'running')
    }))
    await f.save(entries.slice(0, 1000))
    await f.save(entries.slice(1000))
    const mutations = vi.spyOn(f.store, 'commit')
    const page = await f.api.list(principal)
    expect(page).toEqual({ items: [{ id: 'room', name: 'Review room', collaborationMode: 'peer',
      updatedAt: timestamp, memberCount: 1, taskCounts: {
        queued: 0, waiting_dependency: 0, running: 501, needs_input: 0, needs_approval: 0,
        recovery_required: 0, stopping: 0, awaiting_acceptance: 0, completed: 501, failed: 0, cancelled: 0
      } }], page: { hasMore: false } })
    expect(JSON.stringify(page)).not.toContain('private')
    expect(mutations).not.toHaveBeenCalled()
  })

  it('pages the canonical pinned/activity room ordering without an extra empty last page', async () => {
    const f = await fixture()
    await f.room('pinned', { pinned: true })
    await f.room('old')
    await f.room('latest')
    await f.room('archived', { archivedAt: timestamp })
    const first = await f.api.list(principal, { limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual(['pinned', 'latest'])
    expect(first.page.hasMore).toBe(true)
    const second = await f.api.list(principal, { cursor: first.page.nextCursor, limit: 1 })
    expect(second.items.map((item) => item.id)).toEqual(['old'])
    expect(second.page).toEqual({ hasMore: false })
  })

  it('keeps message bodies and historical authors while exposing attachment labels only', async () => {
    const f = await fixture()
    await f.room()
    await f.message('reply', 'room', { body: 'Visible room message body', replyToMessageId: 'earlier',
      attachmentIds: [f.metadata.id, '/private/path.txt'], rootRequestId: 'private-request' })
    const mutations = vi.spyOn(f.store, 'commit')
    const page = await f.api.listMessages(principal, { roomId: 'room' })
    expect(page).toEqual({ items: [{ id: 'reply', authorMemberId: 'reviewer',
      authorDisplayName: 'Historical reviewer', body: 'Visible room message body', createdAt: timestamp,
      replyToMessageId: 'earlier', mentionedMemberIds: ['reviewer'],
      attachments: [{ id: f.metadata.id, displayName: 'report.pdf' }] }], page: { hasMore: false } })
    expect(JSON.stringify(page)).not.toMatch(/private|localFilePath|documentText|turnId/)
    expect(f.attachments.get).toHaveBeenCalledExactlyOnceWith(f.metadata.id)
    expect(mutations).not.toHaveBeenCalled()
  })

  it('uses fresh attachment metadata and a safe fallback when metadata is unavailable', async () => {
    const f = await fixture()
    await f.room()
    await f.message('attachment', 'room', { attachmentIds: [f.metadata.id] })
    let available = false
    const api = new ExtensionRoomsService({ rooms: { service: f.service },
      attachments: () => available ? f.attachments : undefined })
    expect((await api.listMessages(principal, { roomId: 'room' })).items[0].attachments[0].displayName).toBe('Attachment')
    available = true
    expect((await api.listMessages(principal, { roomId: 'room' })).items[0].attachments[0].displayName).toBe('report.pdf')
  })

  it('keeps stable message cursors across appends and edits and isolates each room', async () => {
    const f = await fixture()
    await f.room()
    await f.room('other')
    const oldest = await f.message('oldest')
    await f.message('middle')
    await f.message('latest')
    await f.message('foreign', 'other')
    const first = await f.api.listMessages(principal, { roomId: 'room', limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual(['middle', 'latest'])
    expect(first.page.hasMore).toBe(true)
    await f.message('appended')
    await f.save([{ kind: 'message', id: oldest.id, roomId: 'room', value: { ...oldest, body: 'Revised', bodyRevision: 1 } }])
    const second = await f.api.listMessages(principal, { roomId: 'room', cursor: first.page.nextCursor, limit: 1 })
    expect(second.items.map((item) => [item.id, item.body])).toEqual([['oldest', 'Revised']])
    expect(second.page).toEqual({ hasMore: false })
  })

  it('accepts maximum canonical labels and bodies while paging below the host byte limit', async () => {
    const f = await fixture()
    const room = await f.room()
    room.name = 'R'.repeat(120)
    room.repositories[0].displayName = 'P'.repeat(120)
    await f.save([{ kind: 'room', id: room.id, roomId: room.id, value: room }])
    await f.task('task', room)
    for (let index = 0; index < 3; index++) {
      await f.message(`large-${index}`, 'room', {
        body: '\u0000'.repeat(64000), authorLabelSnapshot: 'A'.repeat(120)
      })
    }
    let cursor: string | undefined
    const ids = new Set<string>()
    for (let index = 0; index < 3; index++) {
      const page = await f.api.listMessages(principal, { roomId: 'room', limit: 100, cursor })
      expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThan(EXTENSION_ROOM_MESSAGE_PAGE_BYTES)
      expect(page.items).toHaveLength(1)
      expect(page.items[0].body).toHaveLength(64000)
      expect(page.items[0].authorDisplayName).toHaveLength(120)
      ids.add(page.items[0].id)
      expect(page.page.hasMore).toBe(index < 2)
      cursor = page.page.nextCursor
    }
    expect(ids.size).toBe(3)
    expect((await f.api.list(principal)).items[0].name).toHaveLength(120)
    expect((await f.api.listTasks(principal, { roomId: 'room' })).items[0].repositoryDisplayName).toHaveLength(120)
  })

  it('projects task summaries with status filters, room isolation and stable pagination', async () => {
    const f = await fixture()
    const room = await f.room()
    const other = await f.room('other')
    await f.task('first', room, 'running')
    await f.task('completed', room)
    await f.task('last', room, 'running')
    await f.task('foreign', other, 'running')
    const mutations = vi.spyOn(f.store, 'commit')
    const first = await f.api.listTasks(principal, { roomId: 'room', status: 'running', limit: 1 })
    expect(first.items).toEqual([{ id: 'last', status: 'running', title: 'Task last',
      memberId: 'reviewer', repositoryDisplayName: 'Project', updatedAt: timestamp }])
    expect(JSON.stringify(first)).not.toMatch(/private|prompt|toolArguments|lease|dispatch/)
    const second = await f.api.listTasks(principal, {
      roomId: 'room', status: 'running', limit: 1, cursor: first.page.nextCursor
    })
    expect(second.items[0].id).toBe('first')
    expect(second.page).toEqual({ hasMore: false })
    expect(mutations).not.toHaveBeenCalled()
  })

  it('advances over hidden events with bounded replay and whitelists every visible payload', async () => {
    const f = await fixture()
    await f.room()
    await f.room('other')
    const committed = await f.save([], [
      { roomId: 'room', kind: 'dispatch.updated', payload: { id: 'dispatch', leaseToken: 'private-lease' } },
      { roomId: 'room', kind: 'turn.updated', payload: { id: 'turn', prompt: 'private prompt' } },
      { roomId: 'other', kind: 'message.created', payload: { id: 'foreign' } },
      { roomId: 'room', kind: 'message.created', payload: { id: 'message', taskId: 'task',
        localFilePath: '/private/path', nested: { credential: 'private-token' }, toolResult: 'private result' } },
      { roomId: 'room', kind: 'task.updated', payload: { id: 'task', turnId: 'private-turn', taskId: '/private/task' } }
    ])
    const mutations = vi.spyOn(f.store, 'commit')
    const first = await f.api.listEvents(principal, { roomId: 'room', limit: 2 })
    expect(first).toEqual({ items: [], cursor: committed.events[1].seq, hasMore: true })
    const request = { roomId: 'room', after: first.cursor, limit: 2 }
    const second = await f.api.listEvents(principal, request)
    expect(second.items).toEqual([
      { type: 'message.created', sequence: committed.events[3].seq, timestamp: committed.events[3].createdAt,
        roomId: 'room', payload: { id: 'message', taskId: 'task' } },
      { type: 'task.updated', sequence: committed.events[4].seq, timestamp: committed.events[4].createdAt,
        roomId: 'room', payload: { id: 'task' } }
    ])
    expect(second.hasMore).toBe(false)
    expect(second.cursor).toBe(committed.events[4].seq)
    expect(JSON.stringify(second)).not.toMatch(/private|foreign|toolResult|turnId/)
    expect(await f.api.listEvents(principal, request)).toEqual(second)
    expect(await f.api.listEvents(principal, { roomId: 'room', after: second.cursor }))
      .toEqual({ items: [], cursor: second.cursor, hasMore: false })
    expect(mutations).not.toHaveBeenCalled()
  })
})
