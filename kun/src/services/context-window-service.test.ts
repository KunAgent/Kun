import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { FileContextWindowStore } from '../adapters/file/file-context-window-store.js'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
} from '../contracts/context-windows.js'
import type { TurnItem } from '../contracts/items.js'
import { ContextWindowTurnItem } from '../contracts/items.js'
import type { ItemHistoryCommit, ItemHistoryPageOptions } from '../ports/session-store.js'
import { ContextWindowNotes } from './context-window-notes.js'
import { ContextWindowService } from './context-window-service.js'
import { WINDOW_ZERO_ID } from './context-window-index.js'

let seq = 0
function message(id: string, text: string): Extract<TurnItem, { kind: 'user_message' }> {
  seq += 1
  return {
    id,
    turnId: 'turn-1',
    threadId: 'thread1',
    kind: 'user_message',
    role: 'user',
    status: 'completed',
    createdAt: `2026-09-14T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    text
  }
}

describe('ContextWindowService', () => {
  let dataDir: string
  let sessionStore: InMemorySessionStore
  let service: ContextWindowService

  const makeService = (overrides: Partial<ConstructorParameters<typeof ContextWindowService>[0]> = {}) => {
    const holder: { current?: ContextWindowService } = {}
    const service = new ContextWindowService({
      sessionStore,
      notes: new ContextWindowNotes({
        store: new FileContextWindowStore({
          dataDir,
          limits: {
            maxFileBytes: CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
            maxFilesPerThread: CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
            maxTotalBytes: CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
          }
        }),
        commitPosition: (threadId) => holder.current
          ? holder.current.historyPosition(threadId)
          : Promise.resolve(0)
      }),
      ...overrides
    })
    holder.current = service
    return service
  }

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-context-windows-'))
    sessionStore = new InMemorySessionStore()
    service = makeService()
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  async function seed(items: TurnItem[]) {
    for (const item of items) await sessionStore.appendItem('thread1', item)
  }

  /** Mirror the fork lifecycle: the child receives the parent's cloned items. */
  async function cloneItemsTo(targetThreadId: string) {
    const items = await sessionStore.loadItems('thread1')
    for (const item of items) {
      await sessionStore.appendItem(targetThreadId, { ...item, threadId: targetThreadId } as TurnItem)
    }
  }

  describe('history queries (2.1)', () => {
    it('initializes window 0 on demand from retained legacy history only', async () => {
      await seed([
        message('u1', 'deploy the service'),
        message('u2', 'use the blue/green strategy'),
        message('u3', 'then run smoke tests')
      ])
      const windows = await service.listWindows('thread1', {})
      expect(windows.windows).toHaveLength(1)
      expect(windows.windows[0]).toMatchObject({
        windowId: WINDOW_ZERO_ID,
        reason: 'initial',
        itemRange: { firstItemId: 'u1', lastItemId: 'u3', itemCount: 3 }
      })
      expect(windows.nextCursor).toBeNull()

      const items = await service.listItems('thread1', { windowId: WINDOW_ZERO_ID })
      expect(items.items.map((entry) => entry.itemId)).toEqual(['u1', 'u2', 'u3'])
      expect(items.items[0]).toMatchObject({ kind: 'user_message', role: 'user' })

      const read = await service.readItem('thread1', { windowId: WINDOW_ZERO_ID, itemId: 'u2' })
      expect(read.segments[0]?.text).toBe('use the blue/green strategy')

      const search = await service.searchContents('thread1', { query: 'blue/green' })
      expect(search.matches).toHaveLength(1)
      expect(search.matches[0]).toMatchObject({ windowId: WINDOW_ZERO_ID, itemId: 'u2' })
      expect(search.matches[0]?.snippets[0]?.truncated).toBe(false)
    })

    it('queries through bounded item pages without loadItems or the event log', async () => {
      await seed([message('u1', 'alpha'), message('u2', 'beta')])
      const loadItemsSpy = vi.spyOn(sessionStore, 'loadItems').mockRejectedValue(new Error('no full-array loads'))
      const loadEventsSpy = vi.spyOn(sessionStore, 'loadEventsSince')
      await service.listWindows('thread1', {})
      await service.listItems('thread1', { windowId: WINDOW_ZERO_ID })
      await service.readItem('thread1', { windowId: WINDOW_ZERO_ID, itemId: 'u1' })
      await service.searchContents('thread1', { query: 'beta' })
      expect(loadItemsSpy).not.toHaveBeenCalled()
      expect(loadEventsSpy).not.toHaveBeenCalled()
    })

    it('pages window items with cursor continuation', async () => {
      const items = Array.from({ length: 25 }, (_, index) =>
        message(`m${index}`, `message ${index}`))
      await seed(items)
      const first = await service.listItems('thread1', { windowId: WINDOW_ZERO_ID, pageSize: 20 })
      expect(first.items).toHaveLength(20)
      expect(first.nextCursor).toEqual(expect.any(String))
      const second = await service.listItems('thread1', {
        windowId: WINDOW_ZERO_ID,
        cursor: first.nextCursor
      })
      expect(second.items.map((entry) => entry.itemId)).toEqual(['m20', 'm21', 'm22', 'm23', 'm24'])
      expect(second.nextCursor).toBeNull()
    })

    it('pages the window listing newest first', async () => {
      await seed([message('u1', 'one'), message('u2', 'two')])
      for (let index = 1; index <= 3; index += 1) {
        const result = await service.commitWindowCheckpoint({
          threadId: 'thread1',
          turnId: 'turn-1',
          windowId: `win-${index}`,
          reason: 'model',
          initializationRef: `init-${index}`,
          operationId: `op-${index}`
        })
        expect(result.status).toBe('committed')
      }
      const first = await service.listWindows('thread1', { pageSize: 2 })
      expect(first.windows.map((entry) => entry.windowId)).toEqual(['win-3', 'win-2'])
      const second = await service.listWindows('thread1', { pageSize: 2, cursor: first.nextCursor! })
      expect(second.windows.map((entry) => entry.windowId)).toEqual(['win-1', WINDOW_ZERO_ID])
      expect(second.nextCursor).toBeNull()
    })

    it('keeps raw items queryable across a boundary and scopes searches per window', async () => {
      await seed([message('u1', 'before boundary'), message('u2', 'kept verbatim')])
      await service.commitWindowCheckpoint({
        threadId: 'thread1',
        turnId: 'turn-1',
        windowId: 'win-1',
        reason: 'model',
        initializationRef: 'init-1',
        operationId: 'op-1'
      })
      await seed([message('u3', 'after boundary')])

      const windows = await service.listWindows('thread1', {})
      expect(windows.windows.map((entry) => entry.windowId)).toEqual(['win-1', WINDOW_ZERO_ID])
      const windowZero = windows.windows.find((entry) => entry.windowId === WINDOW_ZERO_ID)!
      const windowOne = windows.windows.find((entry) => entry.windowId === 'win-1')!
      expect(windowZero.itemRange).toEqual({ firstItemId: 'u1', lastItemId: 'u2', itemCount: 2 })
      expect(windowOne.itemRange).toEqual({ firstItemId: 'u3', lastItemId: 'u3', itemCount: 1 })

      const before = await service.readItem('thread1', { windowId: WINDOW_ZERO_ID, itemId: 'u1' })
      expect(before.segments[0]?.text).toBe('before boundary')
      const after = await service.readItem('thread1', { windowId: 'win-1', itemId: 'u3' })
      expect(after.segments[0]?.text).toBe('after boundary')

      const scoped = await service.searchContents('thread1', { query: 'verbatim', windowId: WINDOW_ZERO_ID })
      expect(scoped.matches.map((match) => match.itemId)).toEqual(['u2'])
      const unscoped = await service.searchContents('thread1', { query: 'boundary' })
      expect(unscoped.matches.map((match) => match.windowId).sort()).toEqual([WINDOW_ZERO_ID, 'win-1'])
    })

    it('returns access-controlled attachment references without inline binary', async () => {
      await seed([{
        ...message('u1', 'see attachment'),
        attachmentIds: ['att-1', 'att-2']
      }])
      const withResolver = makeService({
        resolveAttachment: async (_threadId, attachmentId) =>
          attachmentId === 'att-1'
            ? { attachmentId, name: 'scan.png', mimeType: 'image/png', byteSize: 2048, access: 'allowed' }
            : { attachmentId, byteSize: 0, access: 'denied' }
      })
      const read = await withResolver.readItem('thread1', { windowId: WINDOW_ZERO_ID, itemId: 'u1' })
      expect(read.attachments).toEqual([
        { attachmentId: 'att-1', name: 'scan.png', mimeType: 'image/png', byteSize: 2048, access: 'allowed' },
        { attachmentId: 'att-2', byteSize: 0, access: 'denied' }
      ])
      const denied = await service.readItem('thread1', { windowId: WINDOW_ZERO_ID, itemId: 'u1' })
      expect(denied.attachments.every((ref) => ref.access === 'denied')).toBe(true)
    })

    it('segments oversized item text with continuation metadata', async () => {
      const original = 'x'.repeat(100_000)
      await seed([message('u1', original)])
      const parts: string[] = []
      let offset = 0
      for (;;) {
        const page = await service.readItem('thread1', { windowId: WINDOW_ZERO_ID, itemId: 'u1', offset })
        parts.push(page.segments[0]?.text ?? '')
        expect(Buffer.byteLength(page.segments[0]?.text ?? '', 'utf8')).toBeLessThanOrEqual(16 * 1024)
        if (!page.truncated) break
        expect(page.nextOffset).toBeGreaterThan(offset)
        offset = page.nextOffset!
      }
      expect(parts.join('')).toBe(original)
      expect(parts.length).toBeGreaterThan(1)
    })
  })

  describe('checkpoint commit (2.2)', () => {
    it('commits a revision-tagged boundary and replays the same operation id', async () => {
      await seed([message('u1', 'one')])
      const first = await service.commitWindowCheckpoint({
        threadId: 'thread1',
        turnId: 'turn-1',
        windowId: 'win-1',
        reason: 'pressure',
        initializationRef: 'init-1',
        operationId: 'op-9',
        replacedTokens: 1234
      })
      expect(first.status).toBe('committed')
      if (first.status !== 'committed') return
      expect(first.item).toMatchObject({
        kind: 'context_window',
        windowId: 'win-1',
        previousWindowId: null,
        reason: 'pressure',
        operationId: 'op-9',
        replacedTokens: 1234
      })
      expect(first.item.sourceHistoryRevision).toBeGreaterThan(0)
      expect(first.revision).toBeGreaterThan(0)

      const replay = await service.commitWindowCheckpoint({
        threadId: 'thread1',
        turnId: 'turn-1',
        windowId: 'win-1',
        reason: 'pressure',
        initializationRef: 'init-1',
        operationId: 'op-9'
      })
      expect(replay.status).toBe('replayed')
      const windows = await service.listWindows('thread1', {})
      expect(windows.windows.map((entry) => entry.windowId).sort()).toEqual([WINDOW_ZERO_ID, 'win-1'])
    })

    it('cuts before the requested item and never drops concurrent appends', async () => {
      await seed([message('u1', 'one'), message('u2', 'two'), message('u3', 'three')])
      const result = await service.commitWindowCheckpoint({
        threadId: 'thread1',
        turnId: 'turn-1',
        windowId: 'win-1',
        reason: 'model',
        initializationRef: 'init-1',
        operationId: 'op-cut',
        splitBefore: { kind: 'item', itemId: 'u3' }
      })
      expect(result.status).toBe('committed')
      const windows = await service.listWindows('thread1', {})
      const windowZero = windows.windows.find((entry) => entry.windowId === WINDOW_ZERO_ID)!
      const windowOne = windows.windows.find((entry) => entry.windowId === 'win-1')!
      expect(windowZero.itemRange).toEqual({ firstItemId: 'u1', lastItemId: 'u2', itemCount: 2 })
      expect(windowOne.itemRange).toEqual({ firstItemId: 'u3', lastItemId: 'u3', itemCount: 1 })
    })

    it('rebuilds the pure insert after a commit conflict instead of overwriting new input', async () => {
      await seed([message('u1', 'one')])
      let interfered = false
      // Wrap the real store: on the first CAS attempt, land a concurrent
      // append first so the revision moves and the commit must retry.
      const racedStore = new Proxy(sessionStore, {
        get(target, prop, receiver) {
          if (prop !== 'rewriteItemsIfRevision') {
            return Reflect.get(target, prop, receiver)
          }
          return async (threadId: string, expected: number, items: TurnItem[]): Promise<ItemHistoryCommit> => {
            if (!interfered) {
              interfered = true
              await target.appendItem(threadId, message('u-late', 'steered input'))
            }
            return target.rewriteItemsIfRevision(threadId, expected, items)
          }
        }
      })
      const racedService = makeService({ sessionStore: racedStore as InMemorySessionStore })
      const result = await racedService.commitWindowCheckpoint({
        threadId: 'thread1',
        turnId: 'turn-1',
        windowId: 'win-1',
        reason: 'model',
        initializationRef: 'init-1',
        operationId: 'op-race'
      })
      expect(result.status).toBe('committed')
      expect(interfered).toBe(true)
      const persisted = await sessionStore.loadItems('thread1')
      const ids = persisted.map((item) => item.id)
      expect(ids).toContain('u-late')
      expect(ids.filter((id) => id.startsWith('context_window_'))).toHaveLength(1)
      expect(ids.indexOf('u-late')).toBeLessThan(ids.findIndex((id) => id.startsWith('context_window_')))
    })

    it('leaves history untouched when the store write fails', async () => {
      await seed([message('u1', 'one')])
      const failing = new Proxy(sessionStore, {
        get(target, prop, receiver) {
          if (prop !== 'rewriteItemsIfRevision') return Reflect.get(target, prop, receiver)
          return () => Promise.reject(new Error('disk full'))
        }
      })
      const failingService = makeService({ sessionStore: failing as InMemorySessionStore })
      await expect(failingService.commitWindowCheckpoint({
        threadId: 'thread1',
        turnId: 'turn-1',
        windowId: 'win-1',
        reason: 'overflow',
        initializationRef: 'init-1',
        operationId: 'op-fail'
      })).rejects.toThrow('disk full')
      const persisted = await sessionStore.loadItems('thread1')
      expect(persisted.map((item) => item.id)).toEqual(['u1'])
    })

    it('reports cancelled when the signal aborts before the commit', async () => {
      await seed([message('u1', 'one')])
      const controller = new AbortController()
      controller.abort()
      const result = await service.commitWindowCheckpoint({
        threadId: 'thread1',
        turnId: 'turn-1',
        windowId: 'win-1',
        reason: 'model',
        initializationRef: 'init-1',
        operationId: 'op-cancel',
        signal: controller.signal
      })
      expect(result.status).toBe('cancelled')
      const persisted = await sessionStore.loadItems('thread1')
      expect(persisted.map((item) => item.id)).toEqual(['u1'])
    })

    it('reports conflict when every CAS attempt loses the revision race', async () => {
      await seed([message('u1', 'one')])
      const conflicting = new Proxy(sessionStore, {
        get(target, prop, receiver) {
          if (prop !== 'rewriteItemsIfRevision') return Reflect.get(target, prop, receiver)
          return async (_threadId: string, _expected: number, _items: TurnItem[]): Promise<ItemHistoryCommit> =>
            ({ applied: false, reason: 'conflict', revision: 99 })
        }
      })
      const conflictingService = makeService({ sessionStore: conflicting as InMemorySessionStore })
      const result = await conflictingService.commitWindowCheckpoint({
        threadId: 'thread1',
        turnId: 'turn-1',
        windowId: 'win-1',
        reason: 'model',
        initializationRef: 'init-1',
        operationId: 'op-conflict'
      })
      expect(result.status).toBe('conflict')
    })
  })

  describe('lifecycle (2.4)', () => {
    it('isolates forked notes and keeps parent writes private', async () => {
      await service.notes.writeFile('thread1', {
        path: 'progress/log.md',
        text: 'parent state',
        expectedRevision: 0
      })
      await service.forkThreadData('thread1', 'thread2')
      const child = await service.notes.readFile('thread2', { path: 'progress/log.md' })
      expect(child.revision).toBe(1)
      expect(child.segments[0]?.text).toBe('parent state')

      await service.notes.appendToFile('thread2', {
        path: 'progress/log.md',
        text: '+child',
        operationId: 'op-child'
      })
      const parentAfter = await service.notes.readFile('thread1', { path: 'progress/log.md' })
      expect(parentAfter.segments[0]?.text).toBe('parent state')
      expect(parentAfter.revision).toBe(1)
      const childAfter = await service.notes.readFile('thread2', { path: 'progress/log.md' })
      expect(childAfter.segments[0]?.text).toBe('parent state+child')
      expect(childAfter.revision).toBe(2)
    })

    it('keeps threads fully isolated without any fork', async () => {
      await service.notes.writeFile('thread1', { path: 'a.md', text: 'A', expectedRevision: 0 })
      const foreign = await service.notes.listFilesByPrefix('thread-other', {})
      expect(foreign.files).toEqual([])
      await expect(service.notes.readFile('thread-other', { path: 'a.md' })).rejects.toThrow('note not found')
    })

    it('cascade-deletes feature data while the session store is untouched', async () => {
      await seed([message('u1', 'kept')])
      await service.commitWindowCheckpoint({
        threadId: 'thread1',
        turnId: 'turn-1',
        windowId: 'win-1',
        reason: 'model',
        initializationRef: 'init-1',
        operationId: 'op-del'
      })
      await service.notes.writeFile('thread1', { path: 'a.md', text: 'A', expectedRevision: 0 })
      await service.deleteThreadData('thread1')
      expect((await service.notes.listFilesByPrefix('thread1', {})).files).toEqual([])
      // The window boundary stays in canonical history: disabling or deleting
      // feature data must not corrupt the durable item stream.
      const persisted = await sessionStore.loadItems('thread1')
      expect(persisted.some((item) => item.kind === 'context_window')).toBe(true)
      expect(persisted.some((item) => item.id === 'u1')).toBe(true)
    })

    it('restores windows and notes across a restart', async () => {
      await seed([message('u1', 'before')])
      await service.commitWindowCheckpoint({
        threadId: 'thread1',
        turnId: 'turn-1',
        windowId: 'win-1',
        reason: 'model',
        initializationRef: 'init-1',
        operationId: 'op-restart'
      })
      await service.notes.writeFile('thread1', { path: 'a.md', text: 'survivor', expectedRevision: 0 })

      const restarted = makeService()
      const windows = await restarted.listWindows('thread1', {})
      expect(windows.windows.map((entry) => entry.windowId).sort()).toEqual([WINDOW_ZERO_ID, 'win-1'])
      const note = await restarted.notes.readFile('thread1', { path: 'a.md' })
      expect(note).toMatchObject({ revision: 1 })
      expect(note.segments[0]?.text).toBe('survivor')
    })

    it('copies only the note revisions available at the fork point', async () => {
      await seed([message('u1', 'one')])
      await service.notes.writeFile('thread1', {
        path: 'progress/log.md',
        text: 'v1 decision',
        expectedRevision: 0
      })
      // Mirror the fork lifecycle: the child's cloned history is persisted
      // before onForked fires, so it defines the fork-point cutoff.
      await cloneItemsTo('thread2')
      await service.forkThreadData('thread1', 'thread2')
      const child = await service.notes.readFile('thread2', { path: 'progress/log.md' })
      expect(child.segments[0]?.text).toBe('v1 decision')

      // The parent keeps working: revisions committed after the fork point
      // must not leak into the branch.
      await seed([message('u2', 'two')])
      await service.notes.writeFile('thread1', {
        path: 'progress/log.md',
        text: 'v2 later decision',
        expectedRevision: 1
      })
      const childAfter = await service.notes.readFile('thread2', { path: 'progress/log.md' })
      expect(childAfter.segments[0]?.text).toBe('v1 decision')
      const parentAfter = await service.notes.readFile('thread1', { path: 'progress/log.md' })
      expect(parentAfter.segments[0]?.text).toBe('v2 later decision')

      // Child writes stay private to the branch.
      await service.notes.appendToFile('thread2', {
        path: 'progress/log.md',
        text: '\nchild only',
        operationId: 'op-child'
      })
      const parentFinal = await service.notes.readFile('thread1', { path: 'progress/log.md' })
      expect(parentFinal.segments[0]?.text).toBe('v2 later decision')
      const childFinal = await service.notes.readFile('thread2', { path: 'progress/log.md' })
      expect(childFinal.segments[0]?.text).toBe('v1 decision\nchild only')
    })

    it('copies every note revision when forking at the thread head', async () => {
      await seed([message('u1', 'one'), message('u2', 'two')])
      await service.notes.writeFile('thread1', { path: 'progress/log.md', text: 'v1', expectedRevision: 0 })
      await service.notes.writeFile('thread1', { path: 'progress/log.md', text: 'v2', expectedRevision: 1 })
      await cloneItemsTo('thread3')

      await service.forkThreadData('thread1', 'thread3')
      const child = await service.notes.readFile('thread3', { path: 'progress/log.md' })
      expect(child).toMatchObject({ revision: 2 })
      expect(child.segments[0]?.text).toBe('v2')
    })
  })

  describe('multi-page history scan (chronological order)', () => {
    /** Clamp page size so every query spans multiple store pages. */
    function smallPageStore(pageItems: number) {
      let fullArrayReads = 0
      const paged = new Proxy(sessionStore, {
        get(target, prop, receiver) {
          if (prop === 'loadItems') {
            fullArrayReads += 1
            return () => Promise.reject(new Error('no full-array loads'))
          }
          if (prop !== 'loadItemPage') return Reflect.get(target, prop, receiver)
          return (threadId: string, options: ItemHistoryPageOptions) =>
            target.loadItemPage!(threadId, { ...options, maxItems: Math.min(options.maxItems, pageItems) })
        }
      }) as InMemorySessionStore
      return { paged, fullArrayReads: () => fullArrayReads }
    }

    function boundary(windowId: string): TurnItem {
      return ContextWindowTurnItem.parse({
        id: `boundary-${windowId}`,
        turnId: 'turn-1',
        threadId: 'thread1',
        role: 'system',
        status: 'completed',
        createdAt: '2026-09-14T00:00:00.000Z',
        kind: 'context_window',
        schemaVersion: 1,
        windowId,
        previousWindowId: null,
        reason: 'model',
        sourceHistoryRevision: 1,
        splitBefore: { kind: 'seq', seq: 0 },
        initializationRef: 'init-1',
        operationId: `op-${windowId}`,
        replacedTokens: 0
      })
    }

    it('derives windows, reads, and searches in true chronological order across pages', async () => {
      const { paged, fullArrayReads } = smallPageStore(3)
      const pagedService = makeService({ sessionStore: paged })
      const seeded = [
        ...Array.from({ length: 7 }, (_, index) => message(`m${index}`, `message ${index} old`)),
        boundary('win-1'),
        message('m7', 'message 7 old'),
        message('m8', 'needle newer'),
        message('m9', 'message 9'),
        message('m10', 'needle newest'),
        message('m11', 'message 11')
      ]
      seeded[2] = message('m2', 'needle oldest')
      await seed(seeded)

      const windows = await pagedService.listWindows('thread1', {})
      expect(windows.windows.map((entry) => entry.windowId)).toEqual(['win-1', WINDOW_ZERO_ID])
      // Window 0 covers the oldest items even though the scan starts newest-first.
      expect(windows.windows[1]!.itemRange)
        .toEqual({ firstItemId: 'm0', lastItemId: 'm6', itemCount: 7 })
      expect(windows.windows[0]!.itemRange)
        .toEqual({ firstItemId: 'm7', lastItemId: 'm11', itemCount: 5 })

      const zeroItems = await pagedService.listItems('thread1', { windowId: WINDOW_ZERO_ID })
      expect(zeroItems.items.map((entry) => entry.itemId))
        .toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'])
      const oneItems = await pagedService.listItems('thread1', { windowId: 'win-1' })
      expect(oneItems.items.map((entry) => entry.itemId))
        .toEqual(['m7', 'm8', 'm9', 'm10', 'm11'])
      // Seq numbers account for the boundary item before window 1.
      expect(oneItems.items[0]).toMatchObject({ itemId: 'm7', seq: 8 })

      const oldest = await pagedService.readItem('thread1', { windowId: WINDOW_ZERO_ID, itemId: 'm0' })
      expect(oldest.segments[0]?.text).toBe('message 0 old')
      const newest = await pagedService.readItem('thread1', { windowId: 'win-1', itemId: 'm11' })
      expect(newest.segments[0]?.text).toBe('message 11')

      // Global matches come back chronologically, across page and window
      // boundaries, with correct window attribution.
      const search = await pagedService.searchContents('thread1', { query: 'needle' })
      expect(search.matches.map((match) => [match.windowId, match.itemId])).toEqual([
        [WINDOW_ZERO_ID, 'm2'],
        ['win-1', 'm8'],
        ['win-1', 'm10']
      ])
      const scoped = await pagedService.searchContents('thread1', { query: 'old', windowId: WINDOW_ZERO_ID })
      expect(scoped.matches.map((match) => match.itemId))
        .toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'])

      expect(fullArrayReads()).toBe(0)
    })

    it('streams a boundary-less history oldest-first across pages', async () => {
      const { paged, fullArrayReads } = smallPageStore(4)
      const pagedService = makeService({ sessionStore: paged })
      await seed(Array.from({ length: 9 }, (_, index) => message(`m${index}`, `text ${index}`)))

      const listed = await pagedService.listItems('thread1', { windowId: WINDOW_ZERO_ID, pageSize: 20 })
      expect(listed.items.map((entry) => entry.itemId))
        .toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'])
      const search = await pagedService.searchContents('thread1', { query: 'text' })
      expect(search.matches.map((match) => match.itemId))
        .toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'])
      expect(fullArrayReads()).toBe(0)
    })

    it('excludes internal records from window listings, reads, and search on the paged path', async () => {
      const { paged, fullArrayReads } = smallPageStore(3)
      const pagedService = makeService({ sessionStore: paged })
      const internal = (id: string, content: string): TurnItem => ({
        id, turnId: 'turn-1', threadId: 'thread1',
        kind: 'runtime_context_source', role: 'system', status: 'completed',
        createdAt: '2026-09-14T00:00:00.000Z', contextKind: 'host-control', content
      })
      await seed([
        message('m0', 'message 0'),
        boundary('win-1'),
        internal('init-1', 'window init with needle secret'),
        message('m1', 'message 1'),
        internal('init-2', 'another internal record'),
        message('m2', 'message 2 newest')
      ])

      const windows = await pagedService.listWindows('thread1', {})
      expect(windows.windows[0]!.itemRange.itemCount).toBe(2)

      const listed = await pagedService.listItems('thread1', { windowId: 'win-1' })
      expect(listed.items.map((entry) => entry.itemId)).toEqual(['m1', 'm2'])

      // The newest public item stays reachable even though internal records
      // share the window range and the recorded itemCount.
      const newest = await pagedService.readItem('thread1', { windowId: 'win-1', itemId: 'm2' })
      expect(newest.segments[0]?.text).toBe('message 2 newest')
      await expect(
        pagedService.readItem('thread1', { windowId: 'win-1', itemId: 'init-1' })
      ).rejects.toThrow('not found')

      // Internal record text is not searchable through the history tools.
      const search = await pagedService.searchContents('thread1', { query: 'needle' })
      expect(search.matches).toEqual([])
      expect(fullArrayReads()).toBe(0)
    })
  })
})
