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

const BINDINGS_STORAGE_KEY = 'kun.paper-assistant-thread-bindings.v1'

function storedThreadId(key: string): string | null {
  try {
    const bindings: unknown = JSON.parse(localStorage.getItem(BINDINGS_STORAGE_KEY) ?? '{}')
    if (!bindings || typeof bindings !== 'object') return null
    const id = (bindings as Record<string, unknown>)[key]
    return typeof id === 'string' && id.trim() ? id : null
  } catch { return null }
}

function persistThreadId(key: string, threadId: string | null): void {
  let bindings: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BINDINGS_STORAGE_KEY) ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) bindings = parsed as Record<string, unknown>
  } catch { /* Replace malformed binding data, not drafts or attachments. */ }
  if (threadId) bindings[key] = threadId
  else delete bindings[key]
  localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(bindings))
}

export function paperAssistantSession(key: string): PaperAssistantSession {
  return usePaperAssistantStore.getState().sessions[key] ?? { ...EMPTY_PAPER_ASSISTANT, threadId: storedThreadId(key) }
}

export function patchPaperAssistant(key: string, patch: Partial<PaperAssistantSession>): void {
  if (patch.threadId !== undefined) persistThreadId(key, patch.threadId)
  const previous = paperAssistantSession(key)
  usePaperAssistantStore.setState((state) => ({
    sessions: { ...state.sessions, [key]: { ...previous, ...patch } }
  }))
}

export function quoteForPaperAssistant(key: string, quote: string): void {
  const { input } = paperAssistantSession(key)
  patchPaperAssistant(key, { input: input.trim() ? `${input}\n\n${quote}` : quote, layout: 'assistant' })
}
