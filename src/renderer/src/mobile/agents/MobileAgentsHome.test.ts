// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import type { AdeTeamOverview } from '@shared/ade-teams'
import type { PendingApprovalItem } from '@shared/ade-approvals'
import { useActivityStore } from '../../store/activity-store'
import { MobileAgentsHome } from './MobileAgentsHome'

const NOW = '2025-01-01T12:00:00.000Z'

const provider = vi.hoisted(() => ({
  listPendingApprovals: vi.fn(async (_threadId?: string): Promise<PendingApprovalItem[]> => []),
  getTeamOverview: vi.fn(async (_threadId: string): Promise<AdeTeamOverview | null> => null),
  submitApprovalDecision: vi.fn(async () => undefined),
  answerTeamQuestion: vi.fn(async () => undefined)
}))

vi.mock('../../agent/registry', () => ({
  getProvider: () => provider
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string): string => key,
    i18n: { language: 'en' }
  })
}))

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    unitId: 'unit-1', kind: 'worker', threadId: 'worker-1',
    parentThreadId: 'manager-1', teamId: 'team-1', harnessId: 'kun',
    title: 'Worker one', workspace: { path: '/tmp/ws', kind: 'worktree' },
    state: 'waiting', mainState: 'waiting',
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: NOW, updatedAt: NOW, provenance: 'runtime',
    restoredUnconfirmed: false, stalled: false,
    visibility: 'active', residency: 'live', pinned: false,
    ...overrides
  }
}

const PENDING: PendingApprovalItem = {
  approvalId: 'a1', threadId: 'worker-1', turnId: 'u1',
  toolName: 'write', summary: 'Write file', createdAt: NOW
}

const OVERVIEW: AdeTeamOverview = {
  team: { teamId: 'team-1' } as AdeTeamOverview['team'],
  dispatches: [],
  questions: [{
    questionId: 'q1', dispatchId: 'd1', workerId: 'worker-1',
    question: 'Which variant?', state: 'open',
    createdAt: NOW, updatedAt: NOW
  }]
}

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  for (const fn of Object.values(provider)) fn.mockClear()
  provider.listPendingApprovals.mockResolvedValue([])
  provider.getTeamOverview.mockResolvedValue(null)
  useActivityStore.setState({ rows: {}, cursor: null, status: 'idle' })
})
afterEach(() => { act(() => root.unmount()); host.remove() })

async function renderHome(rows: ActivityRow[]): Promise<{
  onOpenThread: ReturnType<typeof vi.fn>
  onOpenSettings: ReturnType<typeof vi.fn>
}> {
  useActivityStore.setState({
    rows: Object.fromEntries(rows.map((r) => [r.unitId, r])),
    status: 'live'
  })
  const onOpenThread = vi.fn()
  const onOpenSettings = vi.fn()
  await act(async () => {
    root.render(createElement(MobileAgentsHome, { onOpenThread, onOpenSettings }))
  })
  return { onOpenThread, onOpenSettings }
}

describe('mobile Mission Control', () => {
  it('shows an empty mission state when nothing is active', async () => {
    await renderHome([])
    expect(host.textContent).toContain('missionEmpty')
    expect(provider.listPendingApprovals).not.toHaveBeenCalled()
  })

  it('resolves a pending approval inline', async () => {
    provider.listPendingApprovals.mockResolvedValue([PENDING])
    await renderHome([row({ waitingReason: 'approval' })])
    expect(provider.listPendingApprovals).toHaveBeenCalledWith('worker-1')
    expect(host.textContent).toContain('Write file')
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.kun-mobile-agents-card-actions button')]
    const allow = buttons.find((b) => b.textContent === 'approvalAllow')!
    await act(async () => { allow.click() })
    expect(provider.submitApprovalDecision).toHaveBeenCalledWith('a1', 'allow', true)
  })

  it('answers a worker question inline', async () => {
    provider.getTeamOverview.mockResolvedValue(OVERVIEW)
    await renderHome([row({ waitingReason: 'question' })])
    expect(provider.getTeamOverview).toHaveBeenCalledWith('manager-1')
    expect(host.textContent).toContain('Which variant?')
    const input = host.querySelector('.kun-mobile-agents-answer input') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'the second one')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const submit = [...host.querySelectorAll<HTMLButtonElement>('.kun-mobile-agents-answer button')]
      .find((b) => b.textContent === 'missionAnswerSubmit')!
    await act(async () => { submit.click() })
    expect(provider.answerTeamQuestion).toHaveBeenCalledWith('q1', 'the second one')
  })

  it('keeps non-inline waits tappable and lists mission rows', async () => {
    const inputRow = row({ unitId: 'u1', threadId: 'worker-1', waitingReason: 'user_input', title: 'Needs input' })
    const workingRow = row({
      unitId: 'u2', threadId: 'manager-1', kind: 'thread', title: 'Main task',
      state: 'working', mainState: 'working', waitingReason: undefined,
      parentThreadId: undefined, teamId: undefined
    })
    const { onOpenThread } = await renderHome([inputRow, workingRow])
    const open = [...host.querySelectorAll<HTMLButtonElement>('.kun-mobile-agents-card-actions button')]
      .find((b) => b.textContent === 'missionOpen')!
    act(() => open.click())
    expect(onOpenThread).toHaveBeenCalledWith('worker-1')
    const lines = [...host.querySelectorAll<HTMLButtonElement>('.kun-mobile-agents-row')]
    expect(lines.map((l) => l.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Needs input'), expect.stringContaining('Main task')]))
    // Worker row nests under the manager thread row it belongs to.
    const workerLine = lines.find((l) => l.textContent?.includes('Needs input'))!
    act(() => workerLine.click())
    expect(onOpenThread).toHaveBeenCalledWith('worker-1')
  })
})
