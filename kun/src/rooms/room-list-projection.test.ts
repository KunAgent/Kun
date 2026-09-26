import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomMessageSchema } from '../contracts/rooms.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
const createdAt = '2026-09-13T00:00:00Z'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-list-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanups.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const createRoom = async (id: string, value: Record<string, unknown> = {}) => store.commit({
    requestId: `room-${id}`, checks: [{ kind: 'room', id, expectedRevision: null }],
    puts: [{ kind: 'room', id, value: { id, name: id, ...value } }]
  })
  const message = async (roomId: string, id: string, body: string, attachmentIds: string[] = []) => {
    const value = RoomMessageSchema.parse({
      id, roomId, messageSeq: 1, body, bodyRevision: 0, attachmentIds,
      authorKind: 'member', authorMemberId: 'reviewer', authorLabelSnapshot: 'Historical reviewer',
      mentionMemberIds: [], createdAt
    })
    await store.commit({ requestId: `message-${id}`, checks: [{ kind: 'message', id, expectedRevision: null }],
      puts: [{ kind: 'message', id, roomId, value }] })
    return value
  }
  return { store, createRoom, message }
}

describe('room list latest-message projection', () => {
  it('returns no preview for an empty room and preserves attachment-only author metadata without file paths', async () => {
    const f = await fixture()
    await f.createRoom('empty')
    await f.createRoom('attachments')
    await f.message('attachments', 'image', '', ['private-file-path-a', 'private-file-path-b'])
    const page = await f.store.listRooms()
    expect(page.rooms.find((row) => row.id === 'empty')).toMatchObject({ latestMessageSeq: 0 })
    expect(page.rooms.find((row) => row.id === 'empty')).not.toHaveProperty('latestMessage')
    expect(page.rooms[0].latestMessage).toEqual({
      id: 'image', authorKind: 'member', authorMemberId: 'reviewer',
      authorLabelSnapshot: 'Historical reviewer', preview: '', createdAt, attachmentCount: 2
    })
    expect(JSON.stringify(page)).not.toContain('private-file-path')
    expect(page.rooms[0].value).not.toHaveProperty('latestMessage')
  })

  it('bounds previews by Unicode code points and hides Markdown destinations and truncated data URLs', async () => {
    const f = await fixture()
    await f.createRoom('markdown')
    await f.message('markdown', 'formatted', '# **Review**\n\n[report](https://private.test/token)  is `ready`.\n' +
      '![image](data:image/png;base64,' + 'A'.repeat(60000) + ')')
    const page = await f.store.listRooms()
    expect(page.rooms[0].latestMessage?.preview).toBe('Review report is ready. image')
    expect(JSON.stringify(page).length).toBeLessThan(1500)
    expect(JSON.stringify(page)).not.toMatch(/data:|private\.test|AAAA/)
    await f.message('markdown', 'unicode', '\u4e2d\u6587\u{1f680} '.repeat(500))
    const preview = (await f.store.listRooms()).rooms[0].latestMessage!.preview
    expect(Array.from(preview)).toHaveLength(160)
    expect(preview).toBe('\u4e2d\u6587\u{1f680} '.repeat(40))
    expect(preview).not.toContain('\ufffd')
  })

  it('updates the latest body in place, never promotes older revisions, and preserves paging, pinning, search and archives', async () => {
    const f = await fixture()
    await f.createRoom('pinned', { pinned: true })
    await f.createRoom('active')
    await f.createRoom('empty')
    await f.createRoom('archived', { archivedAt: createdAt })
    const old = await f.message('active', 'old', 'Old message')
    const latest = await f.message('active', 'latest', 'First part')
    await f.message('archived', 'archived-message', 'Archived history')
    const first = await f.store.listRooms({ limit: 2 })
    expect(first.rooms.map((row) => row.id)).toEqual(['pinned', 'active'])
    expect(first.rooms[1].latestMessage?.id).toBe('latest')
    expect((await f.store.listRooms({ limit: 2, cursor: first.nextCursor })).rooms.map((row) => row.id)).toEqual(['empty'])
    await f.store.commit({ requestId: 'revisions', checks: [
      { kind: 'message', id: 'old', expectedRevision: 0 }, { kind: 'message', id: 'latest', expectedRevision: 0 }
    ], puts: [
      { kind: 'message', id: 'old', roomId: 'active', value: { ...old, body: 'Old revision', bodyRevision: 1 } },
      { kind: 'message', id: 'latest', roomId: 'active', value: { ...latest, body: 'Complete response', bodyRevision: 1 } }
    ] })
    const revised = await f.store.listRooms({ limit: 2 })
    expect(revised.nextCursor).toBe(first.nextCursor)
    expect(revised.rooms.map(({ id, latestMessageSeq }) => ({ id, latestMessageSeq })))
      .toEqual(first.rooms.map(({ id, latestMessageSeq }) => ({ id, latestMessageSeq })))
    expect(revised.rooms[1].latestMessage).toEqual({ ...first.rooms[1].latestMessage, preview: 'Complete response' })
    expect((await f.store.listRooms({ search: 'act' })).rooms.map((row) => row.id)).toEqual(['active'])
    expect((await f.store.listRooms({ archivedOnly: true })).rooms[0].latestMessage?.preview).toBe('Archived history')
  })
})
