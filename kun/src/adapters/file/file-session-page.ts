import { open, type FileHandle } from 'node:fs/promises'
import type { TurnItem } from '../../contracts/items.js'
import type { ItemHistoryPage, ItemHistoryPageOptions } from '../../ports/session-store.js'
import { buildPublicItemHistoryPage } from '../../services/item-history-page.js'
import { readItemPageFromJsonl } from './file-session-jsonl.js'
import type { JsonlFileAccessCoordinator } from './jsonl-file-access.js'
import type { FileSessionItemIndex } from './file-session-item-index.js'
import { liveReplayAfterSeq, overlayLiveItems, readLiveItems } from './file-session-live-items.js'

type PageSource =
  | { kind: 'cached'; items: TurnItem[] }
  | { kind: 'file'; handle: FileHandle; size: number }

export async function loadIndexedLiveItemPageFromStore(input: Parameters<
  typeof loadItemPageFromStore
>[0] & {
  itemIndex: FileSessionItemIndex
  indexPath: string
  indexStatePath: string
  threadId: string
  evidencePath: string
  liveItemsPath: string
}): Promise<ItemHistoryPage> {
  const indexed = await input.fileAccess.withRead(input.path, () => input.itemIndex.loadPage({
    sourcePath: input.path,
    indexPath: input.indexPath,
    statePath: input.indexStatePath,
    options: input.options
  }))
  if (indexed) {
    if ((await statSize(input.path)) >= input.compactionMinBytes) input.scheduleCompaction()
  } else {
    input.itemIndex.scheduleRebuild({
      sourcePath: input.path,
      indexPath: input.indexPath,
      statePath: input.indexStatePath,
      threadId: input.threadId,
      evidencePath: input.evidencePath,
      withSourceRead: (operation) => input.fileAccess.withRead(input.path, operation)
    })
  }
  const page = indexed ?? await loadItemPageFromStore(input)
  if (input.options.before) return page
  const live = await readLiveItems(input.liveItemsPath)
  if (live.length === 0) return page
  const overlaid = buildPublicItemHistoryPage(overlayLiveItems(page.items, live), input.options)
  return {
    ...overlaid,
    hasMore: page.hasMore || overlaid.hasMore,
    ...(overlaid.nextCursor || page.nextCursor
      ? { nextCursor: overlaid.nextCursor ?? page.nextCursor }
      : {}),
    replayAfterSeq: liveReplayAfterSeq(live)
  }
}

/** Capture and scan one bounded item page while fencing atomic replacement. */
export async function loadItemPageFromStore(input: {
  path: string
  options: ItemHistoryPageOptions
  fileAccess: JsonlFileAccessCoordinator
  cachedItems: () => TurnItem[] | undefined
  touchCache: (items: TurnItem[]) => void
  withThreadWrite: <T>(operation: () => Promise<T>) => Promise<T>
  scheduleCompaction: () => void
  compactionMinBytes: number
}): Promise<ItemHistoryPage> {
  const release = await input.fileAccess.acquireRead(input.path)
  try {
    const source = await input.withThreadWrite<PageSource | null>(async () => {
      const cached = input.cachedItems()
      if (cached) {
        input.touchCache(cached)
        return { kind: 'cached', items: [...cached] }
      }
      let handle: FileHandle | undefined
      try {
        handle = await open(input.path, 'r')
        return { kind: 'file', handle, size: (await handle.stat()).size }
      } catch (error) {
        await handle?.close().catch(() => undefined)
        if ((error as { code?: string }).code === 'ENOENT') return null
        throw error
      }
    })
    if (!source) return { items: [], hasMore: false, itemBytes: 0 }
    if (source.kind === 'cached') return buildPublicItemHistoryPage(source.items, input.options)
    if (source.size <= 0) {
      await source.handle.close()
      return { items: [], hasMore: false, itemBytes: 0 }
    }
    const page = await readItemPageFromJsonl(source.handle, source.size, input.options)
    if (source.size >= input.compactionMinBytes) input.scheduleCompaction()
    return page
  } finally {
    release()
  }
}

async function statSize(path: string): Promise<number> {
  const handle = await open(path, 'r').catch(() => null)
  if (!handle) return 0
  try {
    return (await handle.stat()).size
  } finally {
    await handle.close()
  }
}
