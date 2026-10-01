import { useChatStore } from '../../store/chat-store'
import { readBrowserStorageItem, subscribeBrowserStorageMutations, writeBrowserStorageItem } from '../../lib/browser-storage'
import { roomsClient } from './rooms-client'

export type RoomNotificationTarget = { roomId?: string; messageId?: string; runId?: string }
const SELECTION_KEYS = ['kun.rooms.selected', 'kun.agentChats.selected']

export function isFocusedRoomConversation(roomId: string): boolean {
  const route = useChatStore.getState().route
  const key = route === 'rooms' ? SELECTION_KEYS[0] : route === 'agent-chat' ? SELECTION_KEYS[1] : null
  return Boolean(key && readBrowserStorageItem(key) === roomId && document.hasFocus())
}

/** A native notification is an explicit navigation; later user navigation wins. */
export function createRoomNotificationNavigator({ onGroup, isStopped }: {
  onGroup: (roomId: string) => void
  isStopped: () => boolean
}) {
  let serial = 0
  let disposePending: (() => void) | undefined
  const cancel = () => { serial++; disposePending?.(); disposePending = undefined }
  const open = async (target: RoomNotificationTarget): Promise<void> => {
    cancel()
    if (!target.roomId || isStopped()) return
    const currentSerial = serial
    const controller = new AbortController()
    const stayInRooms = useChatStore.getState().route === 'rooms'
    const initialSelections = SELECTION_KEYS.map(readBrowserStorageItem)
    const offRoute = useChatStore.subscribe((state, previous) => {
      if (state.route !== previous.route || state.activeThreadId !== previous.activeThreadId ||
        state.workspaceRoot !== previous.workspaceRoot) controller.abort()
    })
    const offStorage = subscribeBrowserStorageMutations(({ key }) => {
      if (SELECTION_KEYS.includes(key)) controller.abort()
    })
    const dispose = () => { controller.abort(); offRoute(); offStorage() }
    disposePending = dispose
    const current = () => !controller.signal.aborted && !isStopped() && serial === currentSerial &&
      SELECTION_KEYS.every((key, index) => readBrowserStorageItem(key) === initialSelections[index])
    try {
      const { room } = await roomsClient.get(target.roomId, controller.signal)
      if (!current() || room.deletedAt || room.id !== target.roomId) return
      if (room.conversationKind === 'user_agent') {
        // Keep Agent navigation out of the module cycle through agent-client.
        const { openAgentConversationRoom, useAgentChatNavigationStore } = await import('./agent-chat-navigation')
        if (!current()) return
        offRoute(); offStorage()
        const navigationTarget = target.runId || target.messageId
          ? { runId: target.runId, messageId: target.messageId } : undefined
        if (stayInRooms) {
          useAgentChatNavigationStore.setState({ target: navigationTarget ? { roomId: room.id, ...navigationTarget } : null })
          writeBrowserStorageItem(SELECTION_KEYS[0], room.id)
          onGroup(room.id)
        } else openAgentConversationRoom(room.id, navigationTarget)
      } else {
        offRoute(); offStorage()
        writeBrowserStorageItem(SELECTION_KEYS[0], room.id)
        useChatStore.getState().setRoute('rooms')
        onGroup(room.id)
      }
    } finally {
      dispose()
      if (disposePending === dispose) disposePending = undefined
    }
  }
  return { open, dispose: cancel }
}
