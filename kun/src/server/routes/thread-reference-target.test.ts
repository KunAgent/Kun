import { rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { historyReferenceFixture } from '../../../tests/support/history-reference-fixtures.js'
import { getComposedThreadTimeline } from './thread-reference-timeline.js'
import type { ServerRuntime } from './server-runtime.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function longHistory(text = (index: number) => `answer-${index}`, count = 160) {
  const f = await historyReferenceFixture(); roots.push(f.root)
  const line = (type: string, payload: unknown) => JSON.stringify({ type, payload, timestamp: f.nowIso() })
  const records = [line('session_meta', { id: 'long-source', cwd: f.root }),
    line('event_msg', { type: 'task_started', turn_id: 'long-turn' }),
    line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'UNIQUE_EARLY_REQUEST' }] })]
  for (let index = 0; index < count; index += 1) records.push(line('response_item', {
    type: 'message', role: 'assistant', phase: index === count - 1 ? 'final_answer' : 'commentary',
    content: [{ type: 'output_text', text: text(index) }]
  }))
  records.push(line('event_msg', { type: 'task_complete', turn_id: 'long-turn' }))
  await writeFile(f.path, records.join('\n') + '\n')
  const { thread, reference } = await f.historyReferences.createBranch({ path: f.path, idempotencyKey: 'long-source' })
  const found = await f.historyReferences.readForThread(thread.id, { operation: 'search', query: 'UNIQUE_EARLY_REQUEST' })
  const match = /^\[([^\s]+) \/ ([^\s]+) \/ /m.exec(found.text)!
  expect(match).not.toBeNull()
  const turnId = match[1]!, itemId = match[2]!
  const read = async (extra: Record<string, string> = {}) => {
    const query = new URLSearchParams({ turnId, itemId, limit: '20', ...extra })
    const response = await getComposedThreadTimeline(f as unknown as ServerRuntime, thread.id,
      new Request(`http://kun/threads/${thread.id}/timeline?${query}`))
    return { response, body: JSON.parse(response.body) }
  }
  return { ...f, thread, reference, turnId, itemId, read }
}

describe('exact source record targets', () => {
  it('loads the actual early record and navigates the entire turn in both directions', async () => {
    const f = await longHistory()
    const first = await f.read()
    expect(first.response.status).toBe(200)
    expect(first.body.turns[0].items[0].id).toBe(f.itemId)
    expect(JSON.stringify(first.body.turns)).toContain('UNIQUE_EARLY_REQUEST')
    expect(first.body.timeline.target).toMatchObject({ turnId: f.turnId, itemId: f.itemId })
    expect(first.body.timeline.target.previousCursor).toBeUndefined()
    const all = [...first.body.turns[0].items]
    let target = first.body.timeline.target
    for (let count = 0; target.nextCursor && count < 20; count += 1) {
      const next = await f.read({ before: target.nextCursor })
      expect(next.response.status).toBe(200)
      all.push(...next.body.turns[0].items)
      target = next.body.timeline.target
    }
    expect(target.nextCursor).toBeUndefined()
    expect(all).toHaveLength(161)
    expect(new Set(all.map((item) => item.id)).size).toBe(161)
    expect(all.map((item) => item.sourceHistoryOrder.itemIndex))
      .toEqual(all.map((item) => item.sourceHistoryOrder.itemIndex).sort((a, b) => a - b))
    expect(all.every((item) => item.sourceHistoryOrder.referenceId === f.reference.id)).toBe(true)
    const back = await f.read({ before: target.previousCursor })
    expect(back.body.timeline.target.nextCursor).toBeTruthy()
    expect(back.body.turns[0].items.at(-1).sourceHistoryOrder.itemIndex)
      .toBeLessThan(all.at(-1).sourceHistoryOrder.itemIndex)
    expect(await f.sessionStore.loadItems(f.thread.id)).toEqual([])
  })

  it('rejects target cursor/reference and turn scope mismatches', async () => {
    const f = await longHistory()
    const { body } = await f.read()
    const wrongReference = await f.read({ before: body.timeline.target.nextCursor.replace(f.reference.id, 'other-ref') })
    expect(wrongReference.response.status).toBe(400)
    const wrongTurn = await f.read({ before: body.timeline.target.nextCursor, turnId: 'codex:long-source:another-turn' })
    expect(wrongTurn.body.turns ?? []).toEqual([])
    const wrongItem = await f.read({ itemId: 'codex:other-source:item:9' })
    expect(wrongItem.body.turns ?? []).toEqual([])
  })

  it('keeps the requested item while enforcing the UTF-8 page byte budget', async () => {
    const f = await longHistory(() => '汉'.repeat(20_000))
    const { body } = await f.read({ itemId: 'codex:long-source:long-turn:item:4', limit: '100' })
    const items = body.turns.flatMap((turn: { items: { id: string }[] }) => turn.items)
    expect(items.some((item: { id: string }) => item.id === 'codex:long-source:long-turn:item:4')).toBe(true)
    expect(body.timeline.itemBytes).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(body.timeline.target.nextCursor).toBeTruthy()
  })

  it('does not skip the adjacent records when large UTF-8 pages shrink in either direction', async () => {
    const f = await longHistory(() => '汉'.repeat(20_000), 220)
    const first = (await f.read({ limit: '100' })).body
    const forward = [...first.turns[0].items]
    let target = first.timeline.target
    let last = first
    while (target.nextCursor) {
      last = (await f.read({ limit: '100', before: target.nextCursor })).body
      expect(last.turns[0].items[0].sourceHistoryOrder.itemIndex)
        .toBe(forward.at(-1).sourceHistoryOrder.itemIndex + 1)
      forward.push(...last.turns[0].items)
      target = last.timeline.target
      expect(forward.length).toBeLessThanOrEqual(221)
    }
    expect(forward).toHaveLength(221)
    const backward = [...last.turns[0].items]
    while (target.previousCursor) {
      const older = (await f.read({ limit: '100', before: target.previousCursor })).body
      expect(older.turns[0].items.at(-1).sourceHistoryOrder.itemIndex)
        .toBe(backward[0].sourceHistoryOrder.itemIndex - 1)
      backward.unshift(...older.turns[0].items)
      target = older.timeline.target
      expect(backward.length).toBeLessThanOrEqual(221)
    }
    expect(backward.map((item) => item.id)).toEqual(forward.map((item) => item.id))
  })
})
