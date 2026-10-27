import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import { useActivityStore } from '../../store/activity-store'
import { SidebarTaskThreadsProvider, TaskGroupChip, TaskThreadChildren, useSidebarTaskGroup } from './SidebarTaskThreads'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../store/activity-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/activity-store')>()
  // Feed the real store's current snapshot into server rendering.
  return { ...actual, useActivityStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useActivityStore.getState>) => unknown) => selector(actual.useActivityStore.getState()),
    actual.useActivityStore
  ) }
})
vi.mock('../../agent/registry', () => ({ getProvider: vi.fn() }))

function Children() {
  const group = useSidebarTaskGroup('parent')
  return group ? createElement(TaskThreadChildren, { parentId: 'parent', group }) : null
}

function renderWorker(harnessId: string, state: ActivityRow['state'] = 'working', active = false) {
  const row = {
    unitId: 'worker', kind: 'worker', threadId: 'child', parentThreadId: 'parent', harnessId,
    title: 'MiniMax official verification with a long task title',
    workspace: { path: '/w', kind: 'worktree' }, state, mainState: state,
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: new Date().toISOString(), updatedAt: new Date().toISOString(),
    provenance: 'runtime', restoredUnconfirmed: false, stalled: false,
    visibility: 'active', residency: 'live', pinned: false, reviewRequired: false,
    ...(state === 'done' ? { lastOutcome: 'completed' } : {})
  } as ActivityRow
  useActivityStore.setState({ rows: { worker: row } })
  return renderToStaticMarkup(createElement(SidebarTaskThreadsProvider, {
    value: {
      childrenByParent: new Map(), activityOf: () => 'read' as const, activeThreadId: active ? 'child' : null,
      onSelect: vi.fn(), onContextMenu: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn()
    },
    children: createElement(Children)
  }))
}

afterEach(() => {
  vi.restoreAllMocks()
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
  ] as const)('preserves %s status and the selected row', (state, label) => {
    const html = renderWorker('codex', state, true)
    expect(html).toContain('data-agent-icon="codex"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain(label)
    expect(html).toContain('min-w-0 flex-1 truncate')
  })
})

describe('sidebar task group counts', () => {
  function GroupView() {
    const group = useSidebarTaskGroup('parent')
    return group
      ? createElement('div', null,
        createElement(TaskGroupChip, { group }),
        createElement(TaskThreadChildren, { parentId: 'parent', group }))
      : null
  }

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
