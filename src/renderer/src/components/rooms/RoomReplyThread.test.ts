import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomMessage, RoomReplyPage, SendRoomMessage } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomReplyThread } from './RoomReplyThread'
import { RoomComposer } from './RoomComposer'
import { RoomMessageRow } from './RoomMessageRow'

const api = vi.hoisted(() => ({ request: vi.fn(), listeners: new Set<(event: { roomId: string; kind: string }) => void>() }))
vi.mock('./rooms-client', async (original) => ({ ...(await original<typeof import('./rooms-client')>()), roomsRequest: api.request }))
vi.mock('./useRoomEvents', () => ({ subscribeRoomEvents: (fn: (event: { roomId: string; kind: string }) => void) => { api.listeners.add(fn); return () => api.listeners.delete(fn) } }))
vi.mock('./RoomComposer', () => ({ RoomComposer: () => createElement('div', { 'data-reply-composer': true }) }))
vi.mock('./RoomMessageBody', () => ({ RoomMessageBody: ({ body }: { body: string }) => createElement('p', {}, body) }))
vi.mock('./RoomMessageInteractions', () => ({ RoomMessageInteractions: () => null }))

const room = { id: 'room', members: [{ id: 'member', displayName: 'Member', role: 'developer' }], repositories: [] } as unknown as Room
const message = (id: string, seq = 1, extra: Partial<RoomMessage> = {}): RoomMessage => ({ id, roomId: 'room',
  authorKind: 'member', authorMemberId: 'member', authorLabelSnapshot: 'Member', body: id,
  rootRequestId: 'topic', messageSeq: seq, bodyRevision: 0, mentionMemberIds: [], attachmentIds: [],
  createdAt: '2026-09-15T00:00:00Z', ...extra })
const root = message('root')
const first = message('first', 2, { replyToMessageId: 'root', displayThreadRootId: 'root' })
const nested = message('nested', 3, { replyToMessageId: 'first', displayThreadRootId: 'root' })
const page = (messages = [first, nested], extra: Partial<RoomReplyPage> = {}): RoomReplyPage => ({ root, messages, total: messages.length, ...extra })

describe('reply thread drawer', () => {
  let renderer: ReactTestRenderer | undefined
  const send = vi.fn(), onRun = vi.fn(), onMember = vi.fn(), onTask = vi.fn(), onOpenContent = vi.fn()
  let scroller: { scrollTop: number; scrollHeight: number; clientHeight: number; querySelector: ReturnType<typeof vi.fn> }
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.request.mockReset().mockResolvedValue(page())
    api.listeners.clear(); send.mockReset().mockResolvedValue(undefined)
    onRun.mockReset(); onMember.mockReset(); onTask.mockReset(); onOpenContent.mockReset()
    scroller = { scrollTop: 100, scrollHeight: 1000, clientHeight: 400, querySelector: vi.fn(() => ({ scrollIntoView: vi.fn() })) }
  })
  afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.useRealTimers() })
  const render = async (messageId = 'nested', active = true) => {
    const element = createElement(RoomReplyThread, { room, messageId, active, tasks: [], onSend: send,
      onPin: vi.fn(), onTask, onRun, onMember, onOpenContent })
    await act(async () => {
      if (renderer) renderer.update(element)
      else renderer = create(element, { createNodeMock: (node) => (node.props as { className?: string }).className === 'rooms-reply-scroll' ? scroller : null })
    })
  }
  const button = (text: string) => renderer!.root.findAllByType('button').find((value) => value.children.includes(text))!

  it('shows the host-resolved root plus flattened replies without sending or resetting the topic', async () => {
    await render()
    expect(renderer!.root.findAllByType(RoomMessageRow).map((value) => value.props.message.id)).toEqual(['root', 'first', 'nested'])
    const composer = renderer!.root.findByType(RoomComposer)
    expect(composer.props.draftId).toBe('reply:room:root')
    expect(composer.props.replyTarget).toMatchObject({ messageId: 'root', rootRequestId: 'topic' })
    expect(api.request).toHaveBeenCalledWith('/v1/rooms/room/replies/nested?limit=40', 'GET', undefined, expect.any(AbortSignal))
    expect(api.request.mock.calls.every((call) => call[1] === 'GET')).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps one independent draft while selecting a nested reply target and sends only after explicit submission', async () => {
    await render()
    const row = renderer!.root.findAllByType(RoomMessageRow).find((value) => value.props.message.id === 'nested')!
    act(() => row.props.onReply(nested))
    const composer = renderer!.root.findByType(RoomComposer)
    expect(composer.props.draftId).toBe('reply:room:root')
    expect(composer.props.replyTarget.messageId).toBe('nested')
    expect(send).not.toHaveBeenCalled()
    const input = { clientRequestId: 'send', body: 'Follow up', rootRequestId: 'topic', executionIntent: 'discussion', mentionMemberIds: [], attachmentIds: [] } as SendRoomMessage
    await act(async () => composer.props.onSend(input))
    expect(send).toHaveBeenCalledWith({ ...input, replyToMessageId: 'nested' })
  })

  it('routes replies to the shared composer callback instead of rendering an embedded composer', async () => {
    const reply = vi.fn()
    await act(async () => {
      renderer = create(createElement(RoomReplyThread, { room, messageId: 'nested', active: true, tasks: [], onSend: send,
        onReply: reply, onPin: vi.fn(), onTask, onRun, onMember, onOpenContent }),
        { createNodeMock: (node) => (node.props as { className?: string }).className === 'rooms-reply-scroll' ? scroller : null })
    })
    expect(renderer!.root.findAllByType(RoomComposer)).toHaveLength(0)
    const row = renderer!.root.findAllByType(RoomMessageRow).find((value) => value.props.message.id === 'nested')!
    act(() => row.props.onReply(nested))
    expect(reply).toHaveBeenCalledWith(nested)
    expect(send).not.toHaveBeenCalled()
  })

  it('preserves the prepend reading position and keeps reply records out of the main-feed DOM id namespace', async () => {
    api.request.mockResolvedValue(page([nested], { total: 2, nextCursor: 'older' }))
    await render()
    const ids = renderer!.root.findAllByType('article').map((node) => node.props.id)
    expect(ids.every((id) => id.startsWith('room-reply-') && !id.startsWith('room-message-'))).toBe(true)
    api.request.mockImplementation(async () => { scroller.scrollHeight = 1200; return page([first], { total: 2 }) })
    await act(async () => button('Load earlier messages').props.onClick())
    expect(scroller.scrollTop).toBe(300)
    expect(renderer!.root.findAllByType(RoomMessageRow).map((value) => value.props.message.id)).toEqual(['root', 'first', 'nested'])
  })

  it('ignores late responses from a previous drawer target and reports missing ancestry without offering a composer', async () => {
    let finish!: (value: RoomReplyPage) => void
    api.request.mockImplementation((path: string) => path.includes('/old?') ? new Promise((resolve) => { finish = resolve }) : Promise.resolve({ root: null, messages: [], total: 0, unavailableReason: 'missing_parent' }))
    await render('old')
    const previousSignal = api.request.mock.calls[0][3] as AbortSignal
    await render('broken')
    expect(previousSignal.aborted).toBe(true)
    await act(async () => finish(page()))
    expect(renderer!.root.findAllByType(RoomComposer)).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).toContain('An earlier message in this reply thread is unavailable.')
  })

  it('pauses the reply subscription under a nested detail and refreshes the same thread when returning', async () => {
    api.request.mockResolvedValue(page([]))
    await render()
    expect(api.listeners.size).toBe(1)
    await render('nested', false)
    expect(api.listeners.size).toBe(0)
    api.request.mockClear()
    api.request.mockResolvedValue(page([first], { total: 10, nextCursor: 'older' }))
    await render('nested', true)
    expect(api.listeners.size).toBe(1)
    expect(api.request).toHaveBeenCalledWith('/v1/rooms/room/replies/nested?limit=40', 'GET', undefined, expect.any(AbortSignal))
    expect(button('Load earlier messages')).toBeDefined()
  })

  it('forwards exact run, member and artifact identities from a reply without adding executions', async () => {
    await render()
    const row = renderer!.root.findAllByType(RoomMessageRow)[2]
    act(() => row.props.onRun('recorded-run'))
    act(() => row.props.onMember('member', 'topic'))
    const reference = { kind: 'attachment', attachmentId: 'attachment' }
    act(() => row.props.onOpenContent(reference, 'nested'))
    expect(onRun).toHaveBeenCalledWith('recorded-run')
    expect(onMember).toHaveBeenCalledWith('member', 'topic')
    expect(onOpenContent).toHaveBeenCalledWith(reference, 'nested')
    expect(send).not.toHaveBeenCalled()
  })
})
