import { describe, expect, it } from 'vitest'
import type { Room } from '@shared/rooms-api'
import { roomMatchesSelectionScope, roomWorkbenchScopeKey } from './room-surface-selection'

describe('desktop room selection scopes', () => {
  it('lets Rooms host all conversations while the Code shortcut accepts only private chats', () => {
    for (const conversationKind of ['group', 'agent_agent', undefined] as const) {
      expect(roomMatchesSelectionScope({ conversationKind }, 'rooms')).toBe(true)
      expect(roomMatchesSelectionScope({ conversationKind }, 'private')).toBe(false)
    }
    expect(roomMatchesSelectionScope({ conversationKind: 'user_agent' }, 'rooms')).toBe(true)
    expect(roomMatchesSelectionScope({ conversationKind: 'user_agent' }, 'private')).toBe(true)
    expect(roomMatchesSelectionScope({ conversationKind: 'user_agent' }, 'all')).toBe(true)
  })

  it('invalidates private previews when the effective workspace or context epoch changes', () => {
    const room = { id: 'dm', conversationKind: 'user_agent', privateEpoch: 1 } as Room
    expect(roomWorkbenchScopeKey('dm', room)).not.toBe(roomWorkbenchScopeKey('dm', { ...room, privateEpoch: 2 }))
    expect(roomWorkbenchScopeKey('dm', room)).not.toBe(roomWorkbenchScopeKey('dm', { ...room, privateWorkspace: '/project' }))
    expect(roomWorkbenchScopeKey('other', room)).toBe('other')
  })

  it('invalidates group previews after removing a linked repository', () => {
    const room = { id: 'group', repositories: [{ canonicalRoot: '/repo', availability: 'available' }] } as Room
    expect(roomWorkbenchScopeKey('group', room)).not.toBe(roomWorkbenchScopeKey('group', { ...room, repositories: [] }))
    expect(roomWorkbenchScopeKey('', room)).toBeNull()
  })
})
