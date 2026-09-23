import { create } from 'zustand'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

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

const STORAGE_KEY = 'kun.rooms.excalidrawBoards.v1'
const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/

function loadBoards(): Record<string, RoomExcalidrawBoard[]> {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(STORAGE_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, RoomExcalidrawBoard[]> = {}
    for (const [roomId, value] of Object.entries(parsed)) {
      if (!BOARD_ID.test(roomId) || !Array.isArray(value)) continue
      const boards = value.filter((item): item is RoomExcalidrawBoard => Boolean(
        item && typeof item === 'object' &&
        BOARD_ID.test(String((item as RoomExcalidrawBoard).boardId ?? '')) &&
        (item as RoomExcalidrawBoard).roomId === roomId &&
        typeof (item as RoomExcalidrawBoard).workspaceRoot === 'string' &&
        (item as RoomExcalidrawBoard).workspaceRoot.trim()
      )).slice(-50)
      if (boards.length) result[roomId] = boards
    }
    return result
  } catch {
    return {}
  }
}

function persistBoards(value: Record<string, RoomExcalidrawBoard[]>): void {
  writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(value))
}

/**
 * Per-room Excalidraw registry derived only from host-resolved tool results and
 * verified image references. Persisting the binding restores edit/open affordances
 * after renderer restart; the canonical scene remains in the authorized workspace.
 */
export const useRoomExcalidrawStore = create<RoomExcalidrawState>((set) => ({
  boardsByRoom: loadBoards(),
  open: null,
  registerBoard: (board) =>
    set((state) => {
      const list = state.boardsByRoom[board.roomId] ?? []
      const index = list.findIndex((item) => item.boardId === board.boardId)
      const next = (index >= 0
        ? list.map((item, position) => (position === index ? { ...item, ...board } : item))
        : [...list, board]).slice(-50)
      const boardsByRoom = { ...state.boardsByRoom, [board.roomId]: next }
      persistBoards(boardsByRoom)
      return { boardsByRoom }
    }),
  openBoard: (roomId, boardId) => set({ open: { roomId, boardId } }),
  closeBoard: () => set({ open: null })
}))

export function roomExcalidrawBoard(roomId: string, boardId: string): RoomExcalidrawBoard | undefined {
  const list = useRoomExcalidrawStore.getState().boardsByRoom[roomId] ?? []
  return list.find((item) => item.boardId === boardId)
}
