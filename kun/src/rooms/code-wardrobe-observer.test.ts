import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { CodeWardrobeObserver, codeWardrobeThread } from './code-wardrobe-observer.js'
import { readRoomWardrobe } from './room-wardrobe-service.js'

const resources: Array<{ dir: string; store: SqliteRoomStore }> = []
// The local game (debug runs) rolls Code drops on this machine; accounts queue the turn instead.
beforeEach(() => { process.env.KUN_WARDROBE_LOCAL = '1' })
afterEach(async () => {
  delete process.env.KUN_WARDROBE_LOCAL
  for (const { dir, store } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) }
})

const thread = (patch: Partial<ThreadRecord> = {}) => ({ id: 'thread-1', title: '修复登录超时', ...patch }) as ThreadRecord
const turn = (patch: Partial<Turn> = {}) => ({ id: 'turn-1', threadId: 'thread-1', status: 'completed', finishedAt: new Date().toISOString(), ...patch }) as Turn

async function observe(threads: Record<string, ThreadRecord>, turns: Record<string, Turn>) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-code-wardrobe-')), store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ dir, store })
  const observer = new CodeWardrobeObserver({ store, threadStore: { get: async (id) => threads[id] ?? null },
    turns: { getTurn: async (_threadId, id) => turns[id] ?? null } })
  return { store, observer }
}

it('counts only Code tasks the user started', () => {
  expect(codeWardrobeThread(thread())).toBe(true)
  expect(codeWardrobeThread(thread({ agentSurface: 'code' }))).toBe(true)
  for (const patch of [{ roomContext: {} }, { parentThreadId: 'p' }, { workbenchOrigin: {} }, { executionUnit: {} },
    { ownerExtensionId: 'x' }, { workspaceMode: 'ade' }, { agentSurface: 'write' }, { agentSurface: 'design' }, { historyRefId: 'h' }]) {
    expect(codeWardrobeThread(thread(patch as Partial<ThreadRecord>)), JSON.stringify(patch)).toBe(false)
  }
  expect(codeWardrobeThread(null)).toBe(false)
})

it('drops a bottle for a finished Code task turn, labelled with the task title', async () => {
  const { store, observer } = await observe({ 'thread-1': thread() }, { 'turn-1': turn() })
  await observer.count('thread-1', 'turn-1')
  const { wardrobe } = await readRoomWardrobe(store)
  expect(wardrobe.pending).toEqual([expect.objectContaining({ id: 'drop-code-turn-1', source: 'code', threadId: 'thread-1', sourceLabel: '修复登录超时' })])
})

it('ignores background continuations, failed turns and Agent conversation threads', async () => {
  const { store, observer } = await observe(
    { 'thread-1': thread(), 'room-thread': thread({ id: 'room-thread', roomContext: { roomId: 'r' } as ThreadRecord['roomContext'] }) },
    { 'bg': turn({ id: 'bg', messageSource: 'background_subagent' }), 'failed': turn({ id: 'failed', status: 'failed' }), 'room-turn': turn({ id: 'room-turn' }) })
  await observer.count('thread-1', 'bg')
  await observer.count('thread-1', 'failed')
  await observer.count('room-thread', 'room-turn')
  await observer.count('thread-1', 'missing')
  expect(await store.get('room_wardrobe', 'self')).toBeNull()
})
