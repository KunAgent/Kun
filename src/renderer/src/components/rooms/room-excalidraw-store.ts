import { create } from 'zustand'

export type RoomExcalidrawBoard = {
  roomId: string
  boardId: string
  workspaceRoot: string
  title?: string
}

type RoomExcalidrawState = {
  boardsByRoom: Record<string, RoomExcalidrawBoard[]>
  open: { roomId: string; boardId: string } | null
  registerBoard: (board: RoomExcalidrawBoard) => void
  openBoard: (roomId: string, boardId: string) => void
  closeBoard: () => void
}

/**
 * Lightweight per-room Excalidraw board registry. Boards are derived from the
 * host-resolved tool results and image references; the physical scene stays at
 * .kun-whiteboards/<boardId>/excalidraw.json under the agent workspace.
 */
export const useRoomExcalidrawStore = create<RoomExcalidrawState>((set) => ({
  boardsByRoom: {},
  open: null,
  registerBoard: (board) =>
    set((state) => {
      const list = state.boardsByRoom[board.roomId] ?? []
      const index = list.findIndex((item) => item.boardId === board.boardId)
      const next =
        index >= 0
          ? list.map((item, position) => (position === index ? { ...item, ...board } : item))
          : [...list, board]
      return { boardsByRoom: { ...state.boardsByRoom, [board.roomId]: next } }
    }),
  openBoard: (roomId, boardId) => set({ open: { roomId, boardId } }),
  closeBoard: () => set({ open: null })
}))

export function roomExcalidrawBoard(roomId: string, boardId: string): RoomExcalidrawBoard | undefined {
  const list = useRoomExcalidrawStore.getState().boardsByRoom[roomId] ?? []
  return list.find((item) => item.boardId === boardId)
}
