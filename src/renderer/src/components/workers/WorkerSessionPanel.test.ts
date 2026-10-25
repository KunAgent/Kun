// @vitest-environment jsdom
import { createElement } from 'react'
import { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'

const provider = vi.hoisted(() => ({
  getTeamOverview: vi.fn(),
  getThreadDetail: vi.fn(),
  sendUserMessage: vi.fn(),
  getQueuedTurns: vi.fn(),
  controlTeamWorker: vi.fn(),
  answerTeamQuestion: vi.fn(),
  interruptTurn: vi.fn()
}))

vi.mock('../../agent/registry', () => ({
  getProvider: () => provider
}))

import { WorkerSessionPanel } from './WorkerSessionPanel'
import { useWorkerViewStore, workerScrollPositions } from './worker-view-store'
import { useActivityStore } from '../../store/activity-store'
import { useChatStore } from '../../store/chat-store'
import { byData, byLabel, MGR, mountTracker, teamOverview, workerRow } from './worker-test-fixtures'

const { render, unmountAll, forget } = mountTracker()
afterEach(unmountAll)

beforeEach(() => {
  useWorkerViewStore.setState({ drafts: {}, labels: {} })
  workerScrollPositions.clear()
  vi.clearAllMocks()
  const team = teamOverview()
  team.questions = []
  provider.getTeamOverview.mockResolvedValue(team)
  provider.getThreadDetail.mockResolvedValue({ blocks: [], latestSeq: 1 })
  provider.sendUserMessage.mockResolvedValue({ threadId: 'wrk_1', turnId: 'turn-1', status: 'queued', queuedPosition: 0 })
  provider.getQueuedTurns.mockResolvedValue({ queuedTurns: [] })
  provider.controlTeamWorker.mockResolvedValue(undefined)
  provider.answerTeamQuestion.mockResolvedValue(undefined)
  useActivityStore.setState({
    rows: {
      wrk_1: workerRow({ unitId: 'wrk_1', threadId: 'wrk_1' }),
      wrk_2: workerRow({ unitId: 'wrk_2', threadId: 'wrk_2', title: 'docs' })
    },
    cursor: null,
    status: 'live'
  })
  useChatStore.setState({ activeThreadId: MGR, selectThread: vi.fn(async () => undefined) } as never)
})

const draftOf = (renderer: Awaited<ReturnType<typeof render>>, workerId: string) =>
  byData(renderer, 'data-worker-draft', workerId)[0]!

async function type(renderer: Awaited<ReturnType<typeof render>>, workerId: string, value: string): Promise<void> {
  await act(async () => draftOf(renderer, workerId).props.onChange({ target: { value } }))
}

describe('WorkerSessionPanel', () => {
  it('loads nothing while its tab is hidden', async () => {
    const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1', active: false }))
    expect(provider.getTeamOverview).not.toHaveBeenCalled()
    expect(provider.getThreadDetail).not.toHaveBeenCalled()
    expect(byData(renderer, 'data-worker-draft')).toHaveLength(0)
  })

  it('renders the worker conversation from its own thread detail', async () => {
    provider.getThreadDetail.mockResolvedValue({
      latestSeq: 2,
      blocks: [
        { kind: 'user', id: 'worker-user', turnId: 'worker-turn', text: 'worker scoped question' },
        { kind: 'assistant', id: 'worker-answer', turnId: 'worker-turn', text: 'worker scoped answer' }
      ]
    })
    const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('worker scoped answer'))
    expect(provider.getThreadDetail).toHaveBeenCalledWith('wrk_1',
      expect.objectContaining({ priority: 'background', signal: expect.any(AbortSignal) }))
    expect(JSON.stringify(renderer.toJSON())).toContain('worker scoped question')
    expect(useWorkerViewStore.getState().labels.wrk_1).toBe('backend')
    expect(useChatStore.getState().activeThreadId).toBe(MGR)
  })

  it('keeps a running worker process live between model streams and folds it once settled', async () => {
    const blocks = [
      { kind: 'user', id: 'worker-user', turnId: 'worker-turn', text: 'run the checks' },
      { kind: 'tool', id: 'worker-tool', turnId: 'worker-turn', summary: 'Edited src/foo.ts', status: 'running', toolKind: 'file_change' }
    ]
    // No liveProjection: the worker is executing a tool, not streaming text.
    provider.getThreadDetail.mockResolvedValue({
      latestSeq: 3, blocks, activeTurn: { id: 'worker-turn', status: 'running', orchestration: 'direct' }
    })
    const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    await vi.waitFor(() => expect(byData(renderer, 'data-worker-preview-seq', 3)).toHaveLength(1))
    expect(byData(renderer, 'data-turn-live-status-owner')).not.toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('Edited src/foo.ts')

    provider.getThreadDetail.mockResolvedValue({
      latestSeq: 4, blocks: [blocks[0], { ...blocks[1], status: 'success' }], activeTurn: null
    })
    await act(async () => byLabel(renderer, 'More actions')!.props.onClick())
    await act(async () => byData(renderer, 'data-worker-menu-item', 'refresh')[0]!.props.onClick())
    await vi.waitFor(() => expect(byData(renderer, 'data-worker-preview-seq', 4)).toHaveLength(1))
    expect(byData(renderer, 'data-turn-live-status-owner')).toHaveLength(0)
  })

  it('keeps each worker draft and scroll offset after its tab closes', async () => {
    const first = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    await type(first, 'wrk_1', 'backend draft')
    workerScrollPositions.set('wrk_1', 420)
    await act(async () => first.unmount())
    forget(first)
    const second = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_2' }))
    expect(draftOf(second, 'wrk_2').props.value).toBe('')
    const reopened = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    expect(draftOf(reopened, 'wrk_1').props.value).toBe('backend draft')
    expect(workerScrollPositions.get('wrk_1')).toBe(420)
  })

  it('sends only to its worker after control acknowledgement and reports queuing', async () => {
    const sequence: string[] = []
    provider.controlTeamWorker.mockImplementation(async () => { sequence.push('take-over') })
    provider.sendUserMessage.mockImplementation(async () => {
      sequence.push('send')
      return { threadId: 'wrk_1', turnId: 'queued-turn', status: 'queued', queuedPosition: 1 }
    })
    const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    await type(renderer, 'wrk_1', 'fix only backend')
    await act(async () => byData(renderer, 'data-worker-send', 'wrk_1')[0]!.props.onClick())
    await vi.waitFor(() => expect(provider.sendUserMessage).toHaveBeenCalledTimes(1))
    expect(sequence).toEqual(['take-over', 'send'])
    expect(provider.sendUserMessage).toHaveBeenCalledWith('wrk_1', 'fix only backend', expect.objectContaining({ enqueueIfBusy: true }))
    expect(draftOf(renderer, 'wrk_1').props.value).toBe('')
    expect(JSON.stringify(renderer.toJSON())).toContain('Queued')
    expect(useChatStore.getState().activeThreadId).toBe(MGR)
  })

  it('keeps the worker draft when host control fails', async () => {
    provider.controlTeamWorker.mockRejectedValue(new Error('control refused'))
    const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    await type(renderer, 'wrk_1', 'keep this request')
    await act(async () => byData(renderer, 'data-worker-send', 'wrk_1')[0]!.props.onClick())
    await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('control refused'))
    expect(draftOf(renderer, 'wrk_1').props.value).toBe('keep this request')
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
  })

  it('keeps a late uploaded attachment on the worker it was added to', async () => {
    let resolveUpload!: (value: unknown) => void
    const uploadRuntimeImageAttachment = vi.fn(() => new Promise((resolve) => { resolveUpload = resolve }))
    Object.defineProperty(window, 'kunGui', { configurable: true, value: {
      getPathForFile: () => '/tmp/late.png', uploadRuntimeImageAttachment
    } })
    try {
      const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
      const fileInput = renderer.root.findAll((node) => node.type === 'input' && node.props.type === 'file')[0]!
      await act(async () => fileInput.props.onChange({ currentTarget: { files: [new File(['png'], 'late.png', { type: 'image/png' })] } }))
      await vi.waitFor(() => expect(uploadRuntimeImageAttachment).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'wrk_1' })))
      await act(async () => renderer.update(createElement(WorkerSessionPanel, { workerId: 'wrk_2' })))
      await act(async () => resolveUpload({
        ok: true,
        attachment: { id: 'late-image', name: 'late.png', mimeType: 'image/png' },
        preview: { mimeType: 'image/png', dataBase64: 'AAAA' }
      }))
      expect(JSON.stringify(renderer.toJSON())).not.toContain('late.png')
      expect(useWorkerViewStore.getState().drafts.wrk_1?.attachments.map((item) => item.name)).toEqual(['late.png'])
    } finally {
      Object.defineProperty(window, 'kunGui', { configurable: true, value: undefined })
    }
  })

  it('offers hand-back and stop as separate worker-scoped actions', async () => {
    const team = teamOverview()
    team.questions = []
    team.team.workers[0]!.control = 'user'
    provider.getTeamOverview.mockResolvedValue(team)
    const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    await act(async () => byData(renderer, 'data-worker-control-action')[0]!.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'hand-back')
    await act(async () => byData(renderer, 'data-worker-stop-action')[0]!.props.onClick())
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('wrk_1', 'stop')
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(useChatStore.getState().activeThreadId).toBe(MGR)
  })

  it('does not duplicate a send when clicked twice before take-over returns', async () => {
    let acknowledge!: () => void
    provider.controlTeamWorker.mockImplementation(() => new Promise<void>((resolve) => {
      acknowledge = resolve
    }))
    const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    await type(renderer, 'wrk_1', 'send once')
    const send = byData(renderer, 'data-worker-send', 'wrk_1')[0]!
    await act(async () => { send.props.onClick(); send.props.onClick() })
    expect(provider.controlTeamWorker).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    await act(async () => acknowledge())
    await vi.waitFor(() => expect(provider.sendUserMessage).toHaveBeenCalledTimes(1))
  })

  it('opens the full worker thread only on the explicit action', async () => {
    const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    expect(useChatStore.getState().selectThread).not.toHaveBeenCalled()
    await act(async () => byData(renderer, 'data-worker-full-open', 'wrk_1')[0]!.props.onClick())
    expect(useChatStore.getState().selectThread).toHaveBeenCalledWith('wrk_1')
  })

  it('answers an open question from the composer without taking over', async () => {
    provider.getTeamOverview.mockResolvedValue(teamOverview())
    const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    expect(byData(renderer, 'data-worker-question', 'q_1')).toHaveLength(1)
    await type(renderer, 'wrk_1', 'behind a flag')
    await act(async () => byData(renderer, 'data-worker-send', 'wrk_1')[0]!.props.onClick())
    expect(provider.answerTeamQuestion).toHaveBeenCalledWith('q_1', 'behind a flag')
    expect(provider.controlTeamWorker).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
  })

  it('locks the composer once the worker is released', async () => {
    const team = teamOverview()
    team.questions = []
    team.team.workers[0]!.state = 'released'
    provider.getTeamOverview.mockResolvedValue(team)
    const renderer = await render(createElement(WorkerSessionPanel, { workerId: 'wrk_1' }))
    expect(byData(renderer, 'data-worker-composer-locked')).toHaveLength(1)
    expect(byData(renderer, 'data-worker-draft')).toHaveLength(0)
    expect(byData(renderer, 'data-worker-stop-action')).toHaveLength(0)
  })
})
