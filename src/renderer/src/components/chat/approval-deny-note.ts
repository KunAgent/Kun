import { useChatStore } from '../../store/chat-store'

/**
 * Approval decisions carry no free text, so a "decline, and here is what to
 * do instead" note travels as a normal follow-up message: queued behind the
 * running turn, then steered into it when the runtime accepts guidance.
 * If steering is unavailable the note simply stays queued for the next turn.
 */
export async function sendApprovalDenyNote(note: string): Promise<void> {
  const text = note.trim()
  if (!text) return
  const store = useChatStore.getState()
  const before = new Set(store.queuedMessages.map((message) => message.id))
  if (!await store.sendMessage(text)) return
  const queued = useChatStore.getState().queuedMessages
    .find((message) => !before.has(message.id) && message.text === text)
  if (queued && useChatStore.getState().busy) await useChatStore.getState().guideQueuedMessage(queued.id)
}
