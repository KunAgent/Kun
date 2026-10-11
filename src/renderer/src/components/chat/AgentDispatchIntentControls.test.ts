import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentDispatchIntentPublicSchema, type AgentDispatchIntentView } from '@shared/agent-dispatch'
import { AgentDispatchIntentControls } from './AgentDispatchIntentControls'

const state = vi.hoisted(() => ({ intent: undefined as AgentDispatchIntentView | undefined,
  act: vi.fn(), busy: false, error: '' }))
vi.mock('./use-agent-dispatch-intent', () => ({ useAgentDispatchIntent: () => state }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: { seconds?: number }) => values?.seconds !== undefined ? `${values.seconds}s` : key
}) }))

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-10-07T02:00:00.000Z')
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  state.intent = fixture('countdown')
  state.act.mockReset()
})
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount())
  renderer = undefined
  vi.useRealTimers()
})

describe('Agent dispatch intervention controls', () => {
  it('displays the host deadline without executing from the renderer', async () => {
    await act(async () => { renderer = create(createElement(AgentDispatchIntentControls, { intentId: 'intent' })) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('60s')
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('0s')
    expect(state.act).not.toHaveBeenCalled()
  })

  it('pauses on the server before opening an editor', async () => {
    let resolve!: (intent: AgentDispatchIntentView) => void
    state.act.mockImplementation(() => new Promise((done) => { resolve = done }))
    const edit = vi.fn()
    await act(async () => { renderer = create(createElement(AgentDispatchIntentControls, { intentId: 'intent', onEdit: edit })) })
    const button = renderer!.root.findAllByType('button').find((entry) => entry.children.includes('dispatchIntent.adjust'))!
    await act(async () => { button.props.onClick() })
    expect(state.act).toHaveBeenCalledWith('pause')
    expect(edit).not.toHaveBeenCalled()
    const paused = fixture('paused')
    await act(async () => { resolve(paused) })
    expect(edit).toHaveBeenCalledWith(paused)
  })

  it('keeps automatic review free of human confirmation buttons', async () => {
    state.intent = fixture('reviewing')
    await act(async () => { renderer = create(createElement(AgentDispatchIntentControls, { intentId: 'intent' })) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('dispatchIntent.status.reviewing')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('dispatchIntent.confirm')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('dispatchIntent.startNow')
  })

  it('supports immediate start and cancellation during the window', async () => {
    state.act.mockResolvedValue(fixture('queued'))
    await act(async () => { renderer = create(createElement(AgentDispatchIntentControls, { intentId: 'intent' })) })
    const buttons = renderer!.root.findAllByType('button')
    await act(async () => { buttons.find((entry) => entry.children.includes('dispatchIntent.startNow'))!.props.onClick() })
    expect(state.act).toHaveBeenCalledWith('start_now')
    await act(async () => { buttons.find((entry) => entry.children.includes('dispatchIntent.cancel'))!.props.onClick() })
    expect(state.act).toHaveBeenCalledWith('cancel')
  })

  it('renders replay and historical cards without mutation controls', async () => {
    await act(async () => { renderer = create(createElement(AgentDispatchIntentControls, { intentId: 'intent', readOnly: true })) })
    expect(renderer!.root.findAllByType('button')).toHaveLength(0)
  })
})

function fixture(state: AgentDispatchIntentView['state']): AgentDispatchIntentView {
  return AgentDispatchIntentPublicSchema.parse({ intentId: 'intent', kind: 'worker', state, revision: 1,
    source: { threadId: 'parent', turnId: 'turn', toolCallId: 'call', applicationSessionId: 'app' },
    policySnapshot: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access', approvalReviewer: 'user' },
    recommendation: { title: 'Fix layout', task: 'Fix the overflowing card', agentId: 'codex',
      permissionMode: 'full-access', agentSelection: 'auto' }, startRequestId: 'intent:start',
    deadline: '2026-10-07T02:01:00.000Z', createdAt: '2026-10-07T02:00:00.000Z', updatedAt: '2026-10-07T02:00:00.000Z' })
}
