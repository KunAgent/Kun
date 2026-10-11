import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ThreadTodoItem, ThreadTodoList } from '../../agent/types'
import { useGraphStore } from '../../graph/graph-store'
import type { GraphRun, GraphRunStatus } from '../../graph/graph-types'
import {
  FloatingComposerTodoProgress,
  calculateTodoProgressPopoverPlacement,
  getTodoProgress
} from './FloatingComposerTodoProgress'
import i18n from '../../i18n'

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

/** Only the fields `graphRunOwnsThreadProgress` reads. */
function graphRunFor(threadId: string, status: GraphRunStatus): GraphRun {
  return { id: 'run_1', threadId, status } as unknown as GraphRun
}

function planChecklist(threadId: string, total: number): ThreadTodoList {
  return {
    threadId,
    items: Array.from({ length: total }, (_unused, index) => item(`plan-${index}`, 'pending')),
    updatedAt: '2026-08-16T13:49:46.127Z'
  }
}

describe('FloatingComposerTodoProgress', () => {
  it('never presents failed or cancelled canonical tasks as successful legacy checkboxes', () => {
    const items = [
      { ...item('failed', 'completed'), taskStatus: 'failed' as const },
      { ...item('cancelled', 'completed'), taskStatus: 'cancelled' as const },
      { ...item('running', 'pending'), taskStatus: 'running' as const }
    ]
    expect(getTodoProgress(items)).toMatchObject({ completed: 0, current: 3, allComplete: false })
  })
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

describe('plan checklist against live Graph execution (#1202)', () => {
  beforeAll(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    act(() => {
      useGraphStore.setState({ runs: [], selectedRunId: null })
    })
  })

  async function renderChecklist(enabled?: boolean): Promise<ReactTestRenderer> {
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(FloatingComposerTodoProgress, {
        todos: planChecklist('thread-1', 19),
        ...(enabled === undefined ? {} : { enabled })
      }))
    })
    return renderer!
  }

  it('stops reporting the untouched checklist count as execution progress', async () => {
    act(() => {
      useGraphStore.setState({
        runs: [graphRunFor('thread-1', 'running')],
        selectedRunId: 'run_1'
      })
    })
    const renderer = await renderChecklist()
    const trigger = renderer.root.findByType('button')

    const tree = JSON.stringify(renderer.toJSON())
    expect(trigger.props['data-todo-plan-outline']).toBe('true')
    expect(tree).toContain('Plan outline · 19 steps')
    expect(tree).not.toContain('Step 1 / 19')
    expect(trigger.props['aria-label']).toContain('Original plan outline')
    renderer.unmount()
  })

  it('keeps step progress when no Graph run owns the thread', async () => {
    act(() => {
      useGraphStore.setState({
        runs: [
          graphRunFor('thread-1', 'completed'),
          graphRunFor('other-thread', 'running')
        ],
        selectedRunId: 'run_1'
      })
    })
    const renderer = await renderChecklist()
    const trigger = renderer.root.findByType('button')

    expect(trigger.props['data-todo-plan-outline']).toBeUndefined()
    expect(JSON.stringify(renderer.toJSON())).toContain('Step 1 / 19')
    expect(trigger.props['aria-label']).toContain('step 1 of 19')
    renderer.unmount()
  })

  it('keeps step progress while the Graph progress surface is disabled', async () => {
    act(() => {
      useGraphStore.setState({
        runs: [graphRunFor('thread-1', 'running')],
        selectedRunId: 'run_1'
      })
    })
    const renderer = await renderChecklist(false)
    const trigger = renderer.root.findByType('button')

    expect(trigger.props['data-todo-plan-outline']).toBeUndefined()
    expect(JSON.stringify(renderer.toJSON())).toContain('Step 1 / 19')
    expect(trigger.props['aria-label']).toContain('step 1 of 19')
    renderer.unmount()
  })
})
