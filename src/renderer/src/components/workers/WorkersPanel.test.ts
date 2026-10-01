// @vitest-environment jsdom
import { useWorkerViewStore } from './worker-view-store'
import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { ActivityRow } from '@shared/activity-row'
import type { AdeTeamOverview } from '@shared/ade-teams'

const provider = {
  getTeamOverview: vi.fn(),
  getThreadDetail: vi.fn(),
  sendUserMessage: vi.fn(),
  getQueuedTurns: vi.fn(),
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

const mounted = new Set<ReactTestRenderer>()
afterEach(async () => {
  await act(async () => { for (const renderer of mounted) renderer.unmount() })
  mounted.clear()
})

async function render(el: ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(el)
  })
  mounted.add(renderer)
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
  useWorkerViewStore.setState({ managers: {} })
  vi.clearAllMocks()
  provider.getTeamOverview.mockResolvedValue(overview())
  provider.getThreadDetail.mockResolvedValue({ blocks: [], latestSeq: 1 })
  provider.sendUserMessage.mockResolvedValue({ threadId: 'wrk_1', turnId: 'turn-1', status: 'queued', queuedPosition: 0 })
  provider.getQueuedTurns.mockResolvedValue({ queuedTurns: [] })
  provider.getTeamWorker.mockResolvedValue(null)
  provider.controlTeamWorker.mockResolvedValue(undefined)
  provider.answerTeamQuestion.mockResolvedValue(undefined)
  useActivityStore.setState({ rows: {}, cursor: null, status: 'live' })
  useChatStore.setState({ activeThreadId: MGR, selectThread: vi.fn(async () => undefined) } as never)
})

describe('WorkersPanel', () => {
  it('does not fetch teams or mount a worker transcript while its tool tab is hidden', async () => {
    const renderer = await render(createElement(WorkersPanel, { active: false }))
    expect(provider.getTeamOverview).not.toHaveBeenCalled()
    expect(renderer.root.findAll((node) => node.props['data-worker-inspector'])).toHaveLength(0)
  })

  it('keeps an explicit manager scope when the globally active thread differs', async () => {
    useChatStore.setState({ activeThreadId: 'other-thread' } as never)
    const renderer = await render(createElement(WorkersPanel, { managerThreadId: MGR }))
    expect(provider.getTeamOverview).toHaveBeenCalledWith(MGR)
    expect(JSON.stringify(renderer.toJSON())).toContain('backend')
    expect(useChatStore.getState().activeThreadId).toBe('other-thread')
  })

  it('previews a worker in place and opens its full thread only on the explicit action', async () => {
    const renderer = await render(createElement(WorkersPanel))
    const open = buttons(renderer).find((button) => buttonText(button) === 'backend')!
    await act(async () => open.props.onClick())
    expect(useChatStore.getState().activeThreadId).toBe(MGR)
    expect(useChatStore.getState().selectThread).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(provider.getThreadDetail).toHaveBeenCalledWith('wrk_1',
      expect.objectContaining({ priority: 'background', signal: expect.any(AbortSignal) })))
    expect(renderer.root.findAll((node) => node.props['data-worker-inspector'] === 'wrk_1')).toHaveLength(1)
    const fullOpen = renderer.root.findAll((node) => node.props['data-worker-full-open'] === 'wrk_1')[0]!
    await act(async () => fullOpen.props.onClick())
    expect(useChatStore.getState().selectThread).toHaveBeenCalledWith('wrk_1')
  })

  it('ignores a late detail response after switching the preview to another worker', async () => {
    let resolveFirst: ((detail: { blocks: []; latestSeq: number }) => void) | undefined
    provider.getThreadDetail.mockImplementation((id: string) => id === 'wrk_1'
      ? new Promise((resolve) => { resolveFirst = resolve })
      : Promise.resolve({ blocks: [], latestSeq: 22 }))
    const renderer = await render(createElement(WorkersPanel))
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
    await vi.waitFor(() => expect(resolveFirst).toBeDefined())
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'docs')!.props.onClick())
    await vi.waitFor(() => expect(renderer.root.findAll((node) =>
      node.props['data-worker-preview-seq'] === 22)).toHaveLength(1))
    await act(async () => resolveFirst!({ blocks: [], latestSeq: 11 }))
    expect(renderer.root.findAll((node) => node.props['data-worker-inspector'] === 'wrk_2')).toHaveLength(1)
    expect(renderer.root.findAll((node) => node.props['data-worker-preview-seq'] === 22)).toHaveLength(1)
    expect(useChatStore.getState().activeThreadId).toBe(MGR)
  })

  it('renders the worker conversation from its own thread detail', async () => {
    provider.getThreadDetail.mockResolvedValue({
      latestSeq: 2,
      blocks: [
        { kind: 'user', id: 'worker-user', turnId: 'worker-turn', text: 'worker scoped question' },
        { kind: 'assistant', id: 'worker-answer', turnId: 'worker-turn', text: 'worker scoped answer' }
      ]
    })
    const renderer = await render(createElement(WorkersPanel))
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
    await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('worker scoped answer'))
    expect(JSON.stringify(renderer.toJSON())).toContain('worker scoped question')
    expect(useChatStore.getState().activeThreadId).toBe(MGR)
  })

  it('keeps a separate draft for each worker without changing the main thread', async () => {
    const renderer = await render(createElement(WorkersPanel))
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
    await act(async () => renderer.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_1')[0]!.props.onChange({ target: { value: 'backend draft' } }))
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'docs')!.props.onClick())
    expect(renderer.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_2')[0]!.props.value).toBe('')
    await act(async () => renderer.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_2')[0]!.props.onChange({ target: { value: 'docs draft' } }))
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
    expect(renderer.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_1')[0]!.props.value).toBe('backend draft')
    expect(useChatStore.getState().activeThreadId).toBe(MGR)
  })

  it('restores the selected worker and its unsent input after the panel closes', async () => {
    const renderer = await render(createElement(WorkersPanel))
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
    await act(async () => renderer.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_1')[0]!.props.onChange({ target: { value: 'Keep this worker note' } }))
    useWorkerViewStore.getState().managers[MGR].scrollPositions.set('wrk_1', 420)
    await act(async () => renderer.unmount())
    mounted.delete(renderer)
    const reopened = await render(createElement(WorkersPanel))
    expect(reopened.root.findAll((node) => node.props['data-worker-inspector'] === 'wrk_1')).toHaveLength(1)
    expect(reopened.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_1')[0]!.props.value).toBe('Keep this worker note')
    expect(useWorkerViewStore.getState().managers[MGR].scrollPositions.get('wrk_1')).toBe(420)
  })

  it('sends only to the selected worker after control acknowledgement and reports queuing', async () => {
    const sequence: string[] = []
    provider.controlTeamWorker.mockImplementation(async () => { sequence.push('take-over') })
    provider.sendUserMessage.mockImplementation(async () => {
      sequence.push('send')
      return { threadId: 'wrk_1', turnId: 'queued-turn', status: 'queued', queuedPosition: 1 }
    })
    const renderer = await render(createElement(WorkersPanel))
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
    await act(async () => renderer.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_1')[0]!.props.onChange({ target: { value: 'fix only backend' } }))
    await act(async () => renderer.root.findAll((node) => node.props['data-worker-send'] === 'wrk_1')[0]!.props.onClick())
    await vi.waitFor(() => expect(provider.sendUserMessage).toHaveBeenCalledTimes(1))
    expect(sequence).toEqual(['take-over', 'send'])
    expect(provider.sendUserMessage).toHaveBeenCalledWith('wrk_1', 'fix only backend', expect.objectContaining({ enqueueIfBusy: true }))
    expect(renderer.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_1')[0]!.props.value).toBe('')
    expect(JSON.stringify(renderer.toJSON())).toContain('Queued')
    expect(useChatStore.getState().activeThreadId).toBe(MGR)
  })

  it('keeps the worker draft when host control fails', async () => {
    provider.controlTeamWorker.mockRejectedValue(new Error('control refused'))
    const renderer = await render(createElement(WorkersPanel))
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
    await act(async () => renderer.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_1')[0]!.props.onChange({ target: { value: 'keep this request' } }))
    await act(async () => renderer.root.findAll((node) => node.props['data-worker-send'] === 'wrk_1')[0]!.props.onClick())
    await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('control refused'))
    expect(renderer.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_1')[0]!.props.value).toBe('keep this request')
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
  })

  it('keeps a late uploaded attachment on its original worker after switching previews', async () => {
    let resolveUpload!: (value: unknown) => void
    const uploadRuntimeImageAttachment = vi.fn(() => new Promise((resolve) => { resolveUpload = resolve }))
    Object.defineProperty(window, 'kunGui', { configurable: true, value: {
      getPathForFile: () => '/tmp/late.png', uploadRuntimeImageAttachment
    } })
    try {
      const renderer = await render(createElement(WorkersPanel))
      await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
      const fileInput = renderer.root.findAll((node) => node.type === 'input' && node.props.type === 'file')[0]!
      await act(async () => fileInput.props.onChange({ currentTarget: { files: [new File(['png'], 'late.png', { type: 'image/png' })] } }))
      await vi.waitFor(() => expect(uploadRuntimeImageAttachment).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'wrk_1' })))
      await act(async () => buttons(renderer).find((button) => buttonText(button) === 'docs')!.props.onClick())
      await act(async () => resolveUpload({
        ok: true,
        attachment: { id: 'late-image', name: 'late.png', mimeType: 'image/png' },
        preview: { mimeType: 'image/png', dataBase64: 'AAAA' }
      }))
      expect(JSON.stringify(renderer.toJSON())).not.toContain('late.png')
      await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
      expect(JSON.stringify(renderer.toJSON())).toContain('late.png')
    } finally {
      Object.defineProperty(window, 'kunGui', { configurable: true, value: undefined })
    }
  })

  it('offers hand-back and stop as separate worker-scoped actions', async () => {
    const team = overview()
    team.team.workers[0]!.control = 'user'
    provider.getTeamOverview.mockResolvedValue(team)
    const renderer = await render(createElement(WorkersPanel))
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
    const control = renderer.root.findAll((node) => node.props['data-worker-control-action'])[0]!
    await act(async () => control.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'hand-back')
    const stop = renderer.root.findAll((node) => node.props['data-worker-stop-action'])[0]!
    await act(async () => stop.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'stop')
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(useChatStore.getState().activeThreadId).toBe(MGR)
  })

  it('does not duplicate a send when clicked twice before take-over returns', async () => {
    let acknowledge!: () => void
    provider.controlTeamWorker.mockImplementation(() => new Promise<void>((resolve) => {
      acknowledge = resolve
    }))
    const renderer = await render(createElement(WorkersPanel))
    await act(async () => buttons(renderer).find((button) => buttonText(button) === 'backend')!.props.onClick())
    await act(async () => renderer.root.findAll((node) => node.props['data-worker-draft'] === 'wrk_1')[0]!.props.onChange({ target: { value: 'send once' } }))
    const send = renderer.root.findAll((node) => node.props['data-worker-send'] === 'wrk_1')[0]!
    await act(async () => { send.props.onClick(); send.props.onClick() })
    expect(provider.controlTeamWorker).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    await act(async () => acknowledge())
    await vi.waitFor(() => expect(provider.sendUserMessage).toHaveBeenCalledTimes(1))
  })

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
