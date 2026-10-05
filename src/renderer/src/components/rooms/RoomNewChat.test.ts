import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { otherUserInputAnswers, RoomChoiceCard } from './RoomChoiceCard'
import { RoomNewChat } from './RoomNewChat'
import type { RoomUserInput } from './rooms-client'
import type { AgentIdentity } from '@shared/rooms-api'

const modelOptions = { options: [{ providerId: 'api', providerLabel: 'API', accountId: 'work', model: 'model-a', available: true }] }
const modelKey = JSON.stringify(['api', 'work', 'model-a'])

const api = vi.hoisted(() => ({ request: vi.fn(), create: vi.fn(), agents: [] as AgentIdentity[], templates: [] as AgentIdentity[] }))

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
  useAgentResource: () => ({ data: { templates: api.templates }, error: '', refresh: () => undefined })
}))

describe('new Agent dual-path setup UI', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    await i18n.changeLanguage('en')
    api.request.mockReset().mockImplementation(async (path) => path === '/v1/agents/creation-models' ? modelOptions : { roomId: 'room-1' })
    api.create.mockReset().mockResolvedValue({ room: { id: 'group-1' } })
    api.templates = []
    api.agents = [
      { id: 'agent-1', name: 'Developer', title: 'Builds', defaultRole: 'developer' },
      { id: 'agent-2', name: 'Reviewer', title: 'Reviews', defaultRole: 'reviewer' }
    ] as AgentIdentity[]
  })
  const chooseAndContinue = async () => {
    await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: modelKey } }))
    act(() => renderer.root.findAllByType('button').find((item) => item.children.includes('Continue'))!.props.onClick())
    await act(async () => undefined)
  }
  afterEach(() => { if (renderer) act(() => renderer.unmount()) })

  it('offers chat definition and a form path, and only chat-create sends setupMode', async () => {
    const onFill = vi.fn(), onOpen = vi.fn(), onClose = vi.fn()
    await act(async () => {
      renderer = create(createElement(RoomNewChat, { onClose, onOpen, onAgent: vi.fn(), onFill }))
    })
    const buttons = renderer.root.findAllByType('button')
    expect(buttons.some((item) => item.children.includes('Group chat'))).toBe(true)
    const chat = buttons.find((item) => item.children.includes('Define in chat'))!
    const form = buttons.find((item) => item.children.includes('Fill in yourself'))!
    await act(async () => form.props.onClick())
    expect(onFill).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    await act(async () => chat.props.onClick())
    expect(api.request.mock.calls.some(([path]) => path === '/v1/agents/quick-create')).toBe(false)
    await chooseAndContinue()
    expect(api.request).toHaveBeenCalledWith('/v1/agents/quick-create', 'POST', expect.objectContaining({ setupMode: 'chat', modelRef: { providerId: 'api', accountId: 'work', model: 'model-a' } }))
  })

  it('keeps template creation outside conversational setup', async () => {
    api.templates = [{ id: 'template-a', templateId: 'developer', name: 'Template developer', defaultRole: 'developer' }] as AgentIdentity[]
    await act(async () => { renderer = create(createElement(RoomNewChat, { onClose: vi.fn(), onOpen: vi.fn(), onAgent: vi.fn() })) })
    await act(async () => renderer.root.findByProps({ className: 'direct-template-toggle' }).props.onClick())
    await act(async () => renderer.root.findByProps({ className: 'direct-template-list' }).findByType('button').props.onClick())
    expect(api.request).toHaveBeenCalledWith('/v1/agents/quick-create', 'POST', { clientRequestId: expect.any(String), templateId: 'developer' })
    expect(renderer.root.findAllByType('select')).toHaveLength(0)
  })

  it('private selection opens an Agent directly and cannot create a group', async () => {
    const onAgent = vi.fn(), onClose = vi.fn()
    await act(async () => {
      renderer = create(createElement(RoomNewChat, {
        onClose, onOpen: vi.fn(), onAgent, selectionMode: 'private', initialGroup: true
      }))
    })
    expect(renderer.root.findAllByType('button').some((item) => item.children.includes('Group chat'))).toBe(false)
    expect(renderer.root.findAllByProps({ className: 'rooms-run-primary direct-start-group' })).toHaveLength(0)
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
    const start = () => renderer.root.findByProps({ className: 'rooms-run-primary direct-start-group' })
    expect(start().props.disabled).toBe(true)
    expect(start().props.type).toBe('button')
    expect(start().findByType('svg').props['aria-hidden']).toBe('true')
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

  it('deduplicates repeated clicks while pending and retries the exact request after a lease failure', async () => {
    let reject!: (error: Error) => void
    api.request.mockImplementation((path) => path.includes('/creation-requests/') ? Promise.resolve({ created: null }) : path === '/v1/agents/creation-models' ? Promise.resolve(modelOptions) : new Promise((_resolve, no) => { reject = no }))
    const onOpen = vi.fn(), onClose = vi.fn()
    await act(async () => { renderer = create(createElement(RoomNewChat, { onClose, onOpen, onAgent: vi.fn() })) })
    const chat = renderer.root.findAllByType('button').find((item) => item.children.includes('Define in chat'))!
    await act(async () => chat.props.onClick())
    await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: modelKey } }))
    const proceed = renderer.root.findAllByType('button').find((item) => item.children.includes('Continue'))!
    act(() => { proceed.props.onClick(); proceed.props.onClick() })
    expect(api.request.mock.calls.filter(([path]) => path === '/v1/agents/quick-create')).toHaveLength(1)
    expect(renderer.root.findByProps({ className: 'direct-creation-model' }).props['aria-busy']).toBe(true)
    await act(async () => reject(new Error('room coordinator lease is not held')))
    expect(onClose).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ role: 'alert' }).findByType('p').props.children)
      .toBe('The conversation service is starting or reconnecting. Wait a moment, then retry.')
    const id = api.request.mock.calls.find(([path]) => path === '/v1/agents/quick-create')![2].clientRequestId
    api.request.mockResolvedValue({ roomId: 'room-1' })
    await act(async () => renderer.root.findAllByType('button').find((item) => item.children.includes('Retry request'))!.props.onClick())
    const commits = api.request.mock.calls.filter(([path]) => path === '/v1/agents/quick-create')
    expect(commits).toHaveLength(2)
    expect(commits[1][2].clientRequestId).toBe(id)
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each(['synchronous', 'asynchronous'])('keeps %s Agent-open errors recoverable', async (failure) => {
    const onAgent = vi.fn().mockImplementationOnce(() => {
      if (failure === 'asynchronous') return Promise.reject(new Error('Connection unavailable'))
      throw new Error('Connection unavailable')
    }).mockResolvedValue(undefined)
    const onClose = vi.fn()
    await act(async () => { renderer = create(createElement(RoomNewChat, { onClose, onOpen: vi.fn(), onAgent })) })
    const developer = renderer.root.findAllByType('button').find((item) =>
      item.findAllByType('strong').some((label) => label.props.children === 'Developer'))!
    await act(async () => developer.props.onClick())
    expect(renderer.root.findByProps({ role: 'alert' }).findByType('p').props.children).toBe('Connection unavailable')
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => renderer.root.findByProps({ role: 'alert' }).findByType('button').props.onClick())
    expect(onAgent).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not reopen a conversation after its picker is unmounted', async () => {
    let resolve!: (value: { roomId: string }) => void
    api.request.mockImplementation((path) => path === '/v1/agents/creation-models' ? Promise.resolve(modelOptions) : new Promise((yes) => { resolve = yes }))
    const onOpen = vi.fn(), onClose = vi.fn()
    await act(async () => { renderer = create(createElement(RoomNewChat, { onClose, onOpen, onAgent: vi.fn() })) })
    await act(async () => renderer.root.findAllByType('button').find((item) => item.children.includes('Define in chat'))!.props.onClick())
    await chooseAndContinue()
    act(() => renderer.unmount())
    await act(async () => resolve({ roomId: 'room-1' }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
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
