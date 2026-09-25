import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomMember } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomMemberDetails } from './RoomMemberDetails'

const api = vi.hoisted(() => ({
  presets: vi.fn(),
  update: vi.fn(),
  saveAgentModels: vi.fn(),
  models: {
    'agent-reviewer': {
      agent: {
        id: 'agent-reviewer',
        revision: 2,
        modelRef: { providerId: 'deepseek', model: 'deepseek-reasoner' },
        fastModelRef: { providerId: 'deepseek', model: 'deepseek-chat' }
      },
      inheritedMain: { providerId: 'deepseek', model: 'deepseek-chat' },
      main: { providerId: 'deepseek', model: 'deepseek-reasoner' }
    },
    'agent-developer': {
      agent: {
        id: 'agent-developer',
        revision: 1,
        modelRef: undefined as { providerId: string; model: string } | undefined
      },
      inheritedMain: { providerId: 'deepseek', model: 'deepseek-chat' },
      main: { providerId: 'deepseek', model: 'deepseek-chat' }
    }
  }
}))

vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsClient: { presets: api.presets, update: api.update }
}))
vi.mock('./agent-client', async (original) => ({
  ...(await original<typeof import('./agent-client')>()),
  saveAgentModels: (...args: unknown[]) => api.saveAgentModels(...args),
  useAgentResource: (path: string | null) => {
    const id = path?.includes('agent-reviewer')
      ? 'agent-reviewer'
      : path?.includes('agent-developer')
        ? 'agent-developer'
        : ''
    return {
      data: id ? api.models[id as keyof typeof api.models] : null,
      error: '',
      refresh: vi.fn()
    }
  }
}))
vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: { composerModelGroups: unknown[] }) => unknown) =>
    selector({
      composerModelGroups: [
        {
          providerId: 'deepseek',
          label: 'DeepSeek',
          modelIds: ['deepseek-chat', 'deepseek-reasoner']
        }
      ]
    })
}))
vi.mock('./RoomAvatar', () => ({ RoomAvatar: () => null }))
vi.mock('./RoomRunList', () => ({ RoomRunList: () => null }))

const reviewer = {
  id: 'reviewer',
  displayName: 'Reviewer',
  role: 'reviewer',
  presetId: 'code-reviewer',
  roleNotes: '',
  enabled: true,
  revision: 3,
  allowedRepositoryIds: [],
  participantAgentId: 'agent-reviewer',
  agentTitle: 'Independent review'
} as unknown as RoomMember

const developer = {
  id: 'developer',
  displayName: 'Developer',
  role: 'developer',
  presetId: 'general',
  roleNotes: '',
  enabled: true,
  revision: 1,
  allowedRepositoryIds: [],
  participantAgentId: 'agent-developer'
} as unknown as RoomMember

const groupRoom = {
  id: 'room-1',
  revision: 10,
  conversationKind: 'group',
  members: [reviewer, developer],
  repositories: []
} as unknown as Room

describe('RoomMemberDetails model override', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.presets.mockReset().mockResolvedValue({
      presets: [{ id: 'code-reviewer', name: 'Reviewer', model: 'deepseek-chat', providerId: 'deepseek' }],
      defaultModel: { model: 'deepseek-chat', providerId: 'deepseek' }
    })
    api.update.mockReset().mockResolvedValue({ room: groupRoom })
    api.saveAgentModels.mockReset().mockResolvedValue(api.models['agent-reviewer'])
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
  })

  const render = async (room: Room = groupRoom, onUpdated = vi.fn()) => {
    await act(async () => {
      renderer = create(
        createElement(RoomMemberDetails, {
          room,
          selectedMemberId: null,
          onUpdated
        })
      )
    })
    return onUpdated
  }

  const modelSelects = () =>
    renderer.root.findAllByProps({ 'aria-label': 'Member model' })

  it('saves the selected model on the agent and not as a room override', async () => {
    const onUpdated = await render()
    const next = { providerId: 'deepseek', model: 'deepseek-chat' }
    await act(async () => {
      modelSelects()[0].props.onChange({ target: { value: JSON.stringify(next) } })
    })
    expect(api.saveAgentModels).toHaveBeenCalledWith('agent-reviewer', {
      expectedRevision: 2,
      modelRef: next,
      fastModelRef: { providerId: 'deepseek', model: 'deepseek-chat' }
    })
    expect(api.update).not.toHaveBeenCalled()
    expect(onUpdated).toHaveBeenCalledOnce()
  })

  it('shows the agent private model instead of a leftover room override', async () => {
    const room = {
      ...groupRoom,
      members: [{ ...reviewer, modelRef: { providerId: 'deepseek', model: 'deepseek-chat' } }, developer]
    } as unknown as Room
    await render(room)
    expect(modelSelects()[0].props.value).toBe(
      JSON.stringify({ providerId: 'deepseek', model: 'deepseek-reasoner' })
    )
    expect(
      renderer.root.findAllByType('p').some((node) => node.children.includes('This room only'))
    ).toBe(false)
  })

  it('clears leftover room modelRef after saving the agent model', async () => {
    const room = {
      ...groupRoom,
      members: [{ ...reviewer, modelRef: { providerId: 'deepseek', model: 'deepseek-chat' } }, developer]
    } as unknown as Room
    await render(room)
    await act(async () => {
      modelSelects()[0].props.onChange({ target: { value: '' } })
    })
    expect(api.saveAgentModels).toHaveBeenCalledWith('agent-reviewer', {
      expectedRevision: 2,
      modelRef: null,
      fastModelRef: { providerId: 'deepseek', model: 'deepseek-chat' }
    })
    expect(api.update).toHaveBeenCalledOnce()
    expect(api.update.mock.calls[0][1].members[0]).toMatchObject({
      id: 'reviewer',
      modelRef: undefined,
      revision: 4
    })
  })

  it('disables every model select while a save is in flight', async () => {
    let finish: (value: unknown) => void = () => undefined
    api.saveAgentModels.mockImplementation(
      () => new Promise((resolve) => { finish = resolve })
    )
    await render()
    await act(async () => {
      modelSelects()[0].props.onChange({
        target: { value: JSON.stringify({ providerId: 'deepseek', model: 'deepseek-chat' }) }
      })
    })
    expect(modelSelects().every((select) => select.props.disabled)).toBe(true)
    await act(async () => { finish(api.models['agent-reviewer']) })
    expect(modelSelects().every((select) => select.props.disabled)).toBe(false)
  })

  it('does not render a writable model select in private chats', async () => {
    await render({ ...groupRoom, conversationKind: 'user_agent' } as Room)
    expect(modelSelects()).toHaveLength(0)
  })

  it('marks mentions-only members and leaves the others unmarked', async () => {
    const room = {
      ...groupRoom,
      members: [{ ...reviewer, attention: 'mentions' }, developer]
    } as unknown as Room
    await render(room)
    const texts = renderer.root.findAllByType('p').map((node) => node.children.join(''))
    expect(texts.filter((text) => text.includes('Mentions only'))).toHaveLength(1)
    expect(texts.some((text) => text.includes('Developer') && text.includes('Mentions only'))).toBe(false)
  })
})
