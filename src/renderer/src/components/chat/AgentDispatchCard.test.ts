import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentDispatchIntentPublicSchema, type AgentDispatchIntentView } from '@shared/agent-dispatch'
import type { ChatBlock } from '../../agent/types'
import { AgentDispatchGroup } from './AgentDispatchCard'

const state = vi.hoisted(() => ({ intent: undefined as AgentDispatchIntentView | undefined,
  act: vi.fn(), busy: false, error: '', activeThreadId: 'parent', rows: {} as Record<string, unknown> }))
const preview = vi.hoisted(() => vi.fn())
vi.mock('./use-agent-dispatch-intent', () => ({ useAgentDispatchIntent: () => state }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key
}) }))
vi.mock('../../store/chat-store', () => ({ useChatStore: (select: (value: unknown) => unknown) =>
  select({ activeThreadId: state.activeThreadId }) }))
vi.mock('../../store/activity-store', () => ({ useActivityStore: (select: (value: unknown) => unknown) =>
  select({ rows: state.rows }) }))
vi.mock('../workers/worker-view-store', () => ({ selectWorkerPreview: preview }))
vi.mock('./FloatingComposerWorkersPill', () => ({ OPEN_WORKERS_PANEL_EVENT: 'open-workers-panel' }))
vi.mock('./AgentDispatchIntentControls', () => ({ AgentDispatchIntentControls: (props: { readOnly: boolean }) =>
  createElement('div', { 'data-controls': props.readOnly ? 'read-only' : 'interactive' }) }))
vi.mock('./AgentDispatchRoutePicker', () => ({
  AgentDispatchRoutePicker: (props: { route: { agentId: string }; disabled: boolean; onChange: (route: unknown) => void }) =>
    createElement('button', { 'data-route-picker': props.route.agentId, disabled: props.disabled,
      onClick: () => props.onChange({ agentId: 'codex', model: 'gpt-5', credentialMode: 'native-login' }) }),
  AgentDispatchRouteLabel: (props: { route: { agentId: string } }) => createElement('span', { 'data-route-label': props.route.agentId })
}))

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-10-22T02:00:18.000Z')
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  state.act.mockReset().mockResolvedValue(undefined)
  state.activeThreadId = 'parent'
  state.rows = {}
  state.error = ''
  preview.mockReset()
})
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount())
  renderer = undefined
  vi.useRealTimers()
})

const routes = [{ agentId: 'kun', model: 'deepseek-flash', providerId: 'deepseek', credentialMode: 'provider' as const },
  { agentId: 'kun', model: 'deepseek-flash', providerId: 'deepseek', credentialMode: 'provider' as const }]

function fixture(overrides: Partial<AgentDispatchIntentView> = {},
  permissionMode: AgentDispatchIntentView['recommendation']['permissionMode'] = 'full-access'): AgentDispatchIntentView {
  return AgentDispatchIntentPublicSchema.parse({ intentId: 'intent', kind: 'worker', state: 'countdown', revision: 2,
    source: { threadId: 'parent', turnId: 'turn', toolCallId: 'call', applicationSessionId: 'app' },
    policySnapshot: { approvalPolicy: 'never', sandboxMode: 'danger-full-access', approvalReviewer: 'user' },
    recommendation: { title: 'Cursor review / ACP review', task: 'Review both resume paths', agentId: 'kun',
      model: 'deepseek-flash', permissionMode, agentSelection: 'auto', workspace: '/repo/DeepSeek-GUI',
      assignments: [{ label: 'Cursor review', agentName: 'Kun', ...routes[0] }, { label: 'ACP review', agentName: 'Kun', ...routes[1] }] },
    startRequestId: 'intent:start', deadline: '2026-10-22T02:01:00.000Z',
    createdAt: '2026-10-22T02:00:00.000Z', updatedAt: '2026-10-22T02:00:00.000Z', ...overrides })
}

const block = { id: 'tool-1', kind: 'tool', status: 'success', meta: { dispatchIntentId: 'intent' } } as unknown as ChatBlock

async function render(): Promise<string> {
  await act(async () => { renderer = create(createElement(AgentDispatchGroup, { blocks: [block] })) })
  return JSON.stringify(renderer!.toJSON())
}

describe('Agent dispatch card', () => {
  it('switches one worker route from a counting-down batch card', async () => {
    state.intent = fixture()
    const text = await render()
    expect(text).toContain('dispatchIntent.batchTitle:{\\"n\\":2}')
    expect(text).toContain('dispatchIntent.autoIn:{\\"time\\":\\"0:42\\"}')
    const pickers = renderer!.root.findAll((node) => node.type === 'button' && node.props['data-route-picker'])
    expect(pickers).toHaveLength(2)
    await act(async () => { pickers[1].props.onClick() })
    expect(state.act).toHaveBeenCalledWith('update', { recommendation: { assignments: [routes[0],
      { agentId: 'codex', model: 'gpt-5', credentialMode: 'native-login' }] } })
  })

  it('tells ask-for-approval users the card starts if nobody replies', async () => {
    state.intent = fixture({}, 'ask-for-approval')
    expect(await render()).toContain('dispatchIntent.autoIfNoReply:{\\"time\\":\\"0:42\\"}')
  })

  it('locks routes and shows live worker progress once admitted', async () => {
    state.intent = fixture({ state: 'running', deadline: undefined, target: { threadId: 'parent', workerIds: ['w1', 'w2'] } })
    state.rows = { w1: { unitId: 'w1', threadId: 'w1', state: 'working', currentTool: 'read_file' } }
    const text = await render()
    expect(renderer!.root.findAll((node) => node.props['data-route-picker'])).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.type === 'span' && node.props['data-route-label'])).toHaveLength(2)
    expect(text).toContain('read_file')
    const view = renderer!.root.findAll((node) => node.type === 'button' &&
      node.props['aria-label'] === 'dispatchIntent.viewProcess 1')[0]
    const target = new EventTarget()
    const opened = vi.fn()
    target.addEventListener('open-workers-panel', opened)
    vi.stubGlobal('window', target)
    try { await act(async () => { view.props.onClick() }) } finally { vi.unstubAllGlobals() }
    expect(preview).toHaveBeenCalledWith('parent', 'w1')
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('keeps another conversation\'s card read-only', async () => {
    state.intent = fixture()
    state.activeThreadId = 'other'
    await render()
    expect(renderer!.root.findAll((node) => node.props['data-route-picker'])).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-controls'] === 'read-only')).toHaveLength(1)
  })

  it('renders nothing for a process run without dispatch cards', async () => {
    await act(async () => { renderer = create(createElement(AgentDispatchGroup, { blocks: [{ ...block, meta: {} } as ChatBlock] })) })
    expect(renderer!.toJSON()).toBeNull()
  })
})
