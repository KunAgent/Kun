import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { otherUserInputAnswers, RoomChoiceCard } from './RoomChoiceCard'
import { RoomNewChat } from './RoomNewChat'
import type { RoomUserInput } from './rooms-client'

const api = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('./RoomModal', () => ({
  RoomModal: ({ title, children }: { title: string; children: unknown }) =>
    createElement('div', { 'data-room-modal': title }, children as never)
}))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsRequest: api.request,
  roomsClient: { create: vi.fn() }
}))
vi.mock('./agent-client', async (original) => ({
  ...(await original<typeof import('./agent-client')>()),
  useAgentCatalog: () => ({ agents: [], cursor: undefined, more: async () => undefined, busy: false, error: '' }),
  useAgentResource: () => ({ data: { templates: [] }, error: '', refresh: () => undefined })
}))

describe('new Agent dual-path setup UI', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.request.mockReset().mockResolvedValue({ roomId: 'room-1' })
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
    const option = renderer.root.findAllByType('button').find((item) => item.children.includes('Write docs'))!
    await act(async () => option.props.onClick())
    expect(api.request).toHaveBeenCalledWith('/v1/user-inputs/in_abc123', 'POST', {
      answers: [{ id: 'q1', label: 'Write docs', value: 'Write docs' }]
    })
    api.request.mockClear()
    await act(async () => {
      renderer.update(createElement(RoomChoiceCard, { input, onUpdated }))
    })
    await act(async () => {
      renderer.root.findByType('input').props.onChange({ target: { value: 'custom' } })
    })
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault: () => undefined }))
    expect(api.request).toHaveBeenCalledWith('/v1/user-inputs/in_abc123', 'POST', {
      answers: [{ id: 'q1', label: 'Other', value: 'custom' }]
    })
    api.request.mockClear()
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Dismiss question' }).props.onClick()
    })
    expect(api.request).toHaveBeenCalledWith('/v1/user-inputs/in_abc123', 'POST', { cancelled: true })
  })
})
