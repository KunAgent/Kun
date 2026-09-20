import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { historyReferenceFixture, SOURCE_TEXT } from '../../../tests/support/history-reference-fixtures.js'
import { getComposedThreadTimeline } from './thread-reference-timeline.js'
import type { ServerRuntime } from './server-runtime.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('reference timeline composition', () => {
  it('paginates source history without adding native messages, turns or replay sequences', async () => {
    const f = await historyReferenceFixture(); roots.push(f.root)
    const before = await f.sessionStore.highestSeq(f.thread.id)
    const read = async (query: string) => JSON.parse((await getComposedThreadTimeline(f as unknown as ServerRuntime,
      f.thread.id, new Request(`http://kun/threads/${f.thread.id}/timeline${query}`))).body)
    const page = await read('?limit=2')
    expect(JSON.stringify(page.turns)).toContain(SOURCE_TEXT)
    expect(page.turns.flatMap((turn: { items: { id: string }[] }) => turn.items).every((item: { id: string }) => item.id.startsWith('codex:'))).toBe(true)
    expect(page.latestTurn).toBeNull()
    expect(page.activeTurn).toBeNull()
    expect(page.latestSeq).toBe(before)
    expect(page.timeline.hasMore).toBe(true)
    const older = await read(`?limit=2&before=${encodeURIComponent(page.timeline.nextCursor)}`)
    expect(older.turns[0].id).not.toBe(page.turns[0].id)
    expect(older.timeline.hasMore).toBe(false)
    expect(await f.sessionStore.loadItems(f.thread.id)).toEqual([])
    expect((await f.threadService.getMetadata(f.thread.id))?.turns).toEqual([])
  })

  it('keeps the native active-turn anchor and continues paging into the source separately', async () => {
    const f = await historyReferenceFixture(); roots.push(f.root)
    const started = await f.turnService.startTurn({ threadId: f.thread.id, request: { prompt: 'New continuation' } })
    const read = async (query = '') => JSON.parse((await getComposedThreadTimeline(f as unknown as ServerRuntime,
      f.thread.id, new Request(`http://kun/threads/${f.thread.id}/timeline${query}`))).body)
    const page = await read()
    expect(page.activeTurn.id).toBe(started.turnId)
    expect(JSON.stringify(page.turns)).not.toContain(SOURCE_TEXT)
    expect(page.timeline.nextCursor).toBe(`history:${f.reference.id}:`)
    const old = await read(`?before=${encodeURIComponent(page.timeline.nextCursor)}`)
    expect(JSON.stringify(old.turns)).toContain(SOURCE_TEXT)
    expect(old.activeTurn.id).toBe(started.turnId)
    expect(old.latestSeq).toBe(page.latestSeq)
    const exact = await read(`?turnId=${encodeURIComponent(old.turns[0].id)}`)
    expect(exact.turns).toHaveLength(1)
  })

  it('does not read a disabled source and leaves native continuation accessible', async () => {
    const f = await historyReferenceFixture(); roots.push(f.root)
    await f.turnService.startTurn({ threadId: f.thread.id, request: { prompt: 'Still available' } })
    const pageSpy = vi.spyOn(f.historyReferences, 'page')
    f.disable()
    const response = await getComposedThreadTimeline(f as unknown as ServerRuntime, f.thread.id,
      new Request(`http://kun/threads/${f.thread.id}/timeline`))
    expect(response.status).toBe(200)
    expect(response.body).toContain('Still available')
    expect(JSON.parse(response.body).sourceHistory.status).toBe('disabled')
    expect(pageSpy).not.toHaveBeenCalled()
    const invalid = await getComposedThreadTimeline(f as unknown as ServerRuntime, f.thread.id,
      new Request(`http://kun/threads/${f.thread.id}/timeline?before=history:other:cursor`))
    expect(invalid.status).toBe(400)
  })
})
