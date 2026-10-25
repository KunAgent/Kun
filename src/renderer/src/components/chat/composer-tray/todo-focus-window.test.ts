import { describe, expect, it } from 'vitest'
import type { ThreadTodoItem } from '../../../agent/types'
import { resolveTodoFocusWindow, summarizeTodoFold, type TodoFocusWindow } from './todo-focus-window'

/** `[start, end)` triples for compact assertions; `-` for an absent fold. */
function shape(window: TodoFocusWindow): string {
  const range = (value: { start: number; end: number } | null): string =>
    value ? `${value.start}-${value.end}` : '-'
  return `${range(window.before)} | ${range(window.visible)} | ${range(window.after)}`
}

function item(id: string, overrides: Partial<ThreadTodoItem> = {}): ThreadTodoItem {
  return {
    id,
    content: `Todo ${id}`,
    status: 'pending',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides
  }
}

describe('resolveTodoFocusWindow', () => {
  it('shows short lists (0..6 items) in full', () => {
    for (let total = 0; total <= 6; total += 1) {
      expect(shape(resolveTodoFocusWindow(total, Math.max(0, total - 1)))).toBe(`- | 0-${total} | -`)
    }
  })

  it('keeps one row before and one after the current step', () => {
    expect(shape(resolveTodoFocusWindow(12, 3))).toBe('0-2 | 2-5 | 5-12')
    expect(shape(resolveTodoFocusWindow(7, 3))).toBe('0-2 | 2-5 | 5-7')
  })

  it('extends forward when the current step is first', () => {
    expect(shape(resolveTodoFocusWindow(12, 0))).toBe('- | 0-3 | 3-12')
  })

  it('backfills from earlier items when the current step is last', () => {
    expect(shape(resolveTodoFocusWindow(12, 11))).toBe('0-9 | 9-12 | -')
    expect(shape(resolveTodoFocusWindow(12, 10))).toBe('0-9 | 9-12 | -')
  })

  it('shows a lone hidden row instead of folding it', () => {
    expect(shape(resolveTodoFocusWindow(7, 2))).toBe('- | 0-4 | 4-7')
    expect(shape(resolveTodoFocusWindow(7, 4))).toBe('0-3 | 3-7 | -')
    expect(shape(resolveTodoFocusWindow(12, 2))).toBe('- | 0-4 | 4-12')
  })

  it('anchors at the first item when there is no current step', () => {
    expect(shape(resolveTodoFocusWindow(9, -1))).toBe('- | 0-3 | 3-9')
    expect(shape(resolveTodoFocusWindow(9, 42))).toBe('- | 0-3 | 3-9')
    expect(shape(resolveTodoFocusWindow(9, Number.NaN))).toBe('- | 0-3 | 3-9')
  })

  it('treats an all-done list (current = last item) like a step at the end', () => {
    expect(shape(resolveTodoFocusWindow(8, 7))).toBe('0-5 | 5-8 | -')
  })

  it('covers every item exactly once, in order', () => {
    for (let total = 0; total <= 20; total += 1) {
      for (let current = -1; current <= total; current += 1) {
        const { before, visible, after } = resolveTodoFocusWindow(total, current)
        const indexes = [before, visible, after]
          .flatMap((range) => (range ? Array.from({ length: range.end - range.start }, (_, i) => range.start + i) : []))
        expect(indexes).toEqual(Array.from({ length: total }, (_, i) => i))
        if (before) expect(before.end - before.start).toBeGreaterThan(1)
        if (after) expect(after.end - after.start).toBeGreaterThan(1)
      }
    }
  })
})

describe('summarizeTodoFold', () => {
  const items = [
    item('a', { status: 'completed' }),
    item('b', { status: 'completed', taskStatus: 'failed' }),
    item('c', { status: 'completed' }),
    item('d'),
    item('e', { taskStatus: 'blocked' }),
    item('f', { taskStatus: 'blocked' }),
    item('g', { status: 'completed', taskStatus: 'succeeded' })
  ]

  it('labels runs that are all done or none done and counts trouble', () => {
    expect(summarizeTodoFold(items, { start: 0, end: 1 })).toMatchObject({ count: 1, allCompleted: true, noneCompleted: false })
    expect(summarizeTodoFold(items, { start: 0, end: 3 })).toMatchObject({
      count: 3,
      allCompleted: false,
      noneCompleted: false,
      failed: 1,
      blocked: 0
    })
    expect(summarizeTodoFold(items, { start: 3, end: 6 })).toMatchObject({
      count: 3,
      allCompleted: false,
      noneCompleted: true,
      blocked: 2,
      failed: 0
    })
    expect(summarizeTodoFold(items, { start: 3, end: 7 }).noneCompleted).toBe(false)
  })
})
