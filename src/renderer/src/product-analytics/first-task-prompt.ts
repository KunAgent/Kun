import { create } from 'zustand'
export const FIRST_TASK_PROMPT_EVENT = 'kun:first-task-prompt'
let pending: { threadId: string; text: string } | null = null
export function queueFirstTaskPrompt(threadId: string, text: string) {
  pending = { threadId, text }; window.dispatchEvent(new Event(FIRST_TASK_PROMPT_EVENT))
}
export function takeFirstTaskPrompt(threadId: string | null): string | null {
  if (!pending || pending.threadId !== threadId) return null
  const text = pending.text; pending = null; return text
}
export const useFirstRoomTask = create<{ requested: boolean }>(() => ({ requested: false }))
