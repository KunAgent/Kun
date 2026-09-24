import { createElement, type ReactNode } from 'react'
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
  RoomPopover: ({ children }: { children: (close: () => void) => ReactNode }) =>
    createElement('div', { 'data-testid': 'room-popover' }, children(() => undefined))
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
    await act(async () => {
      renderer = create(createElement(RoomDirectHeader, {
        ...baseProps(),
        models: { main: { providerId: 'kimi', model: 'kimi-code' } } as never
      }))
    })
    expect(renderer.root.findByProps({ 'aria-label': 'Model settings' }).findByType('span').children).toEqual(['kimi-code'])
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
