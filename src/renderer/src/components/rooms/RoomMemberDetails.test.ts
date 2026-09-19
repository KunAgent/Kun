import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomMember } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomMemberDetails } from './RoomMemberDetails'

const api = vi.hoisted(() => ({
  presets: vi.fn(),
  update: vi.fn()
}))

vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsClient: { presets: api.presets, update: api.update }
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

  it('patches the selected member modelRef and bumps revision', async () => {
    const onUpdated = await render()
    const next = { providerId: 'deepseek', model: 'deepseek-reasoner' }
    await act(async () => {
      modelSelects()[0].props.onChange({ target: { value: JSON.stringify(next) } })
    })
    expect(api.update).toHaveBeenCalledWith(groupRoom, {
      members: [
        { ...reviewer, modelRef: next, revision: 4 },
        developer
      ]
    })
    expect(onUpdated).toHaveBeenCalledOnce()
  })

  it('clears modelRef when inheriting the profile default', async () => {
    const room = {
      ...groupRoom,
      members: [{ ...reviewer, modelRef: { providerId: 'deepseek', model: 'deepseek-reasoner' } }, developer]
    } as unknown as Room
    await render(room)
    expect(
      renderer.root.findAllByType('p').some((node) => node.children.includes('This room only'))
    ).toBe(true)
    await act(async () => {
      modelSelects()[0].props.onChange({ target: { value: '' } })
    })
    expect(api.update).toHaveBeenCalledOnce()
    expect(api.update.mock.calls[0][1].members[0]).toMatchObject({
      id: 'reviewer',
      modelRef: undefined,
      revision: 4
    })
    expect(api.update.mock.calls[0][1].members[1]).toEqual(developer)
  })

  it('disables every model select while a save is in flight', async () => {
    let finish: (value: { room: Room }) => void = () => undefined
    api.update.mockImplementation(
      () => new Promise<{ room: Room }>((resolve) => { finish = resolve })
    )
    await render()
    await act(async () => {
      modelSelects()[0].props.onChange({
        target: { value: JSON.stringify({ providerId: 'deepseek', model: 'deepseek-reasoner' }) }
      })
    })
    expect(modelSelects().every((select) => select.props.disabled)).toBe(true)
    await act(async () => { finish({ room: groupRoom }) })
    expect(modelSelects().every((select) => select.props.disabled)).toBe(false)
  })

  it('does not render a writable model select in private chats', async () => {
    await render({ ...groupRoom, conversationKind: 'user_agent' } as Room)
    expect(modelSelects()).toHaveLength(0)
  })
})
