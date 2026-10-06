import { useChatStore } from '../../store/chat-store'
import { readBrowserStorageItem, subscribeBrowserStorageMutations } from '../../lib/browser-storage'
import { roomsClient } from './rooms-client'

export type RoomNotificationTarget = { roomId?: string; messageId?: string; runId?: string }
const SELECTION_KEY = 'kun.agentChats.selected'

export function isFocusedRoomConversation(roomId: string): boolean {
  return useChatStore.getState().route === 'agent-chat' &&
    readBrowserStorageItem(SELECTION_KEY) === roomId && document.hasFocus()
}

/**
 * A native notification is an explicit navigation; later user navigation wins.
 * Private and group conversations both open inside Code.
 */
export function createRoomNotificationNavigator({ isStopped }: { isStopped: () => boolean }) {
  let serial = 0
  let disposePending: (() => void) | undefined
  const cancel = () => { serial++; disposePending?.(); disposePending = undefined }
  const open = async (target: RoomNotificationTarget): Promise<void> => {
    cancel()
    if (!target.roomId || isStopped()) return
    const currentSerial = serial
    const controller = new AbortController()
    const initialSelection = readBrowserStorageItem(SELECTION_KEY)
    const offRoute = useChatStore.subscribe((state, previous) => {
      if (state.route !== previous.route || state.activeThreadId !== previous.activeThreadId ||
        state.workspaceRoot !== previous.workspaceRoot) controller.abort()
    })
    const offStorage = subscribeBrowserStorageMutations(({ key }) => {
      if (key === SELECTION_KEY) controller.abort()
    })
    const dispose = () => { controller.abort(); offRoute(); offStorage() }
    disposePending = dispose
    const current = () => !controller.signal.aborted && !isStopped() && serial === currentSerial &&
      readBrowserStorageItem(SELECTION_KEY) === initialSelection
    try {
      const { room } = await roomsClient.get(target.roomId, controller.signal)
      if (!current() || room.deletedAt || room.id !== target.roomId) return
      // Keep Agent navigation out of the module cycle through agent-client.
      const { openAgentConversationRoom } = await import('./agent-chat-navigation')
      if (!current()) return
      offRoute(); offStorage()
      openAgentConversationRoom(room.id, target.runId || target.messageId
        ? { runId: target.runId, messageId: target.messageId } : undefined)
    } finally {
      dispose()
      if (disposePending === dispose) disposePending = undefined
    }
  }
  return { open, dispose: cancel }
}
