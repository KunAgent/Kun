import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomMember, RoomMessage } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomTimeline } from './RoomTimeline'
import { RoomAvatar, RoomAvatarGroup } from './RoomAvatar'
import { RoomMessageRunButton } from './RoomMessageRunButton'

const api = vi.hoisted(() => ({
  request: vi.fn(),
  scrollToIndex: vi.fn(),
  measureElement: vi.fn()
}))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsRequest: api.request
}))
vi.mock('./RoomMessageBody', () => ({
  RoomMessageBody: ({ body }: { body: string }) => createElement('p', {}, body)
}))
vi.mock('./RoomMessageInteractions', () => ({ RoomMessageInteractions: () => null }))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 3) }, (_, index) => ({
        key: index,
        index,
        start: index * 160,
        end: (index + 1) * 160
      })),
    getTotalSize: () => count * 160,
    scrollToIndex: api.scrollToIndex,
    measureElement: api.measureElement
  })
}))
const member = {
  id: 'developer-a',
  displayName: 'Renamed developer',
  role: 'developer',
  enabled: true
} as RoomMember
const room = { id: 'room', members: [member] } as Room
const message = (
  id: string,
  seq = 1,
  extra: Partial<RoomMessage> = {}
): RoomMessage => ({
  id,
  roomId: 'room',
  authorKind: 'member',
  authorMemberId: member.id,
  authorLabelSnapshot: 'Original developer',
  body: `Message ${id}`,
  messageSeq: seq,
  bodyRevision: 0,
  mentionMemberIds: [],
  attachmentIds: [],
  createdAt: '2026-09-13T10:00:00Z',
  ...extra
})

describe('RoomTimeline conversation interactions', () => {
  let renderer: ReactTestRenderer
  let scroller: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
  }
  const storage = new Map<string, string>()
  const scrollIntoView = vi.fn()
  const focus = vi.fn()
  const onPin = vi.fn()
  const onTask = vi.fn()
  const onMember = vi.fn()
  const dispatchEvent = vi.fn()
  const hasFocus = vi.fn()
  let props: Parameters<typeof RoomTimeline>[0]

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    storage.clear()
    api.request
      .mockReset()
      .mockImplementation(
        async (_path: string, method?: string, body?: { seq: number }) =>
          method === 'POST' ? { seq: body?.seq } : {}
      )
    vi.clearAllMocks()
    hasFocus.mockReturnValue(true)
    scroller = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 }
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value)
      },
      dispatchEvent
    })
    vi.stubGlobal('document', {
      hasFocus,
      activeElement: { focus, isConnected: true },
      getElementById: () => ({ scrollIntoView })
    })
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
    props = {
      room,
      messages: [message('one')],
      tasks: [],
      cursor: null,
      moreBusy: false,
      loadEarlier: vi.fn().mockResolvedValue(undefined),
      onPin,
      onTask,
      onMember,
      jumpMessageId: null,
      onJumped: vi.fn()
    }
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
    renderer = undefined!
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const render = async (changes: Partial<typeof props> = {}) => {
    props = { ...props, ...changes }
    await act(async () => {
      if (renderer) renderer.update(createElement(RoomTimeline, props))
      else
        renderer = create(createElement(RoomTimeline, props), {
          createNodeMock: (element) => {
            if ((element.props as { className?: string }).className === 'rooms-timeline-scroll')
              return scroller
            return { focus, isConnected: true, querySelectorAll: () => [] }
          }
        })
    })
  }
  const button = (label: string) =>
    renderer.root
      .findAllByType('button')
      .find(
        (item) =>
          item.props['aria-label'] === label || item.children.includes(label)
      )!
  const scroll = (top: number) =>
    act(() => {
      scroller.scrollTop = top
      renderer.root
        .findByProps({ className: 'rooms-timeline-scroll' })
        .props.onScroll({ currentTarget: scroller })
    })

  it('keeps historical author names and routes avatar and message actions to stable IDs', async () => {
    await render({ messages: [message('one', 1, { rootRequestId: 'topic' })] })
    expect(
      renderer.root
        .findAllByType('strong')
        .some((item) => item.children.includes('Original developer'))
    ).toBe(true)
    expect(
      renderer.root
        .findAllByType('strong')
        .some((item) => item.children.includes('Renamed developer'))
    ).toBe(false)
    act(() => button('Original developer').props.onClick())
    expect(onMember).toHaveBeenCalledWith(member.id, 'topic')
    await act(async () => button('Copy message').props.onClick())
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Message one')
    act(() => button('Pin as project agreement').props.onClick())
    expect(onPin).toHaveBeenCalledWith(props.messages[0])
    act(() => button('Reply').props.onClick())
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          roomId: 'room',
          messageId: 'one',
          body: 'Message one'
        })
      })
    )
  })

  it('does not pull a reader away from history or mark incoming messages read until returning to latest', async () => {
    await render()
    scroll(150)
    api.request.mockClear()
    scroller.scrollHeight = 1200
    await render({ messages: [message('one'), message('two', 2)] })
    expect(scroller.scrollTop).toBe(150)
    expect(api.request).not.toHaveBeenCalled()
    await act(async () => button('Back to latest messages').props.onClick())
    expect(scroller.scrollTop).toBe(1200)
    expect(api.request).toHaveBeenCalledWith(
      '/v1/rooms/room/read',
      'POST',
      expect.objectContaining({ seq: 2 })
    )
  })
  it('keeps task notices task-linked while exposing only actual or resolvable reply runs', async () => {
    const onRun = vi.fn()
    await render({ onRun, messages: [
      message('queued-task', 1, { taskId: 'task', body: 'Queued' }),
      message('review-task', 2, { taskId: 'task', body: 'Review complete, awaiting acceptance' }),
      message('progress-task-2-status', 3, { taskId: 'task' }),
      message('progress-task-02', 4, { taskId: 'task' }),
      message('progress-task-2', 5, { taskId: 'task' }),
      message('recorded-task-reply', 6, { taskId: 'task', originRunId: 'exact-run' }),
      message('ordinary-historical-reply', 7)
    ] })
    const article = (id: string) => renderer.root.findByProps({ id: 'room-message-' + id })
    for (const id of ['queued-task', 'review-task', 'progress-task-2-status', 'progress-task-02']) {
      expect(article(id).findAllByType(RoomMessageRunButton)).toHaveLength(0)
      act(() => article(id).findByProps({ className: 'rooms-message-task' }).props.onClick())
    }
    expect(onTask.mock.calls).toEqual([['task'], ['task'], ['task'], ['task']])
    expect(article('ordinary-historical-reply').findAllByType(RoomMessageRunButton)).toHaveLength(1)
    api.request.mockClear().mockResolvedValue({ runId: 'historical-progress-run' })
    await act(async () => article('progress-task-2').findByType(RoomMessageRunButton).findByType('button').props.onClick())
    expect(api.request).toHaveBeenCalledWith('/v1/rooms/room/messages/progress-task-2/run', 'GET', undefined, expect.any(AbortSignal))
    expect(onRun).toHaveBeenCalledWith('historical-progress-run')
    act(() => article('recorded-task-reply').findByType(RoomMessageRunButton).findByType('button').props.onClick())
    expect(onRun).toHaveBeenLastCalledWith('exact-run')
    expect(api.request).toHaveBeenCalledTimes(1)
  })

  it('preserves the prepend anchor across the loading render and restores it when history arrives', async () => {
    await render({ cursor: 'older' })
    scroll(180)
    act(() => button('Load earlier messages').props.onClick())
    await render({ moreBusy: true })
    expect(scroller.scrollTop).toBe(180)
    scroller.scrollHeight = 1350
    await render({
      moreBusy: false,
      messages: [message('earlier'), message('one', 2)]
    })
    expect(scroller.scrollTop).toBe(530)
  })

  it('hides search by default, debounces queries, keeps results unread and restores the reading position on close', async () => {
    await render()
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    scroll(150)
    vi.useFakeTimers()
    api.request.mockImplementation(async (path: string) =>
      path.includes('/search') ? { messages: [message('match', 9)] } : {}
    )
    await render({ searchOpen: true })
    api.request.mockClear()
    act(() =>
      renderer.root
        .findByType('input')
        .props.onChange({ target: { value: 'match' } })
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(api.request).toHaveBeenCalledWith(
      '/v1/rooms/room/search?q=match',
      'GET',
      undefined,
      expect.any(AbortSignal)
    )
    expect(
      api.request.mock.calls.every((call) => !call[0].endsWith('/read'))
    ).toBe(true)
    scroller.scrollTop = 0
    await render({ searchOpen: false })
    expect(scroller.scrollTop).toBe(150)
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    expect(focus).toHaveBeenCalled()
  })

  it('jumps to loaded reply targets and loads historical references without replaying history', async () => {
    await render({
      messages: [message('one'), message('two', 2, { replyToMessageId: 'one' })]
    })
    act(() => button('View original message').props.onClick())
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    api.request.mockResolvedValue({
      message: message('archived', 1, {
        authorMemberId: 'removed',
        authorLabelSnapshot: 'Former member'
      })
    })
    await render({
      messages: [message('two', 2, { replyToMessageId: 'archived' })]
    })
    await act(async () => button('View original message').props.onClick())
    expect(api.request).toHaveBeenLastCalledWith(
      '/v1/rooms/room/messages/archived'
    )
    const dialog = renderer.root.findByProps({ role: 'dialog' })
    expect(
      dialog
        .findAllByType('strong')
        .some((item) => item.children.includes('Former member'))
    ).toBe(true)
    expect(dialog.findAllByType(RoomAvatar)[0].props.onClick).toBeUndefined()
    act(() =>
      dialog.props.onKeyDown({ key: 'Escape', stopPropagation: vi.fn() })
    )
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  })

  it('uses virtual scrolling only above 40 messages and respects background-window read conditions', async () => {
    hasFocus.mockReturnValue(false)
    await render({
      messages: Array.from({ length: 40 }, (_, index) =>
        message(String(index), index + 1)
      )
    })
    expect(renderer.root.findAllByType('article')).toHaveLength(40)
    expect(api.request).not.toHaveBeenCalled()
    await render({
      messages: Array.from({ length: 41 }, (_, index) =>
        message(String(index), index + 1)
      ),
      jumpMessageId: '35'
    })
    expect(renderer.root.findAllByType('article')).toHaveLength(3)
    expect(api.scrollToIndex).toHaveBeenCalledWith(35, { align: 'center' })
    expect(props.onJumped).toHaveBeenCalled()
  })

  it('keeps same-role avatar identity stable after a rename and avoids nested interactive group buttons', async () => {
    await act(async () => {
      renderer = create(
        createElement(RoomAvatar, { member, label: 'Old name' })
      )
    })
    const tone = renderer.root.findByProps({ className: 'rooms-avatar' }).props
      .style['--rooms-avatar-tone']
    const portrait = renderer.root.findByProps({ className: 'rooms-avatar-art' })
      .props['data-avatar-id']
    act(() =>
      renderer.update(
        createElement(RoomAvatar, {
          member: { ...member, displayName: 'New name' },
          label: 'New name'
        })
      )
    )
    expect(
      renderer.root.findByProps({ className: 'rooms-avatar' }).props.style[
        '--rooms-avatar-tone'
      ]
    ).toBe(tone)
    expect(renderer.root.findByProps({ className: 'rooms-avatar-art' }).props[
      'data-avatar-id'
    ]).toBe(portrait)
    act(() =>
      renderer.update(
        createElement(RoomAvatarGroup, {
          members: [member, { ...member, id: 'developer-b' }],
          onClick: onMember
        })
      )
    )
    expect(renderer.root.findAllByType('button')).toHaveLength(1)
    expect(renderer.root.findAllByProps({ className: 'rooms-avatar-art' })).toHaveLength(2)
  })

  it('renders a custom room avatar instead of the member mosaic', async () => {
    await act(async () => {
      renderer = create(
        createElement(RoomAvatarGroup, {
          members: [member, { ...member, id: 'developer-b' }],
          avatar: { kind: 'builtin', id: 'explorer' },
          id: 'room-1',
          label: 'Team'
        })
      )
    })
    expect(renderer.root.findAllByProps({ className: 'rooms-avatar-art' })).toHaveLength(1)
    expect(renderer.root.findByProps({ 'data-avatar-id': 'explorer' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ className: 'rooms-avatar-group rooms-avatar-group-2' })).toHaveLength(0)
  })
})
