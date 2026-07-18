import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { ThreadTodoItem, ThreadTodoList } from '../../agent/types'
import {
  FloatingComposerTodoProgress,
  calculateTodoProgressPopoverPlacement,
  getTodoProgress
} from './FloatingComposerTodoProgress'
import '../../i18n'

function item(id: string, status: ThreadTodoItem['status']): ThreadTodoItem {
  return {
    id,
    content: `Todo ${id}`,
    status,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  }
}

const todos: ThreadTodoList = {
  threadId: 'thread-1',
  items: [item('one', 'completed'), item('two', 'in_progress'), item('three', 'pending')],
  updatedAt: '2026-07-16T00:00:00.000Z'
}

describe('FloatingComposerTodoProgress', () => {
  it('reports the active ordered step and completed state', () => {
    expect(getTodoProgress(todos.items)).toEqual({
      completed: 1,
      current: 2,
      total: 3,
      allComplete: false
    })
    expect(getTodoProgress(todos.items.map((todo) => ({ ...todo, status: 'completed' })))).toEqual({
      completed: 3,
      current: 3,
      total: 3,
      allComplete: true
    })
  })

  it('centers the detail popover above the progress pill', () => {
    expect(calculateTodoProgressPopoverPlacement({
      anchorRect: { left: 440, right: 560, top: 700, bottom: 744 },
      popoverHeight: 300,
      viewportHeight: 900,
      viewportWidth: 1000
    })).toEqual({ left: 180, top: 392, width: 640, maxHeight: 360 })
  })

  it('opens the detail view on hover', async () => {
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(FloatingComposerTodoProgress, { todos }))
    })

    const trigger = renderer!.root.findByType('button')
    expect(trigger.props['aria-expanded']).toBe(false)

    await act(async () => {
      trigger.props.onMouseEnter()
    })

    expect(renderer!.root.findByType('button').props['aria-expanded']).toBe(true)
    renderer!.unmount()
  })
})
