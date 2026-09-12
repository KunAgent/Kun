import type { RoomDocumentKind, RoomStore, RoomStoreListOptions } from './room-store.js'
export type RoomHistoryPage = { limit?: number; cursor?: number }
export async function roomHistoryPage<T extends object>(store: RoomStore, kind: RoomDocumentKind,
  options: RoomStoreListOptions, page: RoomHistoryPage = {}) {
  const limit = page.limit ?? 50
  const rows = await store.list<T>(kind, { ...options, limit, beforeSeq: page.cursor })
  return { items: rows.map((row) => ({ ...row.value, revision: row.revision })),
    nextCursor: rows.length === limit ? String(rows.at(-1)!.seq) : undefined }
}
