import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { otherUserInputAnswers, RoomChoiceCard } from './RoomChoiceCard'
import { RoomNewChat } from './RoomNewChat'
import type { RoomUserInput } from './rooms-client'
import type { AgentIdentity } from '@shared/rooms-api'

const api = vi.hoisted(() => ({ request: vi.fn(), create: vi.fn(), agents: [] as AgentIdentity[] }))

vi.mock('./RoomModal', () => ({
  RoomModal: ({ title, children }: { title: string; children: unknown }) =>
    createElement('div', { 'data-room-modal': title }, children as never)
}))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsRequest: api.request,
  roomsClient: { create: api.create }
}))
vi.mock('./agent-client', async (original) => ({
  ...(await original<typeof import('./agent-client')>()),
  useAgentCatalog: () => ({ agents: api.agents, cursor: undefined, more: async () => undefined, busy: false, error: '' }),
  useAgentResource: () => ({ data: { templates: [] }, error: '', refresh: () => undefined })
}))

describe('new Agent dual-path setup UI', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    await i18n.changeLanguage('en')
    api.request.mockReset().mockResolvedValue({ roomId: 'room-1' })
    api.create.mockReset().mockResolvedValue({ room: { id: 'group-1' } })
    api.agents = [
      { id: 'agent-1', name: 'Developer', title: 'Builds', defaultRole: 'developer' },
      { id: 'agent-2', name: 'Reviewer', title: 'Reviews', defaultRole: 'reviewer' }
    ] as AgentIdentity[]
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()) })

  it('offers chat definition and a form path, and only chat-create sends setupMode', async () => {
    const onFill = vi.fn(), onOpen = vi.fn(), onClose = vi.fn()
    await act(async () => {
      renderer = create(createElement(RoomNewChat, { onClose, onOpen, onAgent: vi.fn(), onFill }))
    })
    const buttons = renderer.root.findAllByType('button')
    const chat = buttons.find((item) => item.children.includes('Define in chat'))!
    const form = buttons.find((item) => item.children.includes('Fill in yourself'))!
    await act(async () => form.props.onClick())
    expect(onFill).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    await act(async () => chat.props.onClick())
    expect(api.request).toHaveBeenCalledWith('/v1/agents/quick-create', 'POST', expect.objectContaining({ setupMode: 'chat' }))
    expect(buttons.some((item) => item.children.includes('Group chat'))).toBe(true)
  })

  it('private selection opens an Agent directly and cannot create a group', async () => {
    const onAgent = vi.fn(), onClose = vi.fn()
    await act(async () => {
      renderer = create(createElement(RoomNewChat, {
        onClose, onOpen: vi.fn(), onAgent, selectionMode: 'private', initialGroup: true
      }))
    })
    expect(renderer.root.findAllByType('button').some((item) => item.children.includes('Group chat'))).toBe(false)
    expect(renderer.root.findAllByProps({ className: 'rooms-run-primary' })).toHaveLength(0)
    const developer = renderer.root.findAllByType('button').find((item) =>
      item.findAllByType('strong').some((label) => label.props.children === 'Developer'))!
    await act(async () => developer.props.onClick())
    expect(onAgent).toHaveBeenCalledWith('agent-1')
    expect(onClose).toHaveBeenCalledOnce()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('group selection hides private creation and starts only after selecting two Agents', async () => {
    const onAgent = vi.fn(), onOpen = vi.fn(), onClose = vi.fn()
    await act(async () => {
      renderer = create(createElement(RoomNewChat, {
        onClose, onOpen, onAgent, onFill: vi.fn(), selectionMode: 'group'
      }))
    })
    const buttons = renderer.root.findAllByType('button')
    expect(buttons.some((item) => item.children.includes('Define in chat'))).toBe(false)
    expect(buttons.some((item) => item.children.includes('Fill in yourself'))).toBe(false)
    expect(renderer.root.findAllByProps({ className: 'direct-template-toggle' })).toHaveLength(0)
    const start = () => renderer.root.findByProps({ className: 'rooms-run-primary' })
    expect(start().props.disabled).toBe(true)
    const choice = (name: string) => renderer.root.findAllByType('button').find((item) =>
      item.findAllByType('strong').some((label) => label.props.children === name))!
    await act(async () => choice('Developer').props.onClick())
    expect(start().props.disabled).toBe(true)
    await act(async () => choice('Reviewer').props.onClick())
    expect(start().props.disabled).toBe(false)
    await act(async () => start().props.onClick())
    expect(onAgent).not.toHaveBeenCalled()
    expect(api.request).not.toHaveBeenCalled()
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      members: [expect.objectContaining({ participantAgentId: 'agent-1' }), expect.objectContaining({ participantAgentId: 'agent-2' })],
      collaborationMode: 'peer'
    }), expect.any(String))
    expect(onOpen).toHaveBeenCalledWith('group-1')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('submits a Grok option, custom Other text, and close as cancelled', async () => {
    const input: RoomUserInput = {
      id: 'in_abc123',
      prompt: 'What should this Agent do?',
      questions: [{ id: 'q1', question: 'What should this Agent do?', options: [
        { label: 'Write docs', description: '' }, { label: 'Review code', description: '' }
      ] }]
    }
    expect(otherUserInputAnswers(input, '  custom job  ')).toEqual([
      { id: 'q1', label: 'Other', value: 'custom job' }
    ])
    const onUpdated = vi.fn(async () => undefined)
    await act(async () => {
      renderer = create(createElement(RoomChoiceCard, { input, onUpdated }))
    })
    const option = renderer.root.findAllByType('button').find((item) =>
      item.findAllByType('b').some((label) => label.props.children === 'Write docs'))!
    await act(async () => option.props.onClick())
    expect(api.request).toHaveBeenCalledWith('/v1/user-inputs/in_abc123', 'POST', {
      answers: [{ id: 'q1', label: 'Write docs', value: 'Write docs' }]
    })
    api.request.mockClear()
    await act(async () => {
      renderer.update(createElement(RoomChoiceCard, { key: 'freeform', input, onUpdated }))
    })
    await act(async () => {
      renderer.root.findByType('input').props.onChange({ target: { value: 'custom' } })
    })
    await act(async () => renderer.root.findByProps({ className: 'direct-choice-submit' }).props.onClick())
    expect(api.request).toHaveBeenCalledWith('/v1/user-inputs/in_abc123', 'POST', {
      answers: [{ id: 'q1', label: 'Other', value: 'custom' }]
    })
    api.request.mockClear()
    await act(async () => {
      renderer.update(createElement(RoomChoiceCard, { key: 'cancel', input, onUpdated }))
    })
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Dismiss question' }).props.onClick())
    expect(api.request).toHaveBeenCalledWith('/v1/user-inputs/in_abc123', 'POST', { cancelled: true })
  })
})
