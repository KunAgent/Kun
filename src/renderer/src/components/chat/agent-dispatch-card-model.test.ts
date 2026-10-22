import { describe, expect, it } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import { AgentDispatchIntentPublicSchema, type AgentDispatchIntentView } from '@shared/agent-dispatch'
import {
  dispatchAssignments, dispatchCountdown, dispatchPhase, dispatchRoutesEditable, formatDispatchClock,
  replaceAssignmentRoute, routeForRole, routeFromWorkbenchModel, sameAssignmentRoute, withRouteRole,
  workbenchModelFromRoute, workerProgress
} from './agent-dispatch-card-model'

function intent(overrides: Partial<AgentDispatchIntentView> = {},
  recommendation: Partial<AgentDispatchIntentView['recommendation']> = {}): AgentDispatchIntentView {
  return AgentDispatchIntentPublicSchema.parse({ intentId: 'intent', kind: 'worker', state: 'countdown', revision: 2,
    source: { threadId: 'parent', turnId: 'turn', toolCallId: 'call', applicationSessionId: 'app' },
    policySnapshot: { approvalPolicy: 'never', sandboxMode: 'danger-full-access', approvalReviewer: 'user' },
    recommendation: { title: 'Review A / Review B', task: 'Review both paths', agentId: 'kun', model: 'deepseek-flash',
      permissionMode: 'full-access', agentSelection: 'auto', ...recommendation },
    startRequestId: 'intent:start', deadline: '2026-10-22T02:01:00.000Z',
    createdAt: '2026-10-22T02:00:00.000Z', updatedAt: '2026-10-22T02:00:00.000Z', ...overrides })
}

function row(workerId: string, patch: Partial<ActivityRow>): ActivityRow {
  return { unitId: workerId, kind: 'worker', threadId: workerId, harnessId: 'kun', title: workerId,
    workspace: { path: '/repo', kind: 'worktree' }, state: 'working', mainState: 'working',
    children: { working: 0, waiting: 0, done: 0, failed: 0 }, stateSince: '2026-10-22T02:00:00.000Z',
    updatedAt: '2026-10-22T02:00:00.000Z', provenance: 'runtime', restoredUnconfirmed: false, stalled: false,
    visibility: 'active', residency: 'live', pinned: false, ...patch }
}

describe('dispatch card view model', () => {
  it('uses per-worker routes when the card carries them', () => {
    const assignments = [{ label: 'Review A', agentId: 'kun', model: 'deepseek-flash' },
      { label: 'Review B', agentId: 'codex', model: 'gpt-5', credentialMode: 'native-login' as const }]
    expect(dispatchAssignments(intent({}, { assignments }))).toEqual(assignments)
  })

  it('splits a legacy batch title only when it lines up with the admitted workers', () => {
    expect(dispatchAssignments(intent({ target: { workerIds: ['w1', 'w2'] } })).map((entry) => entry.label))
      .toEqual(['Review A', 'Review B'])
    expect(dispatchAssignments(intent({ target: { workerIds: ['w1', 'w2', 'w3'] } }))).toEqual([
      { label: 'Review A / Review B', agentId: 'kun', model: 'deepseek-flash' }])
  })

  it('replaces one route and sends every worker in card order', () => {
    const routes = [{ agentId: 'kun', model: 'a', providerId: 'deepseek', credentialMode: 'provider' as const },
      { agentId: 'kun', model: 'a', providerId: 'deepseek', credentialMode: 'provider' as const }]
    expect(replaceAssignmentRoute(routes, 1, { agentId: 'codex', model: 'gpt-5', credentialMode: 'native-login' })).toEqual([
      routes[0], { agentId: 'codex', model: 'gpt-5', credentialMode: 'native-login' }])
  })

  it('round-trips routes through the room picker model shape without account fields', () => {
    const route = { agentId: 'claude-code', model: 'kun/openrouter/sonnet', providerId: 'openrouter', credentialMode: 'kun-gateway' as const }
    expect(routeFromWorkbenchModel(workbenchModelFromRoute(route))).toEqual(route)
    expect(routeFromWorkbenchModel({ model: '', harnessId: undefined })).toEqual({ agentId: 'kun' })
  })

  it('drains the countdown from the full window to zero', () => {
    const card = intent()
    expect(dispatchCountdown(card, Date.parse('2026-10-22T02:00:00.000Z'))).toEqual({ remainingMs: 60_000, fraction: 1 })
    expect(dispatchCountdown(card, Date.parse('2026-10-22T02:00:45.000Z'))).toEqual({ remainingMs: 15_000, fraction: 0.25 })
    expect(dispatchCountdown(card, Date.parse('2026-10-22T02:02:00.000Z'))).toEqual({ remainingMs: 0, fraction: 0 })
    expect(dispatchCountdown(intent({ state: 'pending_confirmation', deadline: undefined }), Date.now())).toBeNull()
    expect(formatDispatchClock(179_001)).toBe('3:00')
    expect(formatDispatchClock(42_000)).toBe('0:42')
  })

  it('keeps routes editable only before admission', () => {
    expect(['pending_confirmation', 'countdown', 'paused'].map((state) =>
      dispatchRoutesEditable(intent({ state: state as AgentDispatchIntentView['state'] })))).toEqual([true, true, true])
    expect(['reviewing', 'queued', 'running', 'completed'].map((state) =>
      dispatchRoutesEditable(intent({ state: state as AgentDispatchIntentView['state'] })))).toEqual([false, false, false, false])
    expect(dispatchPhase('awaiting_parent')).toBe('review')
    expect(dispatchPhase('uncertain')).toBe('active')
  })

  it('maps live worker rows onto per-row progress', () => {
    const running = intent({ state: 'running', deadline: undefined, target: { workerIds: ['w1', 'w2', 'w3'] } })
    const rows = {
      w1: row('w1', { state: 'working', currentTool: 'read_file' }),
      w2: row('w2', { state: 'waiting', mainState: 'waiting', waitingReason: 'approval' }),
      w3: row('w3', { state: 'idle', mainState: 'idle', lastOutcome: 'completed' })
    }
    expect(workerProgress(running, 0, rows)).toEqual({ workerId: 'w1', state: 'working', detail: 'read_file' })
    expect(workerProgress(running, 1, rows)).toMatchObject({ workerId: 'w2', state: 'waiting', waitingReason: 'approval' })
    expect(workerProgress(running, 2, rows)).toEqual({ workerId: 'w3', state: 'done' })
    expect(workerProgress(running, 3, rows)).toEqual({ state: 'pending' })
    expect(workerProgress(intent({ state: 'running', deadline: undefined, target: { workerIds: ['w9'] } }), 0, {}))
      .toEqual({ workerId: 'w9', state: 'working' })
  })
})

describe('dispatch card roster roles', () => {
  const kun = { agentId: 'kun', model: 'deepseek-flash' }
  const bound = { id: 'reviewer', engine: { kind: 'bound' as const, harnessId: 'codex', credentialMode: 'native-login' as const, model: 'gpt-5.5-codex' } }

  it('moves a worker onto the engine a chosen role is bound to', () => {
    expect(routeForRole(kun, bound)).toEqual({ agentId: 'codex', profileId: 'reviewer', model: 'gpt-5.5-codex', credentialMode: 'native-login' })
    expect(routeForRole(kun, { id: 'explore', engine: { kind: 'lane-default' } })).toEqual({ ...kun, profileId: 'explore' })
    expect(routeForRole({ ...kun, profileId: 'explore' }, undefined)).toEqual(kun)
  })

  it('keeps the role across engine and model switches and counts it as a route change', () => {
    expect(withRouteRole({ agentId: 'claude-code', model: 'claude-sonnet-5' }, { ...kun, profileId: 'reviewer' }))
      .toEqual({ agentId: 'claude-code', model: 'claude-sonnet-5', profileId: 'reviewer' })
    expect(sameAssignmentRoute(kun, { ...kun, profileId: 'reviewer' })).toBe(false)
    expect(replaceAssignmentRoute([kun], 0, { ...kun, profileId: 'reviewer' })).toEqual([{ ...kun, profileId: 'reviewer' }])
  })
})
