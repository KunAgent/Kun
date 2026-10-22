// @vitest-environment jsdom
import { createElement } from 'react'
import { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { AdeTeamOverview } from '@shared/ade-teams'

const provider = vi.hoisted(() => ({
  getTeamOverview: vi.fn(),
  getThreadDetail: vi.fn(),
  getTeamWorker: vi.fn(),
  controlTeamWorker: vi.fn(),
  answerTeamQuestion: vi.fn(),
  interruptTurn: vi.fn()
}))

vi.mock('../../agent/registry', () => ({
  getProvider: () => provider
}))

import { WorkersPanel } from './WorkersPanel'
import { FloatingComposerWorkersPill } from '../chat/FloatingComposerWorkersPill'
import { WorkerControlBanner } from './WorkerControlBanner'
import { OPEN_WORKER_SESSION_EVENT, useWorkerViewStore } from './worker-view-store'
import { useActivityStore } from '../../store/activity-store'
import { useChatStore } from '../../store/chat-store'
import { buttons, byData, byLabel, MGR, mountTracker, teamOverview, textOf, workerRow } from './worker-test-fixtures'

const { render, unmountAll } = mountTracker()
afterEach(unmountAll)

beforeEach(() => {
  useWorkerViewStore.setState({ drafts: {}, labels: {} })
  vi.clearAllMocks()
  provider.getTeamOverview.mockResolvedValue(teamOverview())
  provider.getThreadDetail.mockResolvedValue({ blocks: [], latestSeq: 1 })
  provider.getTeamWorker.mockResolvedValue(null)
  provider.controlTeamWorker.mockResolvedValue(undefined)
  provider.answerTeamQuestion.mockResolvedValue(undefined)
  provider.interruptTurn.mockResolvedValue(undefined)
  useActivityStore.setState({ rows: {}, cursor: null, status: 'live' })
  useChatStore.setState({ activeThreadId: MGR, selectThread: vi.fn(async () => undefined) } as never)
})

function captureOpenedWorkers(): { opened: string[]; stop: () => void } {
  const opened: string[] = []
  const listener = (event: Event): void => {
    opened.push((event as CustomEvent<{ workerId: string }>).detail.workerId)
  }
  window.addEventListener(OPEN_WORKER_SESSION_EVENT, listener)
  return { opened, stop: () => window.removeEventListener(OPEN_WORKER_SESSION_EVENT, listener) }
}

describe('WorkersPanel', () => {
  it('does not fetch teams while its tool tab is hidden', async () => {
    const renderer = await render(createElement(WorkersPanel, { active: false }))
    expect(provider.getTeamOverview).not.toHaveBeenCalled()
    expect(byData(renderer, 'data-worker-row')).toHaveLength(0)
  })

  it('keeps an explicit manager scope when the globally active thread differs', async () => {
    useChatStore.setState({ activeThreadId: 'other-thread' } as never)
    const renderer = await render(createElement(WorkersPanel, { managerThreadId: MGR }))
    expect(provider.getTeamOverview).toHaveBeenCalledWith(MGR)
    expect(JSON.stringify(renderer.toJSON())).toContain('backend')
    expect(useChatStore.getState().activeThreadId).toBe('other-thread')
  })

  it('groups members by what they need and shows agent, usage and diff stats', async () => {
    useActivityStore.setState({
      rows: {
        wrk_1: workerRow({ unitId: 'wrk_1', threadId: 'wrk_1', state: 'waiting', waitingReason: 'question' }),
        wrk_2: workerRow({ unitId: 'wrk_2', threadId: 'wrk_2', state: 'working', currentTool: 'read_file' })
      }
    })
    const renderer = await render(createElement(WorkersPanel))
    const sections = byData(renderer, 'data-workers-section').map((node) => node.props['data-workers-section'])
    expect(sections).toEqual(['needs-you', 'working'])
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('claude-code · opus · 4.1M tok')
    expect(text).toContain('"+","90"')
    expect(text).toContain('7.97M')
    expect(text).toContain('ship behind a flag?')
    const activity = byData(renderer, 'data-worker-activity').map(textOf)
    expect(activity).toEqual(['Waiting on your answer', 'Reading files'])
    expect(byData(renderer, 'data-workers-summary')).toHaveLength(1)
  })

  it('opens a member in its own tab without touching the main thread', async () => {
    const capture = captureOpenedWorkers()
    try {
      const renderer = await render(createElement(WorkersPanel))
      await act(async () => byData(renderer, 'data-worker-open', 'wrk_2')[0]!.props.onClick())
      expect(capture.opened).toEqual(['wrk_2'])
      expect(useWorkerViewStore.getState().labels.wrk_2).toBe('docs')
      expect(useChatStore.getState().selectThread).not.toHaveBeenCalled()
      expect(provider.getThreadDetail).not.toHaveBeenCalled()
    } finally {
      capture.stop()
    }
  })

  it('stops a live member and releases it only after confirming in the menu', async () => {
    useActivityStore.setState({ rows: { wrk_1: workerRow({ unitId: 'wrk_1', threadId: 'wrk_1', state: 'working' }) } })
    const renderer = await render(createElement(WorkersPanel))
    await act(async () => byData(renderer, 'data-worker-row-stop', 'wrk_1')[0]!.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'stop')
    const row = byData(renderer, 'data-worker-row', 'wrk_1')[0]!
    const menu = row.findAll((node) => node.type === 'button' && node.props['aria-label'] === 'More actions')[0]!
    await act(async () => menu.props.onClick())
    const release = (): ReturnType<typeof byData>[number] => byData(renderer, 'data-worker-menu-item', 'detach')[0]!
    await act(async () => release().props.onClick())
    expect(provider.controlTeamWorker).not.toHaveBeenCalledWith('wrk_1', 'detach')
    expect(textOf(release())).toContain('Release worker?')
    await act(async () => release().props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'detach')
  })

  it('answers an open question inline, by option or typed text', async () => {
    const renderer = await render(createElement(WorkersPanel))
    await act(async () => byData(renderer, 'data-worker-question-option', 'Yes')[0]!.props.onClick())
    expect(provider.answerTeamQuestion).toHaveBeenCalledWith('q_1', 'Yes')
    const input = renderer.root.findAllByType('input' as never)[0]!
    await act(async () => input.props.onChange({ target: { value: 'yes, flag it' } }))
    await act(async () => input.props.onKeyDown({ key: 'Enter', nativeEvent: {} }))
    expect(provider.answerTeamQuestion).toHaveBeenCalledWith('q_1', 'yes, flag it')
  })

  it('keeps showing the loading state only while the team lookup is pending', async () => {
    let settle!: (value: AdeTeamOverview | null) => void
    provider.getTeamOverview.mockReturnValue(new Promise((resolve) => { settle = resolve }))
    const renderer = await render(createElement(WorkersPanel))
    expect(byData(renderer, 'data-workers-loading')).toHaveLength(1)
    expect(byData(renderer, 'data-workers-empty')).toHaveLength(0)
    await act(async () => settle(null))
    expect(byData(renderer, 'data-workers-loading')).toHaveLength(0)
  })

  it('shows the empty state instead of loading forever for a thread that owns no team', async () => {
    // The runtime answers 404 for threads without a team (for example one that
    // only ran subagents) and the client maps that to null.
    provider.getTeamOverview.mockResolvedValue(null)
    const renderer = await render(createElement(WorkersPanel))
    expect(provider.getTeamOverview).toHaveBeenCalledWith(MGR)
    expect(byData(renderer, 'data-workers-loading')).toHaveLength(0)
    expect(byData(renderer, 'data-workers-empty')).toHaveLength(1)
    expect(byData(renderer, 'data-workers-error')).toHaveLength(0)
  })

  it('offers a retry when the team lookup fails', async () => {
    provider.getTeamOverview.mockRejectedValueOnce(new Error('runtime down')).mockResolvedValue(teamOverview())
    const renderer = await render(createElement(WorkersPanel))
    expect(byData(renderer, 'data-workers-error')).toHaveLength(1)
    await act(async () => buttons(renderer).find((button) => textOf(button).includes('Retry'))!.props.onClick())
    expect(JSON.stringify(renderer.toJSON())).toContain('backend')
    expect(byData(renderer, 'data-workers-error')).toHaveLength(0)
  })

  it('lists child agents outside a team, which the Workers pill counts', async () => {
    // A PPT child (or a delegated subagent) registers as a worker activity row
    // without any team; the panel used to say the team has no workers.
    provider.getTeamOverview.mockResolvedValue(null)
    useActivityStore.setState({ rows: {
      child_ppt: workerRow({ unitId: 'child_ppt', threadId: 'thr_ppt_child', title: 'Kun 产品介绍', turnId: 'turn_ppt' })
    } })
    const capture = captureOpenedWorkers()
    try {
      const renderer = await render(createElement(WorkersPanel))
      expect(JSON.stringify(renderer.toJSON())).toContain('Kun 产品介绍')
      expect(byData(renderer, 'data-workers-empty')).toHaveLength(0)

      await act(async () => byData(renderer, 'data-worker-open', 'child_ppt')[0]!.props.onClick())
      expect(capture.opened).toEqual(['child_ppt'])

      await act(async () => byLabel(renderer, 'More actions')!.props.onClick())
      expect(byData(renderer, 'data-worker-menu-item', 'detach')).toHaveLength(0)
      await act(async () => byData(renderer, 'data-worker-menu-item', 'full-open')[0]!.props.onClick())
      expect(useChatStore.getState().selectThread).toHaveBeenCalledWith('thr_ppt_child')

      await act(async () => byData(renderer, 'data-worker-row-stop', 'child_ppt')[0]!.props.onClick())
      expect(provider.interruptTurn).toHaveBeenCalledWith('thr_ppt_child', 'turn_ppt')
      expect(provider.controlTeamWorker).not.toHaveBeenCalled()
    } finally {
      capture.stop()
    }
  })

  it('picks up a team created after the first lookup found none', async () => {
    provider.getTeamOverview.mockResolvedValueOnce(null).mockResolvedValue(teamOverview())
    const renderer = await render(createElement(WorkersPanel))
    expect(JSON.stringify(renderer.toJSON())).not.toContain('backend')
    await act(async () => {
      useActivityStore.setState({ rows: { wrk_1: workerRow({ unitId: 'wrk_1', threadId: 'wrk_1' }) } })
    })
    await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('backend'), { timeout: 3000 })
    expect(byData(renderer, 'data-workers-empty')).toHaveLength(0)
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
    const pill = byData(renderer, 'data-workers-pill')[0]
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
    expect(byData(renderer, 'data-worker-control-banner')[0]!.props['data-worker-control-banner']).toBe('manager')
    const button = buttons(renderer).find((b) => textOf(b).includes('Take over'))
    provider.getTeamWorker.mockResolvedValue({
      team: { teamId: 't1' },
      worker: { workerId: 'wrk_1', label: 'backend', control: 'user', state: 'active' }
    })
    await act(async () => button!.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'take-over')
    expect(byData(renderer, 'data-worker-control-banner')[0]!.props['data-worker-control-banner']).toBe('user')
    const handBack = buttons(renderer).find((b) => textOf(b).includes('Hand back'))
    await act(async () => handBack!.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'hand-back')
  })

  it('stays hidden for non-worker threads', async () => {
    provider.getTeamWorker.mockResolvedValue(null)
    const renderer = await render(createElement(WorkerControlBanner, { threadId: 'thr_plain' }))
    expect(byData(renderer, 'data-worker-control-banner')).toHaveLength(0)
  })
})
