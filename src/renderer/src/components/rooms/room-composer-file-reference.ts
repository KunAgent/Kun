import type { Room, RoomContentReference } from '@shared/rooms-api'
import type { ChatFileTreeReference } from '../chat/ChatFileTreePanel'
import { owningComposerWorkspaceRoot, relativeWorkspacePath } from '../../lib/composer-file-references'

export type RoomFileReferenceDetail = {
  roomId: string
  reference: ChatFileTreeReference
  workspace?: { id: string; path: string }
}

export function roomComposerFileReference(room: Room, detail: RoomFileReferenceDetail): RoomContentReference | null {
  if (detail.roomId !== room.id || detail.reference.type !== 'file') return null
  const { path, name } = detail.reference
  if (room.conversationKind === 'user_agent') {
    const workspace = detail.workspace
    if (!workspace || !owningComposerWorkspaceRoot(path, [workspace.path])) return null
    const relativePath = relativeWorkspacePath(path, workspace.path)
    if (!relativePath || relativePath.split('/').some((part) => part === '..')) return null
    return { kind: 'agent_file', workspaceId: workspace.id, relativePath, titleSnapshot: name }
  }
  const roots = room.repositories.map((repository) => repository.canonicalRoot)
  const root = owningComposerWorkspaceRoot(path, roots)
  const repository = room.repositories.find((entry) => entry.canonicalRoot === root)
  if (!repository) return null
  const relativePath = relativeWorkspacePath(path, root)
  if (!relativePath || relativePath.split('/').some((part) => part === '..')) return null
  return { kind: 'repository_file', repositoryId: repository.id, relativePath, titleSnapshot: name }
}
