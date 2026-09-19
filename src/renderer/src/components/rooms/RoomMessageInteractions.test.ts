import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomMessage, RoomPoll } from '@shared/rooms-api'
import { RoomMessageInteractions } from './RoomMessageInteractions'
import { RoomPollCard } from './RoomPollCard'
import i18n from '../../i18n'

const mocks = vi.hoisted(() => ({ request: vi.fn(), subscribe: vi.fn(), serial: 0 }))
vi.mock('./rooms-client', () => ({ roomsRequest: mocks.request, roomPath: (id: string) => '/v1/rooms/' + id,
  roomRequestId: () => 'request-' + ++mocks.serial }))
vi.mock('./useRoomEvents', () => ({ subscribeRoomEvents: mocks.subscribe }))
const room = { id: 'room', members: [{ id: 'developer', displayName: 'Developer', enabled: true }] } as Room
const message = { id: 'poll-message', roomId: 'room', pollId: 'poll', presentationKind: 'poll' } as RoomMessage
const poll: RoomPoll = { pollId: 'poll', roomId: 'room', messageId: 'poll-message', question: 'Which option?',
  options: [{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }], multiple: false, state: 'open',
  createdAt: '2026-01-01T00:00:00.000Z', revision: 0, ballots: {} }
let renderer: ReactTestRenderer
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); await i18n.changeLanguage('en'); mocks.request.mockReset(); mocks.subscribe.mockReset().mockReturnValue(() => {}); mocks.serial = 0 })
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })

describe('room message presentation interactions', () => {
  it('loads presentation only and changes the local reaction without sending chat or execution requests', async () => {
    mocks.request.mockResolvedValueOnce({ reactions: { roomId: 'room', messageId: 'poll-message', revision: 0, reactions: [{ emoji: '👍', count: 1, reacted: true }] }, poll })
    await act(async () => { renderer = create(createElement(RoomMessageInteractions, { room, message })) })
    expect(mocks.request.mock.calls.map((call) => call[1])).toEqual(['GET'])
    expect(renderer.root.findByType(RoomPollCard).props.poll.question).toBe('Which option?')
    mocks.request.mockResolvedValueOnce({ roomId: 'room', messageId: 'poll-message', revision: 1, reactions: [] })
    await act(async () => renderer.root.findByProps({ 'aria-pressed': true }).props.onClick())
    expect(mocks.request.mock.calls[1]).toMatchObject(['/v1/rooms/room/messages/poll-message/reactions', 'PUT', { emoji: '👍', active: false }])
    expect(mocks.request.mock.calls.some((call) => /\/turns|\/messages$/.test(call[0]))).toBe(false)
  })

  it('ignores a late load from the previous message after switching', async () => {
    let resolve!: (value: unknown) => void
    mocks.request.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    await act(async () => { renderer = create(createElement(RoomMessageInteractions, { room, message })) })
    mocks.request.mockResolvedValueOnce({ reactions: { roomId: 'room', messageId: 'other-message', revision: 0, reactions: [] } })
    await act(async () => renderer.update(createElement(RoomMessageInteractions, { room, message: { ...message, id: 'other-message', pollId: undefined } })))
    await act(async () => resolve({ reactions: { roomId: 'room', messageId: 'poll-message', revision: 0, reactions: [] }, poll }))
    expect(renderer.root.findAllByType(RoomPollCard)).toHaveLength(0)
    expect(mocks.request.mock.calls[0][3].aborted).toBe(true)
  })

  it('keeps editing a local ballot separate from an explicit submit and prevents voting after closure', async () => {
    const updated = vi.fn()
    await act(async () => { renderer = create(createElement(RoomPollCard, { room, poll, onUpdate: updated })) })
    expect(mocks.request).not.toHaveBeenCalled()
    act(() => renderer.root.findAllByProps({ type: 'radio' })[0].props.onChange())
    expect(mocks.request).not.toHaveBeenCalled()
    const result = { ...poll, revision: 1, ballots: { 'local-user': { optionIds: ['a'], updatedAt: poll.createdAt } } }
    mocks.request.mockResolvedValueOnce(result)
    const vote = renderer.root.findAllByType('button').find((node) => node.children.includes('Vote'))!
    await act(async () => vote.props.onClick())
    expect(mocks.request.mock.calls[0]).toMatchObject(['/v1/rooms/room/polls/poll/vote', 'PUT', { optionIds: ['a'] }])
    expect(updated).toHaveBeenCalledWith(result)
    await act(async () => renderer.update(createElement(RoomPollCard, { room, poll: { ...result, state: 'closed' }, onUpdate: updated })))
    expect(renderer.root.findAllByProps({ type: 'radio' }).every((node) => node.props.disabled)).toBe(true)
  })
})
