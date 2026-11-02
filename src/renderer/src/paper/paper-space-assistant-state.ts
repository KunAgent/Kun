import { create } from 'zustand'
import type { PaperReaderLayoutPreset } from './paper-reader-layout'

export type PaperSpaceImage = { dataBase64: string; name: string }
export type PaperAssistantSession = {
  model?: string
  providerId?: string
  threadId: string | null
  input: string
  images: readonly PaperSpaceImage[]
  layout: PaperReaderLayoutPreset
  sending: boolean
  error: string | null
}

export const EMPTY_PAPER_ASSISTANT: PaperAssistantSession = {
  threadId: null, input: '', images: [], layout: 'assistant', sending: false, error: null
}

/** Drafts and attachments belong to a source unit, never to the Work composer. */
export const usePaperAssistantStore = create<{ sessions: Record<string, PaperAssistantSession> }>(() => ({ sessions: {} }))

export function paperAssistantSession(key: string): PaperAssistantSession {
  return usePaperAssistantStore.getState().sessions[key] ?? EMPTY_PAPER_ASSISTANT
}

export function patchPaperAssistant(key: string, patch: Partial<PaperAssistantSession>): void {
  usePaperAssistantStore.setState((state) => ({
    sessions: { ...state.sessions, [key]: { ...(state.sessions[key] ?? EMPTY_PAPER_ASSISTANT), ...patch } }
  }))
}

export function quoteForPaperAssistant(key: string, quote: string): void {
  const { input } = paperAssistantSession(key)
  patchPaperAssistant(key, { input: input.trim() ? `${input}\n\n${quote}` : quote, layout: 'assistant' })
}
