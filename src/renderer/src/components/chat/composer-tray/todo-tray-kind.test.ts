// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import type { ThreadTodoItem, ThreadTodoList } from '../../../agent/types'
import { useGraphStore } from '../../../graph/graph-store'
import type { GraphRun, GraphRunStatus } from '../../../graph/graph-types'
import i18n from '../../../i18n'
import { useActivityStore } from '../../../store/activity-store'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import { ComposerActivityTray } from './ComposerActivityTray'
import { useTodoTrayKind } from './todo-tray-kind'
import { buildWorkersTrayRows } from './workers-tray-model'

function item(id: string, status: ThreadTodoItem['status'], overrides: Partial<ThreadTodoItem> = {}): ThreadTodoItem {
  return {
    id,
    content: `Todo ${id}`,
    status,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides
  }
}

function list(items: ThreadTodoItem[], overrides: Partial<ThreadTodoList> = {}): ThreadTodoList {
  return { threadId: 'thread-1', items, updatedAt: '2026-07-16T00:00:00.000Z', ...overrides }
}

/** Only the fields `graphRunOwnsThreadProgress` reads. */
function graphRunFor(threadId: string, status: GraphRunStatus): GraphRun {
  return { id: 'run_1', threadId, status } as unknown as GraphRun
}

function planChecklist(total: number): ThreadTodoList {
  return list(Array.from({ length: total }, (_unused, index) => item(`plan-${index}`, 'pending')))
}

function Harness({ context }: { context: FloatingComposerRenderContext }): ReactElement {
  const kind = useTodoTrayKind(context)
  return createElement(ComposerActivityTray, { kinds: [kind], compact: context.compact === true })
}

describe('todo tray kind', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ''
    act(() => {
      useGraphStore.setState({ runs: [], selectedRunId: null })
      useActivityStore.setState({ rows: {} })
    })
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  async function render(todos: ThreadTodoList | null, context: FloatingComposerRenderContext = {}): Promise<void> {
    await act(async () => root.render(createElement(Harness, {
      context: { activeThreadTodos: todos, showTodoProgress: true, showGraphProgress: true, ...context }
    })))
  }
  const segment = (): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>('[data-composer-stack-item="todo"] button')
  const sheet = (): HTMLElement | null => host.querySelector<HTMLElement>('[data-tray-sheet="todo"]')
  const open = async (): Promise<void> => {
    await act(async () => segment()!.click())
  }

  it('follows the composer visibility gate', async () => {
    await render(list([item('a', 'pending')]), { showTodoProgress: false })
    expect(host.innerHTML).toBe('')
    await render(list([]))
    expect(host.innerHTML).toBe('')
    await render(null)
    expect(host.innerHTML).toBe('')
  })

  it('shows the current step, its ring and current/total, and opens the sheet on click', async () => {
    await render(list([item('one', 'completed'), item('two', 'in_progress'), item('three', 'pending')]))
    const button = segment()!
    expect(button.querySelector('[data-todo-step]')?.textContent).toBe('Todo two')
    expect(button.textContent).toContain('2/3')
    expect(button.querySelector('svg.ds-composer-tray-ring')).not.toBeNull()
    expect(button.getAttribute('aria-label')).toBe('Tasks: Todo two · step 2 of 3')
    expect(button.getAttribute('aria-expanded')).toBe('false')

    await open()
    expect(segment()!.getAttribute('aria-expanded')).toBe('true')
    const body = sheet()!
    expect(body.textContent).toContain('Tasks')
    expect(body.querySelector('[data-todo-sheet-count]')?.textContent).toBe('2 / 3')
    const states = Array.from(body.querySelectorAll('[data-todo-item]')).map((row) => row.getAttribute('data-todo-state'))
    expect(states).toEqual(['done', 'current', 'pending'])
    expect(body.querySelector('[data-todo-current="true"]')?.getAttribute('data-highlighted')).toBe('true')
    expect(body.querySelector('[data-todo-fold]')).toBeNull()

    await act(async () => body.querySelector<HTMLButtonElement>('button[aria-label="Collapse"]')!.click())
    expect(sheet()).toBeNull()
  })

  it('keeps only the ring and the count in a compact tray', async () => {
    await render(list([item('one', 'completed'), item('two', 'pending')]), { compact: true })
    const button = segment()!
    expect(button.querySelector('[data-todo-step]')).toBeNull()
    expect(button.textContent).toBe('2/2')
    expect(button.getAttribute('title')).toBe('Tasks: Todo two · step 2 of 2')
  })

  it('folds a long list around the current step and expands folds in place', async () => {
    const items = [
      ...Array.from({ length: 3 }, (_unused, index) => item(`done-${index}`, 'completed')),
      item('current', 'in_progress', { reason: 'Waiting on the schema review' }),
      item('next', 'pending', { ownerThreadId: 'worker-1' }),
      ...Array.from({ length: 6 }, (_unused, index) => item(`later-${index}`, 'pending')),
      item('stuck', 'pending', { taskStatus: 'blocked' })
    ]
    act(() => {
      useActivityStore.setState({ rows: { u1: { threadId: 'worker-1', title: 'Test writer' } as ActivityRow } })
    })
    await render(list(items))
    await open()
    const body = sheet()!
    const visibleIds = (): string[] => Array.from(body.querySelectorAll('[data-todo-item]'))
      .filter((row) => !row.closest('[hidden]'))
      .map((row) => row.getAttribute('data-todo-item') ?? '')
    expect(visibleIds()).toEqual(['done-2', 'current', 'next'])

    const before = body.querySelector('[data-todo-fold="before"] button')!
    const after = body.querySelector('[data-todo-fold="after"] button')!
    expect(before.textContent).toBe('2 done')
    expect(after.textContent).toContain('7 remaining')
    expect(after.textContent).toContain('1 blocked')
    expect(after.getAttribute('aria-expanded')).toBe('false')

    expect(body.querySelector('[data-todo-reason]')?.textContent).toBe('Waiting on the schema review')
    const owner = body.querySelector('[data-todo-owner="worker-1"]')!
    expect(owner.textContent).toContain('Test writer')
    expect(owner.getAttribute('title')).toBe('Owner: Test writer')

    await act(async () => (after as HTMLButtonElement).click())
    expect(after.getAttribute('aria-expanded')).toBe('true')
    expect(visibleIds()).toEqual(['done-2', 'current', 'next', ...items.slice(5).map((todo) => todo.id)])
    const stuck = body.querySelector('[data-todo-item="stuck"]')!
    expect(stuck.querySelector('.ds-composer-tray-pill')?.textContent).toBe('Blocked')

    await act(async () => (before as HTMLButtonElement).click())
    expect(visibleIds()).toEqual(items.map((todo) => todo.id))
    await act(async () => (before as HTMLButtonElement).click())
    expect(visibleIds()[0]).toBe('done-2')
  })

  it('names the source plan in the header and the elapsed time of a running step', async () => {
    const source = (ordinal: number): ThreadTodoItem['source'] => ({
      kind: 'plan', planId: 'plan-1', relativePath: 'plans/auth-refactor.md', ordinal, contentHash: `h${ordinal}`
    })
    const startedAt = new Date(Date.now() - 4 * 60_000 - 5_000).toISOString()
    await render(list([
      item('a', 'completed', { source: source(0) }),
      item('b', 'in_progress', { source: source(1), updatedAt: startedAt })
    ]), { busy: true })
    await open()
    expect(sheet()!.querySelector('[data-todo-plan-path]')?.textContent).toBe('plans/auth-refactor.md')
    expect(sheet()!.querySelector('[data-todo-current-meta]')?.textContent).toBe('In progress · 4 min')

    await render(list([item('a', 'completed'), item('b', 'pending')]), { busy: true })
    expect(sheet()!.querySelector('[data-todo-plan-path]')).toBeNull()
    expect(sheet()!.querySelector('[data-todo-current-meta]')?.textContent).toBe('Up next')
  })

  it('skips a cancelled task when choosing the step shown as current', async () => {
    await render(list([
      item('a', 'completed', { taskStatus: 'succeeded' }),
      item('b', 'pending', { taskStatus: 'cancelled' }),
      item('c', 'pending', { taskStatus: 'pending' })
    ]))
    expect(segment()!.querySelector('[data-todo-step]')?.textContent).toBe('Todo c')
    expect(segment()!.textContent).toContain('3/3')
    await open()
    const states = Array.from(sheet()!.querySelectorAll('[data-todo-item]')).map((row) => row.getAttribute('data-todo-state'))
    expect(states).toEqual(['done', 'cancelled', 'current'])
    expect(sheet()!.querySelector('[data-todo-current="true"]')?.getAttribute('data-todo-item')).toBe('c')
  })

  it('does not mark a failed step current once the list has settled', async () => {
    await render(list([item('a', 'completed', { taskStatus: 'succeeded' }), item('b', 'pending', { taskStatus: 'failed' })]))
    expect(segment()!.textContent).toContain('2/2')
    await open()
    expect(sheet()!.querySelector('[data-todo-current]')).toBeNull()
    expect(sheet()!.querySelector('[data-todo-item="b"]')?.getAttribute('data-todo-state')).toBe('failed')
  })

  it('paints worker owners with the avatar colors the Workers tray gives them', async () => {
    const worker = (unitId: string, title: string): ActivityRow => ({
      unitId,
      threadId: unitId,
      kind: 'worker',
      parentThreadId: 'thread-1',
      title,
      state: 'working',
      stateSince: '2026-07-16T00:00:00.000Z'
    }) as ActivityRow
    const team = [worker('w_tests', 'Unit tests'), worker('w_forms', 'Form copy')]
    act(() => {
      useActivityStore.setState({ rows: Object.fromEntries(team.map((row) => [row.unitId, row])) })
    })
    await render(list([
      item('a', 'in_progress'),
      item('b', 'pending', { ownerThreadId: 'w_tests' }),
      item('c', 'pending', { ownerThreadId: 'w_forms' }),
      item('d', 'pending', { ownerThreadId: 'thr_unknown' })
    ]))
    await open()
    const unknown = sheet()!.querySelector('[data-todo-owner="thr_unknown"]')!
    expect(unknown.textContent).toContain('thr_unknown')
    expect(unknown.querySelector('.ds-composer-tray-avatar svg')).not.toBeNull()
    // The Workers sheet's own row model is the reference, whatever its color rule.
    const workersRows = buildWorkersTrayRows(team, { now: Date.now(), feedError: false })
    expect(workersRows.map((row) => row.id).sort()).toEqual(['w_forms', 'w_tests'])
    const avatar = (owner: string): HTMLElement =>
      sheet()!.querySelector<HTMLElement>(`[data-todo-owner="${owner}"] .ds-composer-tray-avatar`)!
    const normalized = (color: string): string => {
      const probe = document.createElement('span')
      probe.style.background = color
      return probe.style.background
    }
    for (const row of workersRows) {
      expect(avatar(row.id).style.background).toBe(normalized(row.color))
      expect(avatar(row.id).textContent).toBe(row.glyph)
    }
  })
})

describe('plan checklist against live Graph execution (#1202)', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    act(() => {
      useGraphStore.setState({ runs: [], selectedRunId: null })
    })
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  async function renderChecklist(showGraphProgress = true): Promise<HTMLButtonElement> {
    await act(async () => root.render(createElement(Harness, {
      context: { activeThreadTodos: planChecklist(19), showTodoProgress: true, showGraphProgress }
    })))
    return host.querySelector<HTMLButtonElement>('[data-composer-stack-item="todo"] button')!
  }

  it('stops reporting the untouched checklist count as execution progress', async () => {
    act(() => {
      useGraphStore.setState({ runs: [graphRunFor('thread-1', 'running')], selectedRunId: 'run_1' })
    })
    const trigger = await renderChecklist()
    expect(trigger.getAttribute('data-todo-plan-outline')).toBe('true')
    expect(trigger.textContent).toContain('Plan outline')
    expect(trigger.textContent).toContain('19 steps')
    expect(trigger.textContent).not.toContain('1/19')
    expect(trigger.getAttribute('aria-label')).toContain('Original plan outline')

    await act(async () => trigger.click())
    const sheet = host.querySelector('[data-tray-sheet="todo"]')!
    const hint = sheet.querySelector('[data-todo-plan-outline-hint]')!
    expect(hint.textContent).toContain('Graph orchestration is running')
    expect(hint.textContent).toContain('not live execution progress')
    expect(sheet.querySelectorAll('[data-todo-item]')).toHaveLength(19)
    expect(sheet.querySelector('[data-todo-current]')).toBeNull()
    expect(sheet.querySelector('[data-todo-fold]')).toBeNull()
  })

  it('keeps step progress when no Graph run owns the thread', async () => {
    act(() => {
      useGraphStore.setState({
        runs: [graphRunFor('thread-1', 'completed'), graphRunFor('other-thread', 'running')],
        selectedRunId: 'run_1'
      })
    })
    const trigger = await renderChecklist()
    expect(trigger.getAttribute('data-todo-plan-outline')).toBeNull()
    expect(trigger.textContent).toContain('1/19')
    expect(trigger.getAttribute('aria-label')).toContain('step 1 of 19')
  })

  it('keeps step progress while the Graph progress surface is disabled', async () => {
    act(() => {
      useGraphStore.setState({ runs: [graphRunFor('thread-1', 'running')], selectedRunId: 'run_1' })
    })
    const trigger = await renderChecklist(false)
    expect(trigger.getAttribute('data-todo-plan-outline')).toBeNull()
    expect(trigger.textContent).toContain('1/19')
    expect(trigger.getAttribute('aria-label')).toContain('step 1 of 19')
  })
})
