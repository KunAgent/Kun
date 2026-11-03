// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import i18n from '../../../i18n'

const provider = vi.hoisted(() => ({
  controlTeamWorker: vi.fn(),
  interruptTurn: vi.fn()
}))

vi.mock('../../../agent/registry', () => ({
  getProvider: () => provider
}))

import { useActivityStore } from '../../../store/activity-store'
import { useHarnessStore } from '../../../store/harness-store'
import { MGR, workerRow } from '../../workers/worker-test-fixtures'
import { OPEN_WORKER_SESSION_EVENT } from '../../workers/worker-view-store'
import {
  formatDispatchableNames,
  isDispatchManagerThread,
  splitDispatchableNames
} from '../FloatingComposerDispatchableAgents'
import { OPEN_WORKERS_PANEL_EVENT } from '../FloatingComposerWorkersPill'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import { ComposerActivityTray } from './ComposerActivityTray'
import { useDispatchTrayKind } from './dispatch-tray-kind'
import { useWorkersTrayKind } from './workers-tray-kind'

const MANAGER_THREAD = { id: MGR, workspaceMode: 'ade' }

function readyHarness(id: string, displayName: string): AdeHarnessRow {
  const profile = { harnessId: id, credentialMode: 'native-login' }
  return {
    definition: { id, displayName, transport: 'acp', credentialModes: ['native-login'] },
    enabled: true,
    status: { installed: 'yes' },
    enabledProfiles: [profile],
    readyProfiles: [{ ...profile, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }]
  } as unknown as AdeHarnessRow
}

function Host({ context }: { context: FloatingComposerRenderContext }): ReactElement | null {
  const workers = useWorkersTrayKind(context)
  const dispatch = useDispatchTrayKind(context)
  return createElement(ComposerActivityTray, { kinds: [workers, dispatch], compact: context.compact === true })
}

describe('workers and dispatch tray kinds', () => {
  let host: HTMLDivElement
  let root: Root
  const openSettings = vi.fn()

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    vi.clearAllMocks()
    provider.controlTeamWorker.mockResolvedValue(undefined)
    provider.interruptTurn.mockResolvedValue(undefined)
    useActivityStore.setState({ rows: {}, cursor: null, status: 'live' })
    useHarnessStore.setState({ rows: [] })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  const render = async (overrides: Record<string, unknown> = {}): Promise<void> => {
    await act(async () => root.render(createElement(Host, {
      context: { activeThreadId: MGR, busy: false, compact: false, openSettings, ...overrides }
    })))
  }
  const seed = (rows: Record<string, ReturnType<typeof workerRow>>, status: 'live' | 'error' = 'live'): void => {
    useActivityStore.setState({ rows, status })
  }
  const segment = (kind = 'workers'): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>(`[data-tray-kind="${kind}"]`)
  const click = async (element: Element | null): Promise<void> => {
    expect(element).not.toBeNull()
    await act(async () => (element as HTMLElement).click())
  }
  const listen = (event: string): { details: unknown[]; stop: () => void } => {
    const details: unknown[] = []
    const listener = (raw: Event): void => { details.push((raw as CustomEvent).detail ?? null) }
    window.addEventListener(event, listener)
    return { details, stop: () => window.removeEventListener(event, listener) }
  }

  it('stays hidden for threads without background work', async () => {
    await render()
    expect(host.innerHTML).toBe('')
    seed({ other: workerRow({ unitId: 'other', threadId: 'other', parentThreadId: 'thr_other' }) })
    await render()
    expect(host.innerHTML).toBe('')
  })

  it('keeps unfinished background work visible with the old strip markers', async () => {
    seed({
      w1: workerRow({ unitId: 'w1', threadId: 'w1', title: 'repair-check', state: 'working' }),
      w2: workerRow({ unitId: 'w2', threadId: 'w2', state: 'initializing' }),
      other: workerRow({ unitId: 'other', threadId: 'other', parentThreadId: 'thr_other' })
    })
    await render()
    const button = segment()!
    expect(button.dataset.backgroundTaskStrip).toBe('running')
    expect(button.dataset.backgroundTaskUnfinished).toBe('2')
    expect(button.getAttribute('aria-label')).toBe('Collaborators: 2 collaborators working')
    expect(button.title).toContain('1 running · 1 starting')
    expect(button.querySelectorAll('.ds-composer-tray-avatar')).toHaveLength(2)
    expect(host.textContent).not.toContain('other')
  })

  it('puts a waiting worker first and answers it in its own tab', async () => {
    seed({
      w1: workerRow({ unitId: 'w1', threadId: 'w1', title: 'unit tests', state: 'working', progressNote: 'Writing case 6' }),
      w2: workerRow({ unitId: 'w2', threadId: 'w2', title: 'docs', state: 'waiting', waitingReason: 'question', lastMessagePreview: 'Delete the old note?' }),
      w3: workerRow({ unitId: 'w3', threadId: 'w3', title: 'review', state: 'done', reviewStatus: 'passed' })
    })
    await render()
    const button = segment()!
    expect(button.dataset.backgroundTaskStrip).toBe('waiting-user')
    expect(button.dataset.backgroundTaskUnfinished).toBe('2')
    expect(button.querySelector('[data-tone="waiting"]')?.textContent).toBe('1 needs you')
    expect(button.getAttribute('aria-label')).toBe('Collaborators: 1 needs you, 2 unfinished')
    await click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.textContent).toContain('Collaborators')
    const rows = [...host.querySelectorAll<HTMLElement>('[data-worker-tray-row]')]
    expect(rows.map((row) => row.dataset.workerTrayStatus)).toEqual(['waiting', 'running', 'done'])
    expect(rows[0]!.dataset.highlighted).toBe('true')
    expect(rows[0]!.textContent).toContain('Delete the old note?')
    expect(rows[1]!.textContent).toMatch(/Running for \d+m( \d+s)? · Writing case 6/)
    expect(host.querySelector('.ds-composer-tray-sheet-summary')?.textContent)
      .toMatch(/^\d+m( \d+s)? · 1 in background · 1 needs you$/)
    const opened = listen(OPEN_WORKER_SESSION_EVENT)
    await click(host.querySelector('[data-workers-tray-resolve="w2"]'))
    opened.stop()
    expect(opened.details).toEqual([{ workerId: 'w2' }])
    expect(host.querySelector('[data-tray-sheet]')).toBeNull()
  })

  it('opens a worker from its row and the whole panel from the header', async () => {
    seed({ w1: workerRow({ unitId: 'w1', threadId: 'w1', state: 'done', reviewStatus: 'passed' }) })
    await render()
    await click(segment())
    const opened = listen(OPEN_WORKER_SESSION_EVENT)
    await click(host.querySelector('[data-worker-tray-row="w1"] .ds-composer-tray-row-open'))
    opened.stop()
    expect(opened.details).toEqual([{ workerId: 'w1' }])
    await click(segment())
    const panel = listen(OPEN_WORKERS_PANEL_EVENT)
    await click(host.querySelector('[data-workers-tray-open-panel]'))
    panel.stop()
    expect(panel.details).toHaveLength(1)
  })

  it('stops team members through the team and child agents through their turn', async () => {
    seed({
      team: workerRow({ unitId: 'team', threadId: 'team', teamId: 'team_1', state: 'working' }),
      child: workerRow({ unitId: 'child', threadId: 'thr_child', turnId: 'turn_1', state: 'working' })
    })
    await render()
    await click(segment())
    await click(host.querySelector('[data-workers-tray-stop="team"] button'))
    expect(provider.controlTeamWorker).toHaveBeenCalledWith('team', 'stop')
    await click(host.querySelector('[data-workers-tray-stop="child"] button'))
    expect(provider.interruptTurn).toHaveBeenCalledWith('thr_child', 'turn_1')
  })

  it('shows a failed stop where it was taken', async () => {
    provider.controlTeamWorker.mockRejectedValue(new Error('worker is gone'))
    seed({ team: workerRow({ unitId: 'team', threadId: 'team', teamId: 'team_1', state: 'working' }) })
    await render()
    await click(segment())
    await click(host.querySelector('[data-workers-tray-stop="team"] button'))
    await vi.waitFor(() => expect(host.querySelector('[data-workers-tray-error]')?.textContent).toContain('worker is gone'))
  })

  it('treats an open review verdict as unfinished and settled work as done', async () => {
    seed({ w1: workerRow({ unitId: 'w1', threadId: 'w1', state: 'done', reviewRequired: true }) })
    await render()
    expect(segment()!.dataset.backgroundTaskStrip).toBe('review')
    expect(segment()!.dataset.backgroundTaskUnfinished).toBe('1')
    seed({ w1: workerRow({ unitId: 'w1', threadId: 'w1', state: 'done', reviewStatus: 'passed' }) })
    await render({ busy: true })
    expect(segment()!.dataset.backgroundTaskStrip).toBe('continuing')
    expect(segment()!.textContent).toContain('Collaboration done')
  })

  it('reports an unconfirmed state instead of live progress when the feed is down', async () => {
    seed({ w1: workerRow({ unitId: 'w1', threadId: 'w1', teamId: 'team_1', state: 'working' }) }, 'error')
    await render()
    expect(segment()!.dataset.backgroundTaskStrip).toBe('unknown')
    expect(segment()!.textContent).toContain('Status unconfirmed')
    await click(segment())
    expect(host.querySelector('.ds-composer-tray-sheet-summary')?.textContent)
      .toBe('Connection lost; showing the last confirmed state')
    expect(host.querySelector('[data-worker-tray-row="w1"]')?.getAttribute('data-worker-tray-status')).toBe('unconfirmed')
    expect(host.querySelector('[data-workers-tray-stop]')).toBeNull()
  })

  it('draws avatars and a tone dot in a side conversation', async () => {
    seed({ w1: workerRow({ unitId: 'w1', threadId: 'w1', state: 'waiting' }) })
    await render({ compact: true })
    const button = segment()!
    expect(button.querySelector('.ds-composer-tray-segment-label')).toBeNull()
    expect(button.querySelector('.ds-composer-tray-dot')?.getAttribute('data-tone')).toBe('waiting')
    expect(button.title).toBe('Collaborators: 1 needs you')
  })

  describe('dispatchable agents', () => {
    const managerContext = { activeThread: MANAGER_THREAD, adeComposerEnabled: true }

    beforeEach(() => {
      useHarnessStore.setState({
        rows: [
          readyHarness('claude-code', 'Claude Code'),
          readyHarness('codex', 'Codex'),
          readyHarness('opencode', 'OpenCode'),
          readyHarness('cursor', 'Cursor')
        ]
      })
    })

    it('shows a dispatch segment on a manager session without workers', async () => {
      await render(managerContext)
      const button = segment('dispatch')!
      expect(button.dataset.dispatchableAgentsPill).toBe('true')
      expect(button.getAttribute('aria-expanded')).toBeNull()
      expect(button.textContent).toBe('4 agents to hand off to')
      expect(button.title).toContain('Claude Code · Codex · OpenCode +1')
      await click(button)
      expect(openSettings).toHaveBeenCalledWith('agentsHarnesses')
    })

    it('warns when nothing can be dispatched and hides off manager sessions', async () => {
      useHarnessStore.setState({ rows: [] })
      await render(managerContext)
      expect(segment('dispatch')!.querySelector('[data-tone="waiting"]')?.textContent).toBe('No dispatchable agents')
      await render({ activeThread: { id: MGR, workspaceMode: 'ade', harnessId: 'codex' }, adeComposerEnabled: true })
      expect(segment('dispatch')).toBeNull()
      await render({ ...managerContext, adeComposerEnabled: false })
      expect(segment('dispatch')).toBeNull()
    })

    it('moves into the workers sheet footer once workers exist', async () => {
      seed({ w1: workerRow({ unitId: 'w1', threadId: 'w1', state: 'working' }) })
      await render(managerContext)
      expect(segment('dispatch')).toBeNull()
      await click(segment())
      const footer = host.querySelector('[data-workers-tray-dispatch]')!
      expect(footer.textContent).toContain('Can also hand off to: Claude Code · Codex · OpenCode +1')
      await click(host.querySelector('[data-workers-tray-manage-agents]'))
      expect(openSettings).toHaveBeenCalledWith('agentsHarnesses')
      await render()
      await click(segment())
      expect(host.querySelector('[data-workers-tray-dispatch]')).toBeNull()
    })
  })
})

describe('dispatchable agent helpers', () => {
  it('only treats ADE manager sessions as dispatchers', () => {
    expect(isDispatchManagerThread({ workspaceMode: 'ade' }, true)).toBe(true)
    expect(isDispatchManagerThread({ workspaceMode: 'ade' }, false)).toBe(false)
    expect(isDispatchManagerThread({ workspaceMode: 'code' }, true)).toBe(false)
    expect(isDispatchManagerThread({ workspaceMode: 'ade', harnessId: 'codex' }, true)).toBe(false)
    expect(isDispatchManagerThread({ workspaceMode: 'ade', executionUnit: {} } as never, true)).toBe(false)
    expect(isDispatchManagerThread(null, true)).toBe(false)
  })

  it('spells out three names, then counts the rest', () => {
    expect(formatDispatchableNames(['A', 'B'])).toBe('A · B')
    expect(formatDispatchableNames(['A', 'B', 'C', 'D', 'E'])).toBe('A · B · C +2')
    expect(splitDispatchableNames(['A', 'B', 'C', 'D'])).toEqual({ shown: ['A', 'B', 'C'], extra: 1 })
  })
})
