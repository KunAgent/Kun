import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../../../contracts/items.js'
import { makeAssistantTextItem, makeToolResultItem, makeUserItem } from '../../../domain/item.js'
import { remoteFixture } from '../../testing/runtime.test-support.js'
import { RELAY_HISTORY_ITEM_BYTES, RELAY_HISTORY_PAGE_BYTES, RELAY_LATEST_PAGE_BYTES, relayHistoryPage } from './relay-page.js'

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const ids = (history: { turns?: { items?: TurnItem[] }[] }) => (history.turns ?? []).flatMap((turn) => (turn.items ?? []).map((item) => item.id))

function harnessTurn(turnId: string, results: number, outputChars: number) {
  const threadId = 'thread'
  return [
    makeUserItem({ id: turnId + '_ask', turnId, threadId, text: 'make the product video' }),
    ...Array.from({ length: results }, (_, index) => makeToolResultItem({ id: `${turnId}_result_${index}`, turnId, threadId,
      callId: 'call_' + index, toolName: 'shell', output: { stdout: String(index).repeat(outputChars) } })),
    makeAssistantTextItem({ id: turnId + '_done', turnId, threadId, text: 'Rendered 40 s at 1080p.' })
  ]
}

describe('relay-sized code history pages', () => {
  it('previews oversized items and trims the oldest side while keeping the running request', () => {
    const items = harnessTurn('turn_1', 90, 60_000)
    const history = { id: 'thread', turns: [{ id: 'turn_1', items }], activeTurn: { id: 'turn_1' }, latestTurn: { id: 'turn_1' },
      timeline: { hasMore: false, itemCount: items.length, itemBytes: bytes(items) } }
    expect(bytes(history)).toBeGreaterThan(4 * 1024 * 1024)

    const { relayed, retained } = relayHistoryPage(history)
    const kept = relayed.turns[0]!.items!
    expect(bytes(relayed)).toBeLessThan(RELAY_LATEST_PAGE_BYTES + 4096)
    // An older page, read with a cursor, keeps the larger budget.
    const older = relayHistoryPage({ ...history, activeTurn: null, latestTurn: null }, 'turn_1_result_80').relayed
    expect(bytes(older)).toBeGreaterThan(RELAY_LATEST_PAGE_BYTES)
    expect(bytes(older)).toBeLessThan(RELAY_HISTORY_PAGE_BYTES + 4096)
    expect(kept[0]!.id).toBe('turn_1_ask')
    expect(kept.at(-1)!.id).toBe('turn_1_done')
    expect(relayed.timeline).toMatchObject({ hasMore: true, nextCursor: kept[1]!.id, itemCount: kept.length })
    for (const item of kept.filter((value) => value.kind === 'tool_result')) {
      expect(bytes(item)).toBeLessThanOrEqual(RELAY_HISTORY_ITEM_BYTES)
      expect(item).toMatchObject({ truncated: true, output: { __timelineTruncated: true } })
    }
    expect(ids(retained)).toEqual(ids(relayed))
    expect(retained.turns[0]!.items!.find((item) => item.kind === 'tool_result')).toEqual(
      items.find((item) => item.id === kept.find((value) => value.kind === 'tool_result')!.id))
  })

  it('keeps a page that already fits, including its desktop cursor', () => {
    const items = harnessTurn('turn_2', 3, 100)
    const history = { turns: [{ id: 'turn_2', items }], latestTurn: { id: 'turn_2' },
      timeline: { hasMore: true, nextCursor: 'turn_1_done', itemCount: items.length, itemBytes: bytes(items) } }
    const { relayed } = relayHistoryPage(history)
    expect(relayed.turns[0]!.items).toEqual(items)
    expect(relayed.turns[0]!.items![1]).toBe(items[1])
    expect(relayed.timeline).toMatchObject({ hasMore: true, nextCursor: 'turn_1_done', itemCount: items.length })
  })

  it('bounds item sizes of an imported source page without replacing its reference cursor', () => {
    const items = harnessTurn('codex:turn', 30, 300_000)
    const history = { turns: [{ id: 'codex:turn', items }], timeline: { hasMore: true, nextCursor: 'history:ref:page-2' } }
    const { relayed } = relayHistoryPage(history, 'history:ref:')
    expect(ids(relayed)).toEqual(items.map((item) => item.id))
    expect(relayed.timeline).toEqual(history.timeline)
    expect(bytes(relayed)).toBeLessThan(30 * RELAY_HISTORY_ITEM_BYTES)
  })

  it('pages a long task through code.history and still reads an original item with message.get', async () => {
    const f = await remoteFixture()
    try {
      const task = await f.code('Product video')
      const turn = await f.h.turns.startTurn({ threadId: task.id, request: { prompt: 'make the product video', clientSurface: 'gui' } })
      for (let index = 0; index < 80; index++) await f.h.sessionStore.appendItem(task.id, makeToolResultItem({ id: 'result_' + index,
        turnId: turn.turnId, threadId: task.id, callId: 'call_' + index, toolName: 'shell', output: { stdout: String(index % 10).repeat(60_000) } }))
      await f.h.turns.finishTurn({ threadId: task.id, turnId: turn.turnId, status: 'completed' })

      const seen = new Set<string>()
      let page = await f.call('code.history', { threadId: task.id }), pages = 1
      expect(bytes(page)).toBeLessThan(RELAY_HISTORY_PAGE_BYTES + 16 * 1024)
      for (;;) {
        for (const id of ids(page)) seen.add(id)
        if (!page.timeline.hasMore || !page.timeline.nextCursor) break
        page = await f.call('code.history', { threadId: task.id, cursor: page.timeline.nextCursor })
        expect(bytes(page)).toBeLessThan(RELAY_HISTORY_PAGE_BYTES + 16 * 1024)
        expect(++pages).toBeLessThan(10)
      }
      expect(pages).toBeGreaterThan(1)
      for (let index = 0; index < 80; index++) expect(seen).toContain('result_' + index)

      const latest = await f.call('code.history', { threadId: task.id })
      const preview = latest.turns.flatMap((value: any) => value.items).find((item: any) => item.id === 'result_79')
      expect(preview).toMatchObject({ truncated: true })
      const original = await f.call('message.get', { resource: { kind: 'code', id: task.id }, messageId: 'result_79',
        turnId: turn.turnId, historyVersion: latest.historyVersion, maxChars: 8192 })
      expect(original.content).toMatchObject({ field: 'output', offset: 0 })
      expect(original.content.totalChars).toBeGreaterThan(60_000)
    } finally { await f.close() }
  })
})
