import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { ActivityRow } from '@shared/activity-row'
import type { AdeTeamOverview } from '@shared/ade-teams'

const provider = {
  getTeamOverview: vi.fn(),
  getTeamWorker: vi.fn(),
  controlTeamWorker: vi.fn(),
  answerTeamQuestion: vi.fn()
}

vi.mock('../../agent/registry', () => ({
  getProvider: () => provider
}))

import { WorkersPanel } from './WorkersPanel'
import { FloatingComposerWorkersPill } from '../chat/FloatingComposerWorkersPill'
import { WorkerControlBanner } from './WorkerControlBanner'
import { useActivityStore } from '../../store/activity-store'
import { useChatStore } from '../../store/chat-store'

const MGR = 'thr_mgr'

function workerRow(overrides: Partial<ActivityRow>): ActivityRow {
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

function overview(): AdeTeamOverview {
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
        state: 'open',
        createdAt: 'x',
        updatedAt: 'x'
      }
    ]
  }
}

async function render(el: ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(el)
  })
  return renderer
}

function buttons(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAllByType('button' as never)
}

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('')
}

function buttonText(node: ReactTestInstance): string {
  return textOf(node)
}

beforeEach(() => {
  vi.clearAllMocks()
  provider.getTeamOverview.mockResolvedValue(overview())
  provider.getTeamWorker.mockResolvedValue(null)
  provider.controlTeamWorker.mockResolvedValue(undefined)
  provider.answerTeamQuestion.mockResolvedValue(undefined)
  useActivityStore.setState({ rows: {}, cursor: null, status: 'live' })
  useChatStore.setState({ activeThreadId: MGR } as never)
})

describe('WorkersPanel', () => {
  it('renders worker rows with harness/model, diff stats, and the summary', async () => {
    useActivityStore.setState({
      rows: {
        wrk_1: workerRow({ unitId: 'wrk_1', threadId: 'wrk_1', state: 'waiting', waitingReason: 'question' }),
        wrk_2: workerRow({ unitId: 'wrk_2', threadId: 'wrk_2', state: 'working' })
      }
    })
    const renderer = await render(createElement(WorkersPanel))
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('backend')
    expect(text).toContain('claude-code')
    expect(text).toContain('opus')
    expect(text).toContain('"+","90"')
    expect(text).toContain('ship behind a flag?')
    const summary = renderer.root.findAll((n) => n.props['data-workers-summary'])[0]
    expect(summary).toBeTruthy()
  })

  it('stops a worker and detaches only after confirmation', async () => {
    const renderer = await render(createElement(WorkersPanel))
    const stop = buttons(renderer).find((b) => buttonText(b).includes('Stop'))
    await act(async () => stop!.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'stop')
    // detach needs the inline confirm
    const release = buttons(renderer).find((b) => buttonText(b).includes('Release'))
    await act(async () => release!.props.onClick())
    expect(provider.controlTeamWorker).not.toHaveBeenCalledWith('wrk_1', 'detach')
    const confirm = buttons(renderer).find((b) => buttonText(b).includes('Release worker?'))
    await act(async () => confirm!.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'detach')
  })

  it('answers an open question inline', async () => {
    const renderer = await render(createElement(WorkersPanel))
    const input = renderer.root.findAllByType('input' as never)[0]
    await act(async () => input!.props.onChange({ target: { value: 'yes, flag it' } }))
    await act(async () => input!.props.onKeyDown({ key: 'Enter' }))
    expect(provider.answerTeamQuestion).toHaveBeenCalledWith('q_1', 'yes, flag it')
  })
})

describe('FloatingComposerWorkersPill', () => {
  it('counts in-flight workers and shows the amber waiting variant', async () => {
    useActivityStore.setState({
      rows: {
        w1: workerRow({ unitId: 'w1', threadId: 'w1', state: 'working' }),
        w2: workerRow({ unitId: 'w2', threadId: 'w2', state: 'working' }),
        other: workerRow({ unitId: 'other', threadId: 'other', parentThreadId: 'thr_other' })
      }
    })
    let renderer = await render(
      createElement(FloatingComposerWorkersPill, { threadId: MGR, enabled: true })
    )
    expect(JSON.stringify(renderer.toJSON())).toContain('Workers 2')
    useActivityStore.setState({
      rows: { w2: workerRow({ unitId: 'w2', threadId: 'w2', state: 'waiting', waitingReason: 'question' }) }
    })
    renderer = await render(
      createElement(FloatingComposerWorkersPill, { threadId: MGR, enabled: true })
    )
    const pill = renderer.root.findAll((n) => n.props['data-workers-pill'] !== undefined)[0]
    expect(pill!.props.className).toContain('warning')
    expect(JSON.stringify(renderer.toJSON())).toContain('1')
  })

  it('hides for non-ade threads and teams without in-flight workers', async () => {
    useActivityStore.setState({
      rows: { w1: workerRow({ unitId: 'w1', threadId: 'w1', state: 'working' }) }
    })
    const disabled = await render(
      createElement(FloatingComposerWorkersPill, { threadId: MGR, enabled: false })
    )
    expect(disabled.toJSON()).toBeNull()
    useActivityStore.setState({ rows: {} })
    const empty = await render(
      createElement(FloatingComposerWorkersPill, { threadId: MGR, enabled: true })
    )
    expect(empty.toJSON()).toBeNull()
  })
})

describe('WorkerControlBanner', () => {
  it('shows take-over for manager control and hand-back after switching', async () => {
    provider.getTeamWorker.mockResolvedValue({
      team: { teamId: 't1' },
      worker: { workerId: 'wrk_1', label: 'backend', control: 'manager', state: 'active' }
    })
    const renderer = await render(createElement(WorkerControlBanner, { threadId: 'wrk_1' }))
    const banner = renderer.root.findAll((n) => n.props['data-worker-control-banner'])[0]
    expect(banner!.props['data-worker-control-banner']).toBe('manager')
    const button = buttons(renderer).find((b) => buttonText(b).includes('Take over'))
    provider.getTeamWorker.mockResolvedValue({
      team: { teamId: 't1' },
      worker: { workerId: 'wrk_1', label: 'backend', control: 'user', state: 'active' }
    })
    await act(async () => button!.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'take-over')
    const switched = renderer.root.findAll((n) => n.props['data-worker-control-banner'])[0]
    expect(switched!.props['data-worker-control-banner']).toBe('user')
    const handBack = buttons(renderer).find((b) => buttonText(b).includes('Hand back'))
    await act(async () => handBack!.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'hand-back')
  })

  it('stays hidden for non-worker threads', async () => {
    provider.getTeamWorker.mockResolvedValue(null)
    const renderer = await render(createElement(WorkerControlBanner, { threadId: 'thr_plain' }))
    expect(renderer.root.findAll((n) => n.props['data-worker-control-banner'])).toHaveLength(0)
  })
})
