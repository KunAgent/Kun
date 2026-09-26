import { describe, expect, it } from 'vitest'
import type { RoomListEntry } from './rooms-client'
import { roomPreviewText } from './RoomList'

const room = { description: 'Repository discussion', members: [{ displayName: 'Developer' }] } as RoomListEntry
describe('room conversation previews', () => {
  it('uses the canonical message author and preview instead of the room description', () => {
    expect(roomPreviewText({ ...room, latestMessage: { id: 'message', authorKind: 'member',
      authorLabelSnapshot: 'Original member name', preview: 'Ready for review', attachmentCount: 0,
      createdAt: '2026-09-13T00:00:00Z' } }, () => '')).toBe('Original member name: Ready for review')
  })
  it('keeps old responses and empty rooms readable and localizes attachment-only messages', () => {
    expect(roomPreviewText(room, () => '')).toBe('Repository discussion')
    expect(roomPreviewText({ ...room, latestMessage: { id: 'attachment', authorKind: 'user',
      authorLabelSnapshot: 'You', preview: '', attachmentCount: 2, createdAt: '2026-09-13T00:00:00Z' }
    }, (count) => `${count} files`)).toBe('You: 2 files')
  })
})
