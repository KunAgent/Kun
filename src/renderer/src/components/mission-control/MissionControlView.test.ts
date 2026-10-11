import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { ActivityRow } from '@shared/activity-row'
import type { AdeTeamOverview } from '@shared/ade-teams'
import type { AppSettingsV1 } from '@shared/app-settings'
import { displayBucket } from '@shared/activity-display'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import { coerceRendererSettings } from '../settings-utils'

const provider = {
  listTaskWorkspaces: vi.fn(),
  getTeamOverview: vi.fn(),
  answerTeamQuestion: vi.fn()
}

vi.mock('../../agent/registry', () => ({
  getProvider: () => provider
}))

const popoutState = vi.hoisted(() => ({
  popout: false,
  canPopout: false,
  opened: [] as string[]
}))

vi.mock('./mission-popout', () => ({
  isMissionControlPopout: () => popoutState.popout,
  canPopoutMissionControl: () => popoutState.canPopout,
  toggleMissionControlPopout: vi.fn(),
  openMissionControlThread: (threadId: string) => popoutState.opened.push(threadId)
}))

import { MissionControlView } from './MissionControlView'
import { useActivityStore } from '../../store/activity-store'
import { useChatStore } from '../../store/chat-store'

let now = 0
const renderers = new Set<ReactTestRenderer>()
const unsubscribeSyncStatus = vi.fn()
const bridge = {
  getSettings: vi.fn(async () => coerceRendererSettings({} as AppSettingsV1)),
  getRuntimeSettingsSyncStatus: vi.fn(async () => ({
    state: 'synced' as const,
    generation: 1,
    at: '2026-01-01T00:00:00.000Z'
  })),
  onRuntimeSettingsSyncStatus: vi.fn(() => unsubscribeSyncStatus)
}
let addEventListener: ReturnType<typeof vi.fn>
let removeEventListener: ReturnType<typeof vi.fn>

function row(overrides: Partial<ActivityRow>): ActivityRow {
  const stateSince = new Date(now - 60_000).toISOString()
  return {
    unitId: `u_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'thread',
    threadId: `thr_${Math.random().toString(36).slice(2, 8)}`,
    harnessId: 'kun',
    title: 'unit',
    workspace: { path: '/repo/app', kind: 'worktree', branch: 'kun/w' },
    state: 'idle',
    mainState: 'idle',
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince,
    updatedAt: stateSince,
    provenance: 'runtime',
    restoredUnconfirmed: false,
    stalled: false,
    visibility: 'active',
    residency: 'live',
    pinned: false,
    ...overrides
  }
}

const waiting = (id: string, title: string): ActivityRow =>
  row({ unitId: id, title, state: 'waiting', waitingReason: 'approval' })
const working = (id: string, title: string): ActivityRow =>
  row({ unitId: id, title, state: 'working', mainState: 'working' })
const reviewable = (id: string, title: string): ActivityRow =>
  row({ unitId: id, title, state: 'done', kind: 'worker' })
const donePlain = (id: string, title: string): ActivityRow =>
  row({
    unitId: id,
    title,
    state: 'done',
    kind: 'thread',
    workspace: { path: '/repo/app', kind: 'local' }
  })
const idle = (id: string, title: string): ActivityRow => row({ unitId: id, title, state: 'idle' })

async function renderView(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(MissionControlView))
    renderers.add(renderer)
  })
  return renderer
}

async function unmountView(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => renderer.unmount())
  renderers.delete(renderer)
}

function columnOf(renderer: ReactTestRenderer, bucket: string) {
  return renderer.root
    .findAll((node) => node.props['data-mission-column'] === bucket)[0]
}

function cardTitles(renderer: ReactTestRenderer, bucket: string): string[] {
  const column = columnOf(renderer, bucket)
  return column
    .findAll((node) => node.props['data-mission-card'] !== undefined)
    .map((node) => node.findAllByType('span' as never)
      .map((s) => s.children.join(''))
      .find((text) => ['Wait A', 'Work B', 'Rev C', 'Done D', 'Idle E'].some((t2) => text?.includes(t2)))
    )
    .filter((v): v is string => Boolean(v))
}

beforeEach(() => {
  vi.clearAllMocks()
  rendererRuntimeClient.invalidateSettings()
  const events = new EventTarget()
  addEventListener = vi.fn(events.addEventListener.bind(events))
  removeEventListener = vi.fn(events.removeEventListener.bind(events))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { kunGui: bridge, addEventListener, removeEventListener })
  popoutState.popout = false
  popoutState.canPopout = false
  popoutState.opened.length = 0
  now = Date.now()
  provider.listTaskWorkspaces.mockResolvedValue({ records: [] })
  provider.getTeamOverview.mockResolvedValue(null)
  provider.answerTeamQuestion.mockResolvedValue(undefined)
  useActivityStore.setState({ rows: {}, cursor: null, status: 'live' })
})

afterEach(async () => {
  try {
    for (const renderer of renderers) await unmountView(renderer)
  } finally {
    renderers.clear()
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  }
})

describe('MissionControlView', () => {
  it('subscribes the readiness card to the bridge and cleans up on unmount', async () => {
    const renderer = await renderView()
    expect(renderer.root.findAll((n) => n.props['data-ade-readiness-card'] !== undefined)).toHaveLength(1)
    expect(bridge.getSettings).toHaveBeenCalledTimes(1)
    expect(bridge.getRuntimeSettingsSyncStatus).toHaveBeenCalledTimes(1)
    expect(bridge.onRuntimeSettingsSyncStatus).toHaveBeenCalledTimes(1)
    expect(addEventListener).toHaveBeenCalledWith(SETTINGS_CHANGED_EVENT, expect.any(Function))
    const listener = addEventListener.mock.calls.find(([event]) => event === SETTINGS_CHANGED_EVENT)![1]

    await unmountView(renderer)
    expect(unsubscribeSyncStatus).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledWith(SETTINGS_CHANGED_EVENT, listener)
  })

  it('groups rows exactly like displayBucket', async () => {
    const seeded = [
      waiting('u1', 'Wait A'),
      working('u2', 'Work B'),
      reviewable('u3', 'Rev C'),
      donePlain('u4', 'Done D'),
      idle('u5', 'Idle E')
    ]
    useActivityStore.setState({
      rows: Object.fromEntries(seeded.map((r) => [r.unitId, r]))
    })
    const renderer = await renderView()
    // Idle rows only appear once the board setting shows the idle column.
    const toggle = renderer.root
      .findAllByType('input' as never)
      .find((n) => n.props.type === 'checkbox')
    await act(async () => toggle!.props.onChange({ target: { checked: true } }))
    for (const seeded_row of seeded) {
      const bucket = displayBucket(seeded_row, now)
      const titles = cardTitles(renderer, bucket)
      expect(titles.some((text) => text.includes(seeded_row.title))).toBe(true)
    }
  })

  it('hides the idle column by default and reveals it via the board setting', async () => {
    useActivityStore.setState({ rows: { u5: idle('u5', 'Idle E') } })
    const renderer = await renderView()
    expect(renderer.root.findAll((n) => n.props['data-mission-column'] === 'idle')).toHaveLength(0)
    const toggle = renderer.root
      .findAllByType('input' as never)
      .find((n) => n.props.type === 'checkbox')
    await act(async () => toggle!.props.onChange({ target: { checked: true } }))
    expect(renderer.root.findAll((n) => n.props['data-mission-column'] === 'idle')).toHaveLength(1)
  })

  it('tints only the needs-you and review column headers', async () => {
    useActivityStore.setState({ rows: { u1: waiting('u1', 'Wait A') } })
    const renderer = await renderView()
    for (const bucket of ['needs-you', 'working', 'review', 'done']) {
      const header = renderer.root
        .findAll((n) => n.props['data-mission-column-header'] === bucket)[0]
      const tinted = bucket === 'needs-you' || bucket === 'review'
      expect(header!.props.className.includes('soft'), `${bucket} tint`).toBe(tinted)
    }
  })

  it('keeps card height reserved while lazy stats load', async () => {
    let resolveStats!: (v: { records: unknown[] }) => void
    provider.listTaskWorkspaces.mockReturnValueOnce(
      new Promise((resolve) => { resolveStats = resolve })
    )
    useActivityStore.setState({ rows: { u2: working('u2', 'Work B') } })
    const renderer = await renderView()
    const card = () => renderer.root.findAll((n) => n.props['data-mission-card'] !== undefined)[0]
    const before = card()!.findAll((n) => typeof n.props.className === 'string' && n.props.className.includes('min-h-[68px]'))
    expect(before).toHaveLength(1)
    await act(async () => resolveStats({ records: [] }))
    const after = card()!.findAll((n) => typeof n.props.className === 'string' && n.props.className.includes('min-h-[68px]'))
    expect(after).toHaveLength(1)
  })

  it('opens the thread when a card is clicked', async () => {
    const selectThread = vi.fn(async () => undefined)
    const original = useChatStore.getState().selectThread
    useChatStore.setState({ selectThread } as never)
    try {
      const seeded = waiting('u1', 'Wait A')
      useActivityStore.setState({ rows: { u1: seeded } })
      const renderer = await renderView()
      const cardRoot = columnOf(renderer, 'needs-you')
        .findAll((n) => n.props['data-mission-card'] !== undefined)[0]
      const button = cardRoot!.findAll((n) => n.props.role === 'button')[0]
      await act(async () => button!.props.onClick())
      expect(selectThread).toHaveBeenCalledWith(seeded.threadId)
    } finally {
      useChatStore.setState({ selectThread: original } as never)
    }
  })

  it('answers an open worker question from the card', async () => {
    const worker = row({
      unitId: 'wrk_1',
      kind: 'worker',
      threadId: 'thr_w1',
      parentThreadId: 'thr_mgr',
      title: 'worker-1',
      state: 'waiting',
      waitingReason: 'question'
    })
    const overview: AdeTeamOverview = {
      team: {
        teamId: 'team_1',
        managerThreadId: 'thr_mgr',
        status: 'active',
        workers: [],
        createdAt: 'x',
        updatedAt: 'x'
      },
      dispatches: [],
      questions: [{
        questionId: 'q1',
        dispatchId: 'd1',
        workerId: 'wrk_1',
        question: 'dark theme too?',
        state: 'open',
        createdAt: 'x',
        updatedAt: 'x'
      }]
    }
    provider.getTeamOverview.mockResolvedValue(overview)
    useActivityStore.setState({ rows: { wrk_1: worker } })
    const renderer = await renderView()
    const answerButton = renderer.root
      .findAllByType('button' as never)
      .find((b) => b.props['data-mission-answer'])
    expect(answerButton).toBeTruthy()
    await act(async () => answerButton!.props.onClick())
    const input = renderer.root
      .findAllByType('input' as never)
      .find((n) => n.props['aria-label'] === 'Answer')
    await act(async () => input!.props.onChange({ target: { value: 'yes, both' } }))
    const form = renderer.root.findAllByType('form' as never)[0]
    await act(async () => form!.props.onSubmit({ preventDefault: () => undefined }))
    expect(provider.answerTeamQuestion).toHaveBeenCalledWith('q1', 'yes, both')
  })

  it('lists team races as pills that open the compare view', async () => {
    const overview: AdeTeamOverview = {
      team: {
        teamId: 'team_1',
        managerThreadId: 'thr_mgr',
        status: 'active',
        workers: [],
        createdAt: 'x',
        updatedAt: 'x'
      },
      dispatches: [],
      questions: [],
      races: [{
        raceId: 'race_1',
        teamId: 'team_1',
        label: 'fix the bug',
        contenders: [
          { harnessId: 'claude-code', label: 'a' },
          { harnessId: 'codex', label: 'b' }
        ],
        state: 'ready',
        deadlineAt: 'x',
        createdAt: 'x',
        updatedAt: 'x'
      }]
    }
    provider.getTeamOverview.mockResolvedValue(overview)
    // A worker row is required for the overview fetch to fire.
    const worker = row({
      unitId: 'wrk_1', kind: 'worker', threadId: 'thr_w1',
      parentThreadId: 'thr_mgr', title: 'w', state: 'done'
    })
    useActivityStore.setState({ rows: { wrk_1: worker } })
    const renderer = await renderView()
    const pill = renderer.root
      .findAllByType('button' as never)
      .find((b) => b.findAllByType('span' as never)
        .some((s) => s.children.join('').includes('fix the bug')))
    expect(pill).toBeTruthy()
    // Clicking sets openRaceId; RaceCompareView portals to document.body so
    // it renders nothing in the node test env — assert no crash on click.
    await act(async () => pill!.props.onClick())
  })

  it('forwards card activation to the main window when popped out', async () => {
    popoutState.popout = true
    const selectThread = vi.fn(async () => undefined)
    const original = useChatStore.getState().selectThread
    useChatStore.setState({ selectThread } as never)
    try {
      const seeded = waiting('u9', 'Wait A')
      useActivityStore.setState({ rows: { u9: seeded } })
      const renderer = await renderView()
      const cardRoot = columnOf(renderer, 'needs-you')
        .findAll((n) => n.props['data-mission-card'] !== undefined)[0]
      const button = cardRoot!.findAll((n) => n.props.role === 'button')[0]
      await act(async () => button!.props.onClick())
      // The popout has no chat session state: selection is delegated to the
      // main window over the mission-control bridge.
      expect(popoutState.opened).toEqual([seeded.threadId])
      expect(selectThread).not.toHaveBeenCalled()
    } finally {
      useChatStore.setState({ selectThread: original } as never)
    }
  })

  it('offers the popout control only when the bridge supports it', async () => {
    useActivityStore.setState({ rows: { u1: waiting('u1', 'Wait A') } })
    let renderer = await renderView()
    expect(
      renderer.root.findAll((n) => n.props['aria-label'] === 'Pop out to window')
    ).toHaveLength(0)
    await unmountView(renderer)

    popoutState.canPopout = true
    renderer = await renderView()
    const button = renderer.root
      .findAll((n) => n.props['aria-label'] === 'Pop out to window')[0]
    expect(button).toBeTruthy()
    const { toggleMissionControlPopout } = await import('./mission-popout')
    await act(async () => button!.props.onClick())
    expect(toggleMissionControlPopout).toHaveBeenCalled()
  })
})
