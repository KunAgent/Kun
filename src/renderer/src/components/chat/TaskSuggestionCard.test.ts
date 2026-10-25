import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskSuggestionTaskView, TaskSuggestionView } from '@shared/task-suggestions'
import type { ChatBlock } from '../../agent/types'
import { AgentDispatchGroup } from './AgentDispatchCard'

const state = vi.hoisted(() => ({ card: undefined as TaskSuggestionView | undefined, act: vi.fn(), busy: false, error: '',
  activeThreadId: 'parent', awaiting: {} as Record<string, true>, selectThread: vi.fn() }))
vi.mock('./use-task-suggestion', () => ({ useTaskSuggestion: () => state, useThreadTaskSuggestions: () => [] }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key
}) }))
vi.mock('../../store/chat-store', () => {
  const store = (select: (value: unknown) => unknown) =>
    select({ activeThreadId: state.activeThreadId, awaitingUserInputThreadIds: state.awaiting })
  store.getState = () => ({ selectThread: state.selectThread })
  return { useChatStore: store }
})
vi.mock('./use-agent-dispatch-intent', () => ({ useAgentDispatchIntent: () => ({ intent: undefined }) }))
vi.mock('../../store/activity-store', () => ({ useActivityStore: (select: (value: unknown) => unknown) => select({ rows: {} }) }))
vi.mock('../workers/worker-view-store', () => ({ openWorkerSession: vi.fn() }))
vi.mock('./FloatingComposerWorkersPill', () => ({ OPEN_WORKERS_PANEL_EVENT: 'open-workers-panel' }))
vi.mock('./AgentDispatchIntentControls', () => ({ AgentDispatchIntentControls: () => null }))
vi.mock('./AgentDispatchRoutePicker', () => ({
  AgentDispatchRoutePicker: (props: { route: { agentId: string }; onChange: (route: unknown) => void }) =>
    createElement('button', { 'data-route-picker': props.route.agentId, onClick: () => props.onChange({ agentId: 'codex', model: 'gpt-5' }) }),
  AgentDispatchRouteLabel: (props: { route: { agentId: string } }) => createElement('span', { 'data-route-label': props.route.agentId })
}))

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-10-22T02:00:18.000Z')
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  state.act.mockReset().mockResolvedValue(undefined)
  state.selectThread.mockReset()
  state.activeThreadId = 'parent'
  state.awaiting = {}
})
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount())
  renderer = undefined
  vi.useRealTimers()
})

const row = (id: string, rowState: TaskSuggestionTaskView['state'], extra: Partial<TaskSuggestionTaskView> = {}): TaskSuggestionTaskView => ({
  id, title: `Task ${id}`, area: 'backend', brief: { goal: 'Goal', scope: [], done: [] }, route: { agentId: 'kun', model: 'm' },
  worktree: true, inheritContext: false, state: rowState, attempt: 0, ...extra })
const block = { id: 'tool-1', kind: 'tool', meta: { taskSuggestionId: 'tsg' } } as unknown as ChatBlock

async function renderCard(card: TaskSuggestionView, readOnly = false) {
  state.card = card
  await act(async () => { renderer = create(createElement(AgentDispatchGroup, { blocks: [block], readOnly })) })
  return renderer!.root
}
const card = (tasks: TaskSuggestionTaskView[], extra: Partial<TaskSuggestionView> = {}): TaskSuggestionView => ({
  intentId: 'tsg', revision: 4, source: { threadId: 'parent', turnId: 't', toolCallId: 'c' }, state: 'suggested',
  workspace: '/code/DeepSeek-GUI', tasks, createdAt: '2026-10-22T02:00:00.000Z', updatedAt: '2026-10-22T02:00:00.000Z', ...extra })
const text = (root: ReactTestInstance) => JSON.stringify(root.findAll((node) => typeof node.type === 'string').map((node) => node.children.filter((child) => typeof child === 'string')))
const textOf = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('')
const buttonWith = (root: ReactTestInstance, label: string) => root.findAll((node) => node.type === 'button' && textOf(node).includes(label))
const byData = (root: ReactTestInstance, attribute: string) => root.findAll((node) => typeof node.type === 'string' && node.props[attribute] !== undefined)

describe('TaskSuggestionCard', () => {
  it('starts one task, all tasks, or changes a route while the card waits', async () => {
    const root = await renderCard(card([row('t1', 'suggested'), row('t2', 'suggested')]))
    expect(text(root)).toContain('taskSuggestion.status.pending:{\\"count\\":2}')
    await act(async () => { byData(root, 'data-task-start')[0]!.props.onClick() })
    expect(state.act).toHaveBeenLastCalledWith('start', { taskIds: ['t1'] })
    await act(async () => { byData(root, 'data-task-start-all')[0]!.props.onClick() })
    expect(state.act).toHaveBeenLastCalledWith('start')
    await act(async () => { byData(root, 'data-route-picker')[1]!.props.onClick() })
    expect(state.act).toHaveBeenLastCalledWith('update', { taskId: 't2', changes: { route: { agentId: 'codex', model: 'gpt-5' } } })
  })

  it('shows a draining countdown and pause instead of per-row start buttons', async () => {
    const root = await renderCard(card([row('t1', 'suggested')], { state: 'countdown', deadline: '2026-10-22T02:01:00.000Z' }))
    expect(byData(root, 'data-task-countdown')).toHaveLength(1)
    expect(text(root)).toContain('taskSuggestion.status.countdown:{\\"time\\":\\"0:42\\"}')
    expect(byData(root, 'data-task-start')).toHaveLength(0)
  })

  it('offers retry and no-worktree on a start failure, opens running sessions, and flags waiting ones', async () => {
    state.awaiting = { thr_t2: true }
    const root = await renderCard(card([
      row('t1', 'start_failed', { failure: { code: 'disk_space', message: 'No space left on device' } }),
      row('t2', 'running', { threadId: 'thr_t2', startedAt: '2026-10-22T01:56:00.000Z' }),
      row('t3', 'done', { threadId: 'thr_t3', result: { turnStatus: 'completed' } })
    ], { state: 'active' }))
    expect(text(root)).toContain('taskSuggestion.failure.disk_space · No space left on device')
    expect(text(root)).toContain('taskSuggestion.row.waiting')
    const retry = buttonWith(root, 'taskSuggestion.actions.retry')
    await act(async () => { retry[0]!.props.onClick() })
    expect(state.act).toHaveBeenLastCalledWith('retry', { taskId: 't1' })
    const noWorktree = buttonWith(root, 'taskSuggestion.actions.noWorktree')
    await act(async () => { noWorktree[0]!.props.onClick() })
    expect(state.act).toHaveBeenLastCalledWith('retry', { taskId: 't1', changes: { worktree: false } })
    const opens = byData(root, 'data-task-open')
    expect(opens.map((node) => node.props['data-task-open'])).toEqual(['t2', 't3'])
    await act(async () => { opens[1]!.props.onClick() })
    expect(state.selectThread).toHaveBeenCalledWith('thr_t3')
  })

  it('collapses a settled card to one line and keeps other conversations read-only', async () => {
    let root = await renderCard(card([row('t1', 'done', { result: { turnStatus: 'completed' } }), row('t2', 'ignored')], { state: 'settled' }))
    expect(byData(root, 'data-task-suggestion-rows')).toHaveLength(0)
    expect(text(root)).toContain('taskSuggestion.status.settled:{\\"count\\":2}')
    await act(async () => renderer?.unmount())
    state.activeThreadId = 'elsewhere'
    root = await renderCard(card([row('t1', 'suggested'), row('t2', 'suggested')]))
    expect(byData(root, 'data-task-start')).toHaveLength(0)
    expect(byData(root, 'data-route-label')).toHaveLength(2)
  })
})
