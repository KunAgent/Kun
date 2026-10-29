// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import type { NormalizedThread } from '../../agent/types'
import { useActivityStore } from '../../store/activity-store'
import { SidebarTaskThreadsProvider, TaskGroupChevron, TaskGroupChip, TaskThreadChildren, useSidebarTaskGroup } from './SidebarTaskThreads'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../store/activity-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/activity-store')>()
  const { useSyncExternalStore } = await import('react')
  // Use the live snapshot for SSR, and keep real subscriptions in interaction tests.
  return { ...actual, useActivityStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useActivityStore.getState>) => unknown) => selector(useSyncExternalStore(
      actual.useActivityStore.subscribe, actual.useActivityStore.getState, actual.useActivityStore.getState
    )),
    actual.useActivityStore
  ) }
})
vi.mock('../../agent/registry', () => ({ getProvider: vi.fn() }))

function Children() {
  const group = useSidebarTaskGroup('parent')
  return group ? createElement(TaskThreadChildren, { parentId: 'parent', group }) : null
}

function setWorker(harnessId: string, state: ActivityRow['state'] = 'working', overrides: Partial<ActivityRow> = {}) {
  const row = {
    unitId: 'worker', kind: 'worker', threadId: 'child', parentThreadId: 'parent', harnessId,
    title: 'MiniMax official verification with a long task title',
    workspace: { path: '/w', kind: 'worktree' }, state, mainState: state,
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: new Date().toISOString(), updatedAt: new Date().toISOString(),
    provenance: 'runtime', restoredUnconfirmed: false, stalled: false,
    visibility: 'active', residency: 'live', pinned: false, reviewRequired: false,
    ...(state === 'done' ? { lastOutcome: 'completed' } : {}),
    ...overrides
  } as ActivityRow
  useActivityStore.setState({ rows: { worker: row } })
}

function renderWorker(harnessId: string) {
  setWorker(harnessId)
  return renderToStaticMarkup(createElement(SidebarTaskThreadsProvider, {
    value: {
      childrenByParent: new Map(), activityOf: () => 'read' as const, activeThreadId: null,
      onSelect: vi.fn(), onContextMenu: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn()
    },
    children: createElement(Children)
  }))
}

const mounted = new Map<Root, HTMLDivElement>()
const collapseKey = 'kun.sidebar.taskGroupsCollapsed.v1'
type GroupValue = ComponentProps<typeof SidebarTaskThreadsProvider>['value']

function GroupView() {
  const group = useSidebarTaskGroup('parent')
  return group ? createElement('div', null,
    createElement(TaskGroupChevron, { group }),
    createElement(TaskGroupChip, { group }),
    createElement(TaskThreadChildren, { parentId: 'parent', group })) : null
}

async function mountGroup(initial: Partial<GroupValue> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.set(root, container)
  let value = initial
  const update = async (next = value) => {
    value = next
    await act(async () => root.render(createElement(SidebarTaskThreadsProvider, {
      value: {
        childrenByParent: new Map(), activityOf: () => 'read' as const, activeThreadId: null,
        onSelect: vi.fn(), onContextMenu: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), ...value
      }, children: createElement(GroupView)
    })))
  }
  await update()
  const toggle = async (key?: string) => {
    const event = key ? new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      : new MouseEvent('click', { bubbles: true })
    await act(async () => { container.querySelector('[data-task-group-toggle]')!.dispatchEvent(event) })
  }
  return { container, update, toggle }
}

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) }
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => { for (const root of mounted.keys()) root.unmount() })
  for (const container of mounted.values()) container.remove()
  mounted.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useActivityStore.setState({ rows: {} })
})

describe('sidebar worker agent logos', () => {
  it.each(['kun', 'codex', 'cursor'])('renders the %s logo from activity identity, not the task title', (harnessId) => {
    const html = renderWorker(harnessId)
    expect(html).toContain('data-worker-row="worker"')
    expect(html).toContain(`data-agent-icon="${harnessId}"`)
    expect(html).toContain('mask-image:')
    expect(html).toContain('width:16px;height:16px')
    expect(html).toContain('h-[18px] w-[18px] shrink-0')
    expect(html).not.toMatch(/>[KC]<\/span>/)
    expect(html).not.toContain('data-agent-icon="minimax-code"')
    expect(html).not.toContain('bg-ds-ink')
  })

  it.each(['', 'custom-agent'])('keeps unknown identity %j neutral', (harnessId) => {
    const html = renderWorker(harnessId)
    expect(html).toContain('data-agent-icon="unknown"')
    expect(html).not.toContain('data-agent-icon="kun"')
  })

  it.each([
    ['working', 'sidebarThreadRunning'],
    ['done', 'taskSuggestion.sidebar.workerDone'],
    ['failed', 'sidebarThreadFailed']
  ] as const)('preserves %s status and the selected row when expanded', async (state, label) => {
    setWorker('codex', state)
    const { container, toggle } = await mountGroup({ activeThreadId: 'child' })
    if (state !== 'working') await toggle()
    expect(container.querySelector('[data-agent-icon="codex"]')).not.toBeNull()
    const row = container.querySelector('[data-worker-row="worker"]')!
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(row.innerHTML).toContain(label)
    expect(row.innerHTML).toContain('min-w-0 flex-1 truncate')
  })
})

describe('sidebar task group counts', () => {
  function renderWorkers(rows: Array<{ unitId: string; childLauncher?: ActivityRow['childLauncher'] }>) {
    const now = new Date().toISOString()
    const record: Record<string, ActivityRow> = {}
    for (const entry of rows) {
      record[entry.unitId] = {
        unitId: entry.unitId, kind: 'worker', threadId: `thr_${entry.unitId}`, parentThreadId: 'parent',
        harnessId: 'kun', title: entry.unitId, workspace: { path: '/w', kind: 'worktree' },
        state: 'working', mainState: 'working', children: { working: 0, waiting: 0, done: 0, failed: 0 },
        stateSince: now, updatedAt: now, provenance: 'runtime', restoredUnconfirmed: false, stalled: false,
        visibility: 'active', residency: 'live', pinned: false, reviewRequired: false,
        ...(entry.childLauncher ? { childLauncher: entry.childLauncher } : {})
      } as ActivityRow
    }
    useActivityStore.setState({ rows: record })
    return renderToStaticMarkup(createElement(SidebarTaskThreadsProvider, {
      value: {
        childrenByParent: new Map(), activityOf: () => 'read' as const, activeThreadId: null,
        onSelect: vi.fn(), onContextMenu: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn()
      },
      children: createElement(GroupView)
    }))
  }

  it('counts only ordinary tasks when Fast Context rows share the parent', () => {
    const html = renderWorkers([{ unitId: 'worker' }, { unitId: 'search', childLauncher: 'fast_context' }])
    expect(html.match(/data-worker-row=/g)).toHaveLength(1)
    expect(html).toContain('data-worker-row="worker"')
    expect(html).not.toContain('data-worker-row="search"')
    const chip = /data-task-group-chip[^>]*>([\s\S]*?)<\/span>/.exec(html)
    expect(chip?.[1].replace(/<[^>]+>/g, '').trim()).toBe('1')
  })

  it('renders no task group when only Fast Context ran', () => {
    expect(renderWorkers([{ unitId: 'search', childLauncher: 'fast_context' }])).toBe('')
  })
})

describe('sidebar task group disclosure', () => {
  it.each([
    ['done', 'completed'], ['failed', 'failed'], ['done', 'cancelled']
  ] as const)('defaults %s/%s workers closed while retaining the count and status', async (state, lastOutcome) => {
    setWorker('kun', state, { lastOutcome })
    const { container } = await mountGroup()
    expect(container.querySelector('[data-task-group-toggle]')?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-task-thread-children]')).toBeNull()
    const chip = container.querySelector('[data-task-group-chip]')!
    expect(chip.textContent).toBe('1')
    expect(chip.classList.contains('text-ds-status-danger')).toBe(state === 'failed')
  })

  it.each(['read', 'unread', 'failed'] as const)('also defaults selected %s task sessions closed', async (activity) => {
    const child = { id: 'task-child', title: 'Task session' } as NormalizedThread
    const { container, toggle } = await mountGroup({
      childrenByParent: new Map([['parent', [child]]]), activityOf: () => activity, activeThreadId: child.id
    })
    expect(container.querySelector('[data-task-thread-row]')).toBeNull()
    expect(container.querySelector('[data-task-group-toggle]')?.getAttribute('aria-expanded')).toBe('false')
    await toggle()
    expect(container.querySelector('[data-task-thread-row]')?.getAttribute('aria-selected')).toBe('true')
  })

  it('lets a selected finished worker expand and collapse by click, Enter and Space', async () => {
    setWorker('kun', 'failed')
    const { container, toggle } = await mountGroup({ activeThreadId: 'child' })
    const isExpanded = () => container.querySelector('[data-task-group-toggle]')?.getAttribute('aria-expanded')
    expect(isExpanded()).toBe('false')
    await toggle()
    expect(isExpanded()).toBe('true')
    expect(container.querySelector('[data-worker-row]')).not.toBeNull()
    expect(JSON.parse(window.localStorage.getItem(collapseKey)!)).toEqual([])
    await toggle()
    expect(isExpanded()).toBe('false')
    expect(JSON.parse(window.localStorage.getItem(collapseKey)!)).toEqual(['parent'])
    await toggle('Enter')
    expect(isExpanded()).toBe('true')
    await toggle(' ')
    expect(isExpanded()).toBe('false')
  })

  it('collapses on completion, preserves manual expansion across refreshes, and resets for the next run', async () => {
    setWorker('kun')
    const onSelect = vi.fn()
    const { container, update, toggle } = await mountGroup({ activeThreadId: 'child', onSelect })
    const rows = () => container.querySelectorAll('[data-worker-row]').length
    expect(rows()).toBe(1)
    await act(async () => { setWorker('kun', 'done') })
    expect(rows()).toBe(0)
    await toggle()
    expect(rows()).toBe(1)
    await update()
    await act(async () => { setWorker('kun', 'done', { progressNote: 'refreshed snapshot' }) })
    expect(rows()).toBe(1)
    await act(async () => { setWorker('kun') })
    expect(rows()).toBe(1)
    await act(async () => { setWorker('kun', 'failed') })
    expect(rows()).toBe(0)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not let a failed task hide an active worker sibling', async () => {
    const child = { id: 'task-child', title: 'Failed task session' } as NormalizedThread
    setWorker('kun')
    const { container } = await mountGroup({
      childrenByParent: new Map([['parent', [child]]]), activityOf: () => 'failed'
    })
    expect(container.querySelectorAll('[data-worker-row], [data-task-thread-row]')).toHaveLength(2)
    await act(async () => { setWorker('kun', 'waiting') })
    expect(container.querySelector('[data-task-group-toggle]')?.getAttribute('aria-expanded')).toBe('true')
    await act(async () => { setWorker('kun', 'done') })
    expect(container.querySelector('[data-task-thread-children]')).toBeNull()
    expect(container.querySelector('[data-task-group-chip]')?.textContent).toBe('2')
    expect(container.querySelector('[data-task-group-chip]')?.classList.contains('text-ds-status-danger')).toBe(true)
  })

  it('defaults finished groups closed again after remounting', async () => {
    setWorker('kun', 'done')
    const first = await mountGroup()
    await first.toggle()
    expect(first.container.querySelector('[data-worker-row]')).not.toBeNull()
    const second = await mountGroup()
    expect(second.container.querySelector('[data-task-thread-children]')).toBeNull()
  })

  it('preserves stored manual collapse and the working selected-child exception', async () => {
    window.localStorage.setItem(collapseKey, JSON.stringify(['parent']))
    setWorker('kun')
    const { container, update } = await mountGroup()
    expect(container.querySelector('[data-task-thread-children]')).toBeNull()
    await update({ activeThreadId: 'child' })
    expect(container.querySelector('[data-worker-row]')).not.toBeNull()
    await act(async () => { setWorker('kun', 'done') })
    expect(container.querySelector('[data-task-thread-children]')).toBeNull()
  })

  it('still toggles when browser storage is unavailable', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('storage unavailable') })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
    setWorker('kun', 'failed')
    const { container, toggle } = await mountGroup()
    await toggle()
    expect(container.querySelector('[data-worker-row]')).not.toBeNull()
    await toggle()
    expect(container.querySelector('[data-task-thread-children]')).toBeNull()
  })

  it('renders no disclosure for an empty group', async () => {
    const { container } = await mountGroup()
    expect(container.innerHTML).toBe('')
  })
})
