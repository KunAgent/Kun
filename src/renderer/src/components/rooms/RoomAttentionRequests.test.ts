import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '@shared/rooms-api'
import i18n from '../../i18n'
import { RoomAttentionRequests } from './RoomAttentionRequests'

const api = vi.hoisted(() => ({
  items: [] as Array<{ id: string; status: string; message: { body: string }; revision: number }>,
  refresh: vi.fn(async () => undefined)
}))
vi.mock('./useRoomPage', () => ({
  useRoomPage: () => ({
    items: api.items,
    nextCursor: undefined,
    loadMore: vi.fn(),
    busy: false,
    error: '',
    refresh: api.refresh
  })
}))
vi.mock('./RoomRequestControls', () => ({
  RoomRequestControls: ({ request }: { request: { id: string } }) =>
    createElement('button', null, 'Continue ' + request.id)
}))

const room = {
  id: 'room',
  members: [],
  repositories: []
} as unknown as Room

describe('RoomAttentionRequests', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.items = []
    api.refresh.mockReset()
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
  })
  it('shows the empty task copy only when there are no attention requests', async () => {
    await act(async () => {
      renderer = create(
        createElement(RoomAttentionRequests, { room, emptyTasks: true })
      )
    })
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'Tasks appear here when work is assigned.'
    )
    api.items = [
      {
        id: 'latest',
        status: 'needs_input',
        revision: 1,
        message: { body: 'Need a repository' }
      }
    ]
    await act(async () => {
      renderer.update(
        createElement(RoomAttentionRequests, { room, emptyTasks: true })
      )
    })
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Need a repository')
    expect(text).toContain('Continue latest')
    expect(text).toContain('Needs your input')
    expect(text).not.toContain('Tasks appear here when work is assigned.')
  })
})
