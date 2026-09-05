import { describe, expect, it } from 'vitest'
import type { ThreadTodoItem, ThreadTodoList } from '../src/contracts/threads.js'
import { extractPlanTodos, mergePlanTodos } from '../src/shared/todos.js'

const now = '2026-08-31T00:00:00.000Z'
const planId = 'plan_1'
const relativePath = '.kunsdd/plan/demo.md'

function extract(markdown: string) {
  return extractPlanTodos({ markdown, planId, relativePath, threadId: 'thr_1', now })
}

function list(items: ThreadTodoItem[]): ThreadTodoList {
  return { threadId: 'thr_1', items, updatedAt: now }
}

describe('plan todo synchronization', () => {
  it('ignores task syntax inside fenced code blocks', () => {
    const items = extract([
      '- [ ] visible',
      '```md',
      '- [x] example only',
      '```',
      '~~~',
      '- [ ] another example',
      '~~~',
      '- [x] done'
    ].join('\n'))

    expect(items.map(({ content, status }) => [content, status])).toEqual([
      ['visible', 'pending'],
      ['done', 'completed']
    ])
  })

  it('requires a matching fence marker, length, and whitespace-only close', () => {
    const items = extract([
      '````md', '- [ ] hidden one', '```', '- [ ] hidden two',
      '```` not-a-close', '- [ ] hidden three', '````',
      '~~~', '- [ ] hidden tilde', '~~~', '- [ ] visible'
    ].join('\r\n'))
    expect(items.map((item) => item.content)).toEqual(['visible'])
  })

  it.each([
    ['completed markdown wins', 'completed', 'in_progress', 'document_edit', 'completed'],
    ['in-progress state survives an unchecked document edit', 'pending', 'in_progress', 'document_edit', 'in_progress'],
    ['plan writes preserve completed state', 'pending', 'completed', 'plan_write', 'completed'],
    ['document edits reset unchecked completed state', 'pending', 'completed', 'document_edit', 'pending']
  ] as const)('%s', (_name, markdownStatus, existingStatus, mode, expected) => {
    const [planItem] = extract(`- [${markdownStatus === 'completed' ? 'x' : ' '}] task`)
    const existing = { ...planItem!, status: existingStatus, updatedAt: 'earlier' }
    const merged = mergePlanTodos({
      threadId: 'thr_1',
      existing: list([existing]),
      planItems: [planItem!],
      planId,
      relativePath,
      now,
      mode
    })

    expect(merged.items[0]?.status).toBe(expected)
  })

  it('deletes removed todos only for the synchronized plan source', () => {
    const [removed] = extract('- [ ] removed')
    const ordinary: ThreadTodoItem = {
      id: 'todo_plain', content: 'plain', status: 'pending', createdAt: now, updatedAt: now
    }
    const otherPlan: ThreadTodoItem = {
      ...removed!,
      id: 'todo_other',
      content: 'other plan',
      source: { ...removed!.source, planId: 'plan_2' }
    }

    const merged = mergePlanTodos({
      threadId: 'thr_1',
      existing: list([removed!, ordinary, otherPlan]),
      planItems: [],
      planId,
      relativePath,
      now,
      mode: 'document_edit'
    })

    expect(merged.items.map((item) => item.id)).toEqual(['todo_plain', 'todo_other'])
  })
})
