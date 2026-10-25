import type { ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import type { ActivityRow } from '@shared/activity-row'
import type { AdeTeamOverview } from '@shared/ade-teams'

/** Shared fixtures for the Collaboration list and worker tab tests. */
export const MGR = 'thr_mgr'

export function workerRow(overrides: Partial<ActivityRow>): ActivityRow {
  const ts = new Date(Date.now() - 60_000).toISOString()
  return {
    unitId: 'wrk_1',
    kind: 'worker',
    threadId: 'wrk_1',
    parentThreadId: MGR,
    harnessId: 'kun',
    title: 'backend',
    workspace: { path: '/ws', kind: 'worktree' },
    state: 'working',
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: ts,
    updatedAt: ts,
    stalled: false,
    visibility: 'active',
    pinned: false,
    ...overrides
  } as ActivityRow
}

export function teamOverview(): AdeTeamOverview {
  return {
    team: {
      teamId: 'team_1',
      managerThreadId: MGR,
      status: 'active',
      workers: [
        {
          workerId: 'wrk_1',
          label: 'backend',
          route: { harnessId: 'claude-code', model: 'opus', credentialMode: 'subscription' },
          control: 'manager',
          state: 'active'
        },
        { workerId: 'wrk_2', label: 'docs', control: 'manager', state: 'active' }
      ],
      createdAt: 'x',
      updatedAt: 'x'
    },
    dispatches: [
      {
        dispatchId: 'dsp_1',
        teamId: 'team_1',
        workerId: 'wrk_1',
        title: 'api',
        state: 'delivering',
        capture: { changedFiles: 2, insertions: 90, deletions: 12 },
        createdAt: 'x',
        updatedAt: 'x'
      }
    ],
    questions: [
      {
        questionId: 'q_1',
        dispatchId: 'dsp_1',
        workerId: 'wrk_1',
        question: 'ship behind a flag?',
        options: ['Yes', 'No'],
        state: 'open',
        createdAt: 'x',
        updatedAt: 'x'
      }
    ],
    usage: {
      totalTokens: 7_967_830,
      perWorker: [{ workerId: 'wrk_1', label: 'backend', totalTokens: 4_100_000 }],
      softExceeded: false,
      hardExceeded: false
    }
  }
}

export function mountTracker(): {
  render: (el: ReactElement) => Promise<ReactTestRenderer>
  unmountAll: () => Promise<void>
  forget: (renderer: ReactTestRenderer) => void
} {
  const mounted = new Set<ReactTestRenderer>()
  return {
    render: async (el) => {
      let renderer!: ReactTestRenderer
      await act(async () => { renderer = create(el) })
      mounted.add(renderer)
      return renderer
    },
    unmountAll: async () => {
      await act(async () => { for (const renderer of mounted) renderer.unmount() })
      mounted.clear()
    },
    forget: (renderer) => { mounted.delete(renderer) }
  }
}

export function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('')
}

export function buttons(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAllByType('button' as never)
}

export function byData(renderer: ReactTestRenderer, attribute: string, value?: unknown): ReactTestInstance[] {
  return renderer.root.findAll((node) =>
    typeof node.type === 'string' &&
    (value === undefined ? node.props[attribute] !== undefined : node.props[attribute] === value))
}

export function byLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance | undefined {
  return renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === label)[0]
}
