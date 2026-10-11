import { describe, expect, it } from 'vitest'
import type { Room } from '@shared/rooms-api'
import type { ChatFileTreeReference } from '../chat/ChatFileTreePanel'
import { roomComposerFileReference } from './room-composer-file-reference'

const reference = (path: string): ChatFileTreeReference => ({ path, name: 'notes.md', relativePath: 'notes.md', type: 'file', workspaceRoot: '/agent' })
describe('shared file references in a room composer', () => {
  it('binds private files to the authoritative Agent workspace identity', () => {
    const room = { id: 'dm', conversationKind: 'user_agent' } as Room
    expect(roomComposerFileReference(room, { roomId: 'dm', reference: reference('/agent/notes.md'),
      workspace: { id: 'owned', path: '/agent' } })).toEqual({ kind: 'agent_file', workspaceId: 'owned', relativePath: 'notes.md', titleSnapshot: 'notes.md' })
    expect(roomComposerFileReference(room, { roomId: 'other', reference: reference('/agent/notes.md') })).toBeNull()
    expect(roomComposerFileReference(room, { roomId: 'dm', reference: reference('/previous-code/notes.md'),
      workspace: { id: 'owned', path: '/agent' } })).toBeNull()
  })

  it('binds group files to the matching repository rather than the previous Code directory', () => {
    const room = { id: 'group', repositories: [{ id: 'repo', canonicalRoot: '/repo' }] } as Room
    expect(roomComposerFileReference(room, { roomId: 'group', reference: reference('/repo/docs/notes.md') }))
      .toEqual({ kind: 'repository_file', repositoryId: 'repo', relativePath: 'docs/notes.md', titleSnapshot: 'notes.md' })
    expect(roomComposerFileReference(room, { roomId: 'group', reference: reference('/repo/../foreign/notes.md') })).toBeNull()
  })
})
