import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import type { Room } from '../contracts/rooms.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { listRoomContentOptions } from './room-content-options.js'
import { resolveRoomContent } from './room-content-service.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kun-room-card-options-')))
  roots.push(root)
  await promisify(execFile)('git', ['init', root])
  const room = { id: 'room', revision: 0, repositories: [{ id: 'repo', displayPath: root, canonicalRoot: root,
    gitCommonDir: join(root, '.git'), availability: 'available' }] } as Room
  const card = (index: number) => ({ id: `card-${index}`, title: index === 500 ? 'Needle deep card' : `Card ${index}`,
    workspaceRoot: root, description: 'Read-only', status: 'pending' })
  const snapshot = vi.fn(async (input: { cursor?: string }) => input.cursor
    ? { cards: [card(500)], workspaceRoot: root }
    : { cards: Array.from({ length: 500 }, (_, index) => card(index)), nextCursor: 'source-page-2', workspaceRoot: root })
  const exact = vi.fn(async () => ({ card: card(500), workspaceRoot: root, revision: 0 }))
  const runtime = { rooms: { deps: { store: {} } }, projectBoardService: { snapshot, card: exact } } as unknown as ServerRuntime
  return { room, runtime, snapshot, exact }
}

it('exposes a continuation when a search has no matches in the first 500 cards', async () => {
  const f = await fixture()
  const first = await listRoomContentOptions(f.runtime, f.room, 'board_card', 'repo', 'Needle')
  expect(first.references).toEqual([])
  expect(first.nextCursor).toBeTruthy()
  expect(f.snapshot).toHaveBeenCalledTimes(1)
  expect(f.snapshot).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }))
  const second = await listRoomContentOptions(f.runtime, f.room, 'board_card', 'repo', 'Needle', first.nextCursor)
  expect(second.references).toMatchObject([{ kind: 'board_card', cardId: 'card-500' }])
  expect(second.nextCursor).toBeUndefined()
  expect(f.snapshot).toHaveBeenCalledTimes(2)
  expect(await resolveRoomContent(f.runtime, f.room, second.references[0], 'preview'))
    .toMatchObject({ state: 'available', title: 'Needle deep card', preview: { text: 'Read-only' } })
  expect(f.exact).toHaveBeenCalledWith({ workspace: f.room.repositories[0].canonicalRoot, cardId: 'card-500' })
  expect(f.snapshot).toHaveBeenCalledTimes(2)
})

it('pages within each source page without skipping the 31st card and rejects a changed search cursor', async () => {
  const f = await fixture()
  const first = await listRoomContentOptions(f.runtime, f.room, 'board_card', 'repo')
  const second = await listRoomContentOptions(f.runtime, f.room, 'board_card', 'repo', '', first.nextCursor)
  expect(first.references).toHaveLength(30)
  expect(second.references[0]).toMatchObject({ cardId: 'card-30' })
  await expect(listRoomContentOptions(f.runtime, f.room, 'board_card', 'repo', 'different', first.nextCursor)).rejects.toThrow()
})

it('reports unavailable source warnings instead of asserting an empty board', async () => {
  const f = await fixture()
  f.snapshot.mockResolvedValue({ cards: [], workspaceRoot: f.room.repositories[0].canonicalRoot, warning: 'corrupt document' } as never)
  await expect(listRoomContentOptions(f.runtime, f.room, 'board_card', 'repo')).rejects.toThrow('board_unavailable')
})
