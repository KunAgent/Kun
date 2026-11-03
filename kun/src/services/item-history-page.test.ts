import { describe, expect, it } from 'vitest'
import { makeAssistantTextItem, makeToolResultItem, makeUserItem } from '../domain/item.js'
import type { TurnItem } from '../contracts/items.js'
import { buildPublicItemHistoryPage } from './item-history-page.js'

describe('buildPublicItemHistoryPage', () => {
  it('returns chronological pages from the newest items with a stable older cursor', () => {
    const items = Array.from({ length: 350 }, (_, index) => makeUserItem({
      id: `item_${String(index).padStart(3, '0')}`,
      threadId: 'thr_page',
      turnId: `turn_${Math.floor(index / 2)}`,
      text: `message ${index}`
    }))

    const latest = buildPublicItemHistoryPage(items, {
      maxItems: 300,
      maxBytes: 4 * 1024 * 1024
    })
    expect(latest.items).toHaveLength(300)
    expect(latest.items[0]?.id).toBe('item_050')
    expect(latest.items.at(-1)?.id).toBe('item_349')
    expect(latest).toMatchObject({ hasMore: true, nextCursor: 'item_050' })

    const older = buildPublicItemHistoryPage(items, {
      before: latest.nextCursor,
      maxItems: 300,
      maxBytes: 4 * 1024 * 1024
    })
    expect(older.items.map((item) => item.id)).toEqual(
      Array.from({ length: 50 }, (_, index) => `item_${String(index).padStart(3, '0')}`)
    )
    expect(older).toMatchObject({ hasMore: false })
  })

  it('replaces an oversized tool payload with a bounded preview', () => {
    const page = buildPublicItemHistoryPage([
      makeToolResultItem({
        id: 'item_large',
        threadId: 'thr_large',
        turnId: 'turn_large',
        callId: 'call_large',
        toolName: 'bash',
        output: { text: 'x'.repeat(5 * 1024 * 1024) },
        status: 'completed'
      })
    ], {
      maxItems: 300,
      maxBytes: 4 * 1024 * 1024
    })

    expect(page.items).toHaveLength(1)
    expect(page.itemBytes).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(page.items[0]).toMatchObject({
      id: 'item_large',
      kind: 'tool_result',
      output: { __timelineTruncated: true }
    })
  })

  it.each([
    {
      id: 'item_large_input',
      threadId: 'thr_large',
      turnId: 'turn_large',
      role: 'system',
      status: 'submitted',
      createdAt: '2026-08-09T00:00:00.000Z',
      kind: 'user_input',
      inputId: 'input_large',
      prompt: 'choose',
      questions: [],
      answers: [{ id: 'answer', label: 'x'.repeat(5 * 1024 * 1024), value: '' }]
    },
    {
      id: 'item_large_review',
      threadId: 'thr_large',
      turnId: 'turn_large',
      role: 'assistant',
      status: 'completed',
      createdAt: '2026-08-09T00:00:00.000Z',
      kind: 'review',
      target: { kind: 'custom', instructions: 'x'.repeat(5 * 1024 * 1024) },
      title: 'Review',
      reviewText: 'done'
    }
  ] satisfies TurnItem[])('enforces the byte postcondition for $kind metadata', (item) => {
    const page = buildPublicItemHistoryPage([item], {
      maxItems: 300,
      maxBytes: 4 * 1024 * 1024
    })

    expect(page.items).toHaveLength(1)
    expect(page.itemBytes).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(page.items[0]).toMatchObject({ id: item.id, kind: item.kind })
  })

  it('anchors the running turn user message when process items overflow the page', () => {
    // One turn whose opening user message is older than the newest page
    // budget, followed by 349 process items.
    const turnId = 'turn_running'
    const items: TurnItem[] = [
      makeUserItem({
        id: 'user_active', threadId: 'thr_anchor', turnId, text: 'fix the pipeline'
      })
    ]
    for (let index = 0; index < 349; index += 1) {
      items.push(makeAssistantTextItemFixture(`item_${String(index).padStart(3, '0')}`, turnId))
    }

    const latest = buildPublicItemHistoryPage(items, {
      anchorTurnId: turnId,
      maxItems: 300,
      maxBytes: 4 * 1024 * 1024
    })
    expect(latest.items).toHaveLength(300)
    expect(latest.items[0]).toMatchObject({ id: 'user_active', kind: 'user_message' })
    // The cursor points at the retained window start, not the anchor, so the
    // next older page returns the anchor plus the items between it and the
    // window.
    expect(latest).toMatchObject({ hasMore: true, nextCursor: 'item_050' })

    const older = buildPublicItemHistoryPage(items, {
      before: latest.nextCursor,
      maxItems: 300,
      maxBytes: 4 * 1024 * 1024
    })
    expect(older.items.map((item) => item.id)).toEqual([
      'user_active',
      ...Array.from({ length: 50 }, (_, index) => `item_${String(index).padStart(3, '0')}`)
    ])
    expect(older).toMatchObject({ hasMore: false })

    // Merging the two pages yields every item exactly once (the anchor
    // repeats but is deduplicated by the renderer).
    const merged = [...older.items, ...latest.items]
    expect(merged.length).toBe(351)
    expect(new Set(merged.map((item) => item.id)).size).toBe(350)
  })

  it('keeps a short turn unmodified when the anchor already fits the window', () => {
    const turnId = 'turn_short'
    const items: TurnItem[] = [
      makeUserItem({
        id: 'user_short', threadId: 'thr_anchor', turnId, text: 'short turn'
      }),
      makeAssistantTextItemFixture('process_1', turnId)
    ]
    const page = buildPublicItemHistoryPage(items, {
      anchorTurnId: turnId,
      maxItems: 300,
      maxBytes: 4 * 1024 * 1024
    })
    expect(page.items.map((item) => item.id)).toEqual(['user_short', 'process_1'])
    expect(page).toMatchObject({ hasMore: false })
    expect(page.nextCursor).toBeUndefined()
  })

  it('ignores the anchor on older pages requested by cursor', () => {
    const items = Array.from({ length: 12 }, (_, index) => makeUserItem({
      id: `item_${String(index).padStart(2, '0')}`,
      threadId: 'thr_anchor',
      turnId: index === 11 ? 'turn_latest' : 'turn_old',
      text: `message ${index}`
    }))
    const page = buildPublicItemHistoryPage(items, {
      before: 'item_10',
      anchorTurnId: 'turn_latest',
      maxItems: 5,
      maxBytes: 64 * 1024
    })
    // Older pages are immutable history and never re-materialize the anchor.
    expect(page.items.map((item) => item.id)).toEqual([
      'item_05', 'item_06', 'item_07', 'item_08', 'item_09'
    ])
    expect(page).toMatchObject({ hasMore: true, nextCursor: 'item_05' })
  })

  it('keeps the newest turn reply on the first page when tool results fill the byte budget', () => {
    const tool = (index: number): TurnItem => makeToolResultItem({
      id: `tool_${String(index).padStart(2, '0')}`,
      threadId: 'thr_reply',
      turnId: 'turn_latest',
      callId: `call_${index}`,
      toolName: 'bash',
      output: { text: 'x'.repeat(20 * 1024) },
      status: 'completed'
    })
    const items: TurnItem[] = [
      makeUserItem({ id: 'user_1', threadId: 'thr_reply', turnId: 'turn_latest', text: 'continue' }),
      makeAssistantTextItem({ id: 'reply_1', threadId: 'thr_reply', turnId: 'turn_latest', text: 'the answer', status: 'completed' }),
      ...Array.from({ length: 20 }, (_, index) => tool(index))
    ]
    const page = buildPublicItemHistoryPage(items, { maxItems: 300, maxBytes: 100 * 1024 })
    expect(page.items.map((item) => item.id)).toContain('reply_1')
    expect(page.items.at(-1)?.id).toBe('tool_19')
    expect(page.hasMore).toBe(true)
    const older = buildPublicItemHistoryPage(items, { before: page.nextCursor, maxItems: 300, maxBytes: 100 * 1024 })
    expect(older.items.length).toBeGreaterThan(0)
  })
})

function makeAssistantTextItemFixture(id: string, turnId: string): TurnItem {
  return {
    id,
    turnId,
    threadId: 'thr_anchor',
    role: 'assistant',
    status: 'completed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    kind: 'assistant_text',
    text: `process ${id}`
  }
}
