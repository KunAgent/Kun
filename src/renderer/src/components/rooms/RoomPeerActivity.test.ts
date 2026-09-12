import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomPeerTopicSummary } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomPeerActivity, RoomPeerSummary } from './RoomPeerActivity'
import { RoomDetailsDrawer } from './RoomDetailsDrawer'
import { RoomSettings } from './RoomSettings'

const api = vi.hoisted(() => ({ stop: vi.fn(), presets: vi.fn() }))
vi.mock('./rooms-client', async (original) => ({
  ...(await original<typeof import('./rooms-client')>()),
  roomsClient: { stopTopic: api.stop, presets: api.presets }
}))
const room = {
  id: 'room',
  collaborationMode: 'peer',
  members: [
    { id: 'dev', displayName: 'Developer', enabled: true },
    { id: 'review', displayName: 'Reviewer', enabled: true }
  ],
  repositories: []
} as unknown as Room
const topic = {
  roomId: 'room',
  rootRequestId: 'topic',
  revision: 7,
  title: 'Review architecture',
  status: 'active',
  responseCount: 13,
  triageCount: 5,
  pendingCount: 2,
  members: [
    {
      memberId: 'dev',
      state: 'responding',
      responseCount: 3,
      pendingCount: 2,
      invitedByMemberId: 'review'
    }
  ]
} as unknown as RoomPeerTopicSummary

describe('Peer discussion controls', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.stop.mockReset().mockRejectedValue(new Error('Connection lost'))
    api.presets.mockReset().mockResolvedValue({ presets: [] })
    vi.stubGlobal('document', { activeElement: null })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
    vi.unstubAllGlobals()
  })
  const button = (label: string) =>
    renderer.root
      .findAllByType('button')
      .find((node) => node.children.includes(label))!
  it('uses runtime counters and member activity, and retries only the topic stop with the same identity', async () => {
    const onContinue = vi.fn(),
      onUpdated = vi.fn()
    await act(async () => {
      renderer = create(
        createElement(RoomPeerActivity, {
          room,
          topics: [topic],
          loading: false,
          error: '',
          nextCursor: null,
          moreBusy: false,
          loadMore: vi.fn(),
          onUpdated,
          onContinue
        })
      )
    })
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('19')
    expect(text).toContain('123')
    expect(text).toContain('5 / 8 responses left')
    expect(text).toContain('Invited by Reviewer')
    await act(async () => button('Stop discussion').props.onClick())
    expect(api.stop).toHaveBeenCalledWith(topic, expect.any(String))
    await act(async () => button('Stop discussion').props.onClick())
    expect(api.stop.mock.calls[1][1]).toBe(api.stop.mock.calls[0][1])
    expect(onUpdated).not.toHaveBeenCalled()
    act(() => button('Continue topic').props.onClick())
    expect(onContinue).toHaveBeenCalledWith('topic')
  })
  it('never offers a second stop for an already stopped topic', async () => {
    await act(async () => {
      renderer = create(
        createElement(RoomPeerActivity, {
          room,
          topics: [
            { ...topic, status: 'stopped', pauseReason: 'user_stopped' }
          ],
          loading: false,
          error: '',
          nextCursor: null,
          moreBusy: false,
          loadMore: vi.fn(),
          onUpdated: vi.fn(),
          onContinue: vi.fn()
        })
      )
    })
    expect(button('Stop discussion')).toBeUndefined()
    expect(JSON.stringify(renderer.toJSON())).toContain('Stopped by you')
  })
  it('shows a quiet empty summary without inventing members or available budget', async () => {
    await act(async () => {
      renderer = create(
        createElement(RoomPeerSummary, {
          topics: [],
          loading: false,
          onOpen: vi.fn()
        })
      )
    })
    expect(JSON.stringify(renderer.toJSON())).toContain('Discussion is quiet')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('32')
  })
  it('does not turn retained stopped or paused inboxes into active pending work', async () => {
    await act(async () => {
      renderer = create(
        createElement(RoomPeerSummary, {
          topics: [
            { ...topic, status: 'stopped' },
            { ...topic, rootRequestId: 'paused', status: 'paused' }
          ],
          loading: false,
          onOpen: vi.fn()
        })
      )
    })
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('2 paused or stopped topics')
    expect(text).not.toContain('pending events')
    expect(text).not.toContain('responding or considering')
  })
  it('separates active work from stopping topics and unavailable members', async () => {
    await act(async () => {
      renderer = create(
        createElement(RoomPeerSummary, {
          topics: [
            topic,
            { ...topic, rootRequestId: 'stopping', status: 'stopping' },
            {
              ...topic,
              rootRequestId: 'blocked',
              status: 'idle',
              members: [
                {
                  ...topic.members[0],
                  state: 'pending',
                  waitingReason: 'member_unavailable'
                }
              ]
            }
          ],
          loading: false,
          onOpen: vi.fn()
        })
      )
    })
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('1 responding or considering · 2 pending events')
    expect(text).toContain('1 discussions stopping')
    expect(text).toContain('1 members blocked')
  })
  it('returns from an embedded task within one drawer and closes on Escape', async () => {
    const onBack = vi.fn(),
      onClose = vi.fn()
    await act(async () => {
      renderer = create(
        createElement(RoomDetailsDrawer, {
          section: 'tasks',
          onSection: vi.fn(),
          onClose,
          taskOpen: true,
          onBack,
          children: createElement('p', null, 'Task content')
        })
      )
    })
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
    act(() =>
      renderer.root
        .findByProps({ 'aria-label': 'Back to tasks' })
        .props.onClick()
    )
    expect(onBack).toHaveBeenCalledOnce()
    act(() =>
      renderer.root
        .findByType('aside')
        .props.onKeyDown({ key: 'Escape', stopPropagation: vi.fn() })
    )
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('defaults new rooms to peer and exposes all three collaboration modes', async () => {
    await act(async () => {
      renderer = create(
        createElement(RoomSettings, {
          room: null,
          onClose: vi.fn(),
          onSaved: vi.fn()
        })
      )
    })
    const mode = renderer.root.findByProps({ 'aria-label': 'Collaboration' })
    expect(mode).toBeDefined()
    expect(
      mode.findAllByType('option').map((option) => option.props.value)
    ).toEqual(['peer', 'autonomous', 'directed'])
  })
})
