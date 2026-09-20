import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Room } from '../contracts/rooms.js'
import type { RoomContentReference } from '../contracts/room-content.js'
import type { RoomDelivery } from '../contracts/room-deliveries.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { RoomTaskExecution } from './room-runtime-types.js'
import { assertRoomContentRepository } from './room-content-service.js'
import { roomGit } from './room-git.js'

const Cursor = z.object({ scope: z.string(), offset: z.number().int().nonnegative().max(10000000),
  source: z.string().max(1024).optional(), beforeSeq: z.number().int().nonnegative().optional() }).strict()
type CursorValue = z.infer<typeof Cursor>
const encode = (cursor: CursorValue): string => Buffer.from(JSON.stringify(cursor)).toString('base64url')
function decode(value: string | undefined, scope: string): CursorValue {
  if (!value) return { scope, offset: 0 }
  try {
    const parsed = Cursor.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    if (parsed.scope !== scope) return Cursor.parse(null)
    return parsed
  } catch { return Cursor.parse(null) }
}
function selectOptions(items: RoomContentReference[], query: string, offset: number) {
  const references: RoomContentReference[] = []
  let index = offset
  for (; index < items.length && references.length < 30; index += 1) {
    if ((items[index].titleSnapshot ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase())) references.push(items[index])
  }
  return { references, index }
}

/** One bounded source page per request; an empty match page can still have a continuation. */
export async function listRoomContentOptions(runtime: ServerRuntime, room: Room, kind: RoomContentReference['kind'],
  repositoryId?: string, query = '', cursor?: string): Promise<{ references: RoomContentReference[]; nextCursor?: string }> {
  const store = runtime.rooms!.deps.store
  const scope = createHash('sha256').update(JSON.stringify([room.id, room.revision, kind, repositoryId, query])).digest('hex')
  const page = decode(cursor, scope)
  if (kind === 'task' || kind === 'delivery') {
    const rows = kind === 'task' ? await store.list<RoomTaskExecution>('task', { roomId: room.id, limit: 200, beforeSeq: page.beforeSeq })
      : await store.list<RoomDelivery>('delivery', { roomId: room.id, limit: 200, beforeSeq: page.beforeSeq })
    const options = rows.map((row): RoomContentReference => kind === 'task'
      ? { kind, taskId: row.id, titleSnapshot: (row.value as RoomTaskExecution).task.title }
      : { kind, taskId: (row.value as RoomDelivery).taskId, deliveryId: row.id, titleSnapshot: (row.value as RoomDelivery).summary.slice(0, 300) })
    const selected = selectOptions(options, query, page.offset)
    const next = selected.index < rows.length ? { ...page, offset: selected.index, beforeSeq: page.beforeSeq ?? rows[0].seq + 1 }
      : rows.length === 200 ? { scope, offset: 0, beforeSeq: rows.at(-1)!.seq } : undefined
    return { references: selected.references, ...(next ? { nextCursor: encode(next) } : {}) }
  }
  if (kind === 'attachment' || !repositoryId) return { references: [] }
  const repository = await assertRoomContentRepository(room, repositoryId)
  if (kind === 'board_card') {
    if (!runtime.projectBoardService) throw new Error('board_unavailable')
    const board = await runtime.projectBoardService.snapshot({ workspace: repository.canonicalRoot,
      includeArchived: true, cursor: page.source, readOnly: true })
    if (board.warning) throw new Error('board_unavailable')
    const selected = selectOptions(board.cards.map((card) => ({ kind, repositoryId, cardId: card.id, titleSnapshot: card.title })), query, page.offset)
    const next = selected.index < board.cards.length ? { ...page, offset: selected.index }
      : board.nextCursor ? { scope, offset: 0, source: board.nextCursor } : undefined
    return { references: selected.references, ...(next ? { nextCursor: encode(next) } : {}) }
  }
  const files = await roomGit(repository.canonicalRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  const options = [...new Set(files.split('\0'))].filter(Boolean).map((relativePath): RoomContentReference => ({
    kind: 'repository_file', repositoryId, relativePath, titleSnapshot: relativePath }))
  const selected = selectOptions(options, query, page.offset)
  return { references: selected.references,
    ...(selected.index < options.length ? { nextCursor: encode({ scope, offset: selected.index }) } : {}) }
}
