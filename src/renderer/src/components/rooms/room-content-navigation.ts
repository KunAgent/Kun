import { create } from 'zustand'
import type { RoomContentOpenTarget } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { useProjectBoardStore } from '../../project-board/project-board-store'
import { projectBoardApi } from '../../project-board/project-board-api'
import type { ProjectBoardCard } from '../../project-board/project-board-types'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { useRoomExcalidrawStore } from './room-excalidraw-store'

export const useRoomBoardTarget = create<{ target: { workspaceRoot: string; cardId: string; card: ProjectBoardCard } | null }>(() => ({ target: null }))

export async function openRoomContentTarget(target: RoomContentOpenTarget,
  openThread: (id: string, turnId?: string) => void | Promise<void>,
  roomId?: string): Promise<void> {
  if (target.kind === 'thread') { await openThread(target.threadId, target.turnId); return }
  if (target.kind === 'excalidraw_board') {
    if (!roomId) throw new Error('Referenced room is unavailable')
    useRoomExcalidrawStore.getState().registerBoard({ roomId, boardId: target.boardId, workspaceRoot: target.workspaceRoot })
    useRoomExcalidrawStore.getState().openBoard(roomId, target.boardId)
    return
  }
  if (target.kind === 'board') {
    const result = await projectBoardApi.card(target.workspaceRoot, target.cardId)
    if (result.card.id !== target.cardId) throw new Error('Referenced board card is unavailable')
    useProjectBoardStore.getState().selectWorkspace(result.workspaceRoot)
    useRoomBoardTarget.setState({ target: { workspaceRoot: result.workspaceRoot, cardId: target.cardId, card: result.card } })
    useChatStore.getState().setRoute('board')
    return
  }
  const resolved = await window.kunGui.resolveWorkspaceFile({ path: target.relativePath, workspaceRoot: target.workspaceRoot })
  if (!resolved.ok) throw new Error(resolved.message)
  if (target.kind === 'work_file') {
    const write = useWriteWorkspaceStore.getState()
    await write.selectWriteWorkspace(target.workspaceRoot)
    await useWriteWorkspaceStore.getState().openFile(target.workspaceRoot, resolved.path)
    const selected = useWriteWorkspaceStore.getState()
    if (selected.fileError || selected.activeFilePath !== resolved.path) throw new Error(selected.fileError ?? 'Referenced document is unavailable')
    useChatStore.getState().setRoute('write')
    return
  }
  useChatStore.getState().setRoute('chat')
  previewWorkspaceFile({ path: resolved.path, workspaceRoot: target.workspaceRoot })
}
