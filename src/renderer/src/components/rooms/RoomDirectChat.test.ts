import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { RoomDirectHeader } from './RoomDirectChat'
import type { Room } from '@shared/rooms-api'

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
