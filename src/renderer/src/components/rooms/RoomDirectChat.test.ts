import { createElement, useState, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { RoomDirectHeader, RoomDirectProgress } from './RoomDirectChat'
import type { AgentDirectActivity, Room } from '@shared/rooms-api'

vi.mock('./agent-client', () => ({
  agentPath: (id: string) => '/v1/agents/' + id,
  useAgentResource: () => ({ data: null, refresh: vi.fn(), error: '' })
}))
vi.mock('./RoomAvatar', () => ({ RoomAvatar: () => null }))
vi.mock('./RoomPopover', () => ({
  RoomPopover: ({ label, children }: { label: string; children: (close: () => void) => ReactNode }) => {
    const [open, setOpen] = useState(false)
    return createElement('div', { 'data-testid': 'room-popover' },
      createElement('button', { 'aria-label': label, 'aria-expanded': open, onClick: () => setOpen(!open) }),
      open ? children(() => setOpen(false)) : null)
  }
}))

const room = {
  id: 'room-1',
  conversationKind: 'user_agent',
  members: [{ id: 'member', displayName: 'Agent', participantAgentId: 'agent-1' }]
} as unknown as Room

const baseProps = () => ({
  room,
  onSidebar: vi.fn(),
  onSearch: vi.fn(),
  onProfile: vi.fn(),
  onModels: vi.fn(),
  onFiles: vi.fn(),
  onReminders: vi.fn(),
  onReset: vi.fn(),
  onConnect: vi.fn(),
  onTasks: vi.fn(),
  onSession: vi.fn(),
  sessionOpen: false,
  sessionDisabled: false
})

describe('RoomDirectHeader session sidebar button', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()) })

  it('exposes all Agent settings directly from embedded private chat', async () => {
    const onManageAgents = vi.fn()
    await act(async () => { renderer = create(createElement(RoomDirectHeader, { ...baseProps(), embedded: true, onManageAgents })) })
    const button = renderer.root.findByProps({ 'aria-label': 'Manage all Agents' })
    act(() => button.props.onClick())
    expect(onManageAgents).toHaveBeenCalledOnce()
    expect(renderer.root.findByProps({ 'aria-label': 'More actions' }).props['aria-expanded']).toBe(false)
  })

  it('toggles the Agent session sidebar and reflects its open state', async () => {
    const props = baseProps()
    await act(async () => { renderer = create(createElement(RoomDirectHeader, props)) })
    const button = () => renderer.root.findByProps({ 'aria-label': 'View Agent session' })
    expect(button().props['aria-pressed']).toBe(false)
    expect(button().props.disabled).toBe(false)
    await act(async () => { button().props.onClick() })
    expect(props.onSession).toHaveBeenCalledTimes(1)
    await act(async () => { renderer.update(createElement(RoomDirectHeader, { ...props, sessionOpen: true })) })
    expect(button().props['aria-pressed']).toBe(true)
  })

  it('disables the sidebar button when no run session exists', async () => {
    await act(async () => {
      renderer = create(createElement(RoomDirectHeader, { ...baseProps(), sessionDisabled: true }))
    })
    expect(renderer.root.findByProps({ 'aria-label': 'View Agent session' }).props.disabled).toBe(true)
  })

  it('shows the supplied current model immediately', async () => {
    const props = baseProps()
    await act(async () => {
      renderer = create(createElement(RoomDirectHeader, {
        ...props,
        models: { main: { providerId: 'kimi', model: 'kimi-code' } } as never
      }))
    })
    const more = () => renderer.root.findByProps({ 'aria-label': 'More actions' })
    expect(more().props['aria-expanded']).toBe(false)
    expect(renderer.root.findByProps({ className: 'direct-chat-title' }).findByType('small').children).toEqual(['kimi-code'])
    await act(async () => { more().props.onClick() })
    const modelSettings = renderer.root.findAllByType('button').find((button) => button.children.includes('Model settings'))!
    await act(async () => { modelSettings.props.onClick() })
    expect(props.onModels).toHaveBeenCalledTimes(1)
    expect(more().props['aria-expanded']).toBe(false)
  })

  it('preserves embedded Agent Chat navigation and workspace controls beside the saved-files menu', async () => {
    const props = baseProps(), onToggleLeftSidebar = vi.fn()
    await act(async () => { renderer = create(createElement(RoomDirectHeader, {
      ...props, room: { ...room, privateWorkspace: '/workspace/project' }, embedded: true, onToggleLeftSidebar,
      models: { main: { providerId: 'kimi', model: 'kimi-code' } } as never
    })) })
    expect(renderer.root.findByProps({ className: 'direct-chat-title' }).findAllByType('small')).toHaveLength(0)
    await act(async () => { renderer.root.findByProps({ 'aria-label': i18n.t('sidebarToggle', { ns: 'common' }) }).props.onClick() })
    expect(onToggleLeftSidebar).toHaveBeenCalledOnce()
    await act(async () => { renderer.root.findByProps({ className: 'direct-workspace-control' }).props.onClick() })
    expect(props.onConnect).toHaveBeenCalledOnce()
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'More actions' }).props.onClick() })
    const files = renderer.root.findAllByType('button').find((button) => button.children.includes(i18n.t('directFiles', { ns: 'common' })))!
    await act(async () => { files.props.onClick() })
    expect(props.onFiles).toHaveBeenCalledOnce()
  })

  it('opens connected apps from a private Room header', async () => {
    const onApps = vi.fn()
    await act(async () => { renderer = create(createElement(RoomDirectHeader, { ...baseProps(), onApps })) })
    const more = () => renderer.root.findByProps({ 'aria-label': 'More actions' })
    const appButtons = () => renderer.root.findAllByType('button').filter((button) => button.children.includes('Connected apps'))
    expect(appButtons()).toHaveLength(0)
    await act(async () => { more().props.onClick() })
    expect(appButtons()).toHaveLength(1)
    await act(async () => { appButtons()[0].props.onClick() })
    expect(onApps).toHaveBeenCalledTimes(1)
    expect(more().props['aria-expanded']).toBe(false)
  })
})

const directState = (overrides: {
  data?: AgentDirectActivity | null
  error?: string
} = {}) => ({
  data: null,
  error: '',
  refresh: vi.fn(),
  act: vi.fn(),
  context: vi.fn(),
  ...overrides
} as unknown as Parameters<typeof RoomDirectProgress>[0]['state'])

const progressProps = (state: Parameters<typeof RoomDirectProgress>[0]['state']) => ({
  room,
  state,
  onRun: vi.fn(),
  onModels: vi.fn()
})

describe('RoomDirectProgress dismissible notices', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()) })

  const errorAlert = () => renderer.root.findAllByProps({ role: 'alert' })
  const dismissButton = () => renderer.root.findByProps({ 'aria-label': 'Dismiss notice' })
  const textOf = (instance: ReactTestInstance): string =>
    instance.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('')

  it('renders the activity error with a dismiss control and hides it once dismissed', async () => {
    const state = directState({ error: 'Error: room coordinator lease is not held' })
    await act(async () => { renderer = create(createElement(RoomDirectProgress, progressProps(state))) })
    expect(errorAlert().map(textOf).join(' ')).toContain('room coordinator lease is not held')
    await act(async () => { dismissButton().props.onClick() })
    expect(errorAlert()).toHaveLength(0)
  })

  it('keeps the same error hidden but shows a different error', async () => {
    const state = directState({ error: 'Error: room coordinator lease is not held' })
    await act(async () => { renderer = create(createElement(RoomDirectProgress, progressProps(state))) })
    await act(async () => { dismissButton().props.onClick() })
    await act(async () => { renderer.update(createElement(RoomDirectProgress, progressProps(directState({ error: 'Error: room coordinator lease is not held' })))) })
    expect(errorAlert()).toHaveLength(0)
    await act(async () => { renderer.update(createElement(RoomDirectProgress, progressProps(directState({ error: 'Error: a different failure' })))) })
    expect(errorAlert()).toHaveLength(1)
  })

  it('labels a steered request as merged into the current reply', async () => {
    const steered = { id: 'req-b', revision: 1, status: 'running', runId: 'run-b', clientRequestId: 'b',
      steer: { operationId: 'op-b', targetTurnId: 'turn-a', targetRunId: 'run-a' } }
    const state = directState({
      data: { active: steered, requests: [steered], pendingCount: 1, approvals: [], userInputs: [] } as unknown as AgentDirectActivity
    })
    await act(async () => { renderer = create(createElement(RoomDirectProgress, progressProps(state))) })
    const status = renderer.root.findByProps({ role: 'status' })
    expect(textOf(status)).toContain('Merged into the current reply')
  })

  it('dismisses the failed-response box and reopens it for a new failed request', async () => {
    const failedRequest = { id: 'req-1', revision: 1, status: 'failed', runId: 'run-1', error: 'Error: room coordinator lease is not held' }
    const state = directState({
      data: { requests: [failedRequest], pendingCount: 0, approvals: [], userInputs: [] } as unknown as AgentDirectActivity
    })
    await act(async () => { renderer = create(createElement(RoomDirectProgress, progressProps(state))) })
    expect(renderer.root.findAllByProps({ className: 'direct-failed' })).toHaveLength(1)
    await act(async () => { dismissButton().props.onClick() })
    expect(renderer.root.findAllByProps({ className: 'direct-failed' })).toHaveLength(0)
    const next = directState({
      data: { requests: [{ ...failedRequest, id: 'req-2' }], pendingCount: 0, approvals: [], userInputs: [] } as unknown as AgentDirectActivity
    })
    await act(async () => { renderer.update(createElement(RoomDirectProgress, progressProps(next))) })
    expect(renderer.root.findAllByProps({ className: 'direct-failed' })).toHaveLength(1)
  })
})
