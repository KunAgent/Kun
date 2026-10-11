import { usePaperModeStore } from './paper-mode-store'
import type { PaperReadingPurpose } from './paper-reading-request'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** The purpose-shaped request, in the interface language, naming the paper. */
export function paperPurposePrompt(t: Translate, purpose: PaperReadingPurpose, title: string): string {
  return t(`paperAskPurpose_${purpose}`, { title })
}

/**
 * Reading for a purpose is one click: the request goes to the Work assistant
 * exactly like text typed in its composer, and the open paper travels with
 * it as context. Without a live composer the request lands in the input.
 */
export function askAssistantForPaperPurpose(input: {
  t: Translate
  purpose: PaperReadingPurpose
  title: string
}): boolean {
  const bridge = usePaperModeStore.getState().composerBridge
  if (!bridge) return false
  const prompt = paperPurposePrompt(input.t, input.purpose, input.title)
  if (bridge.submit) bridge.submit(prompt)
  else bridge.setInput(bridge.input.trim() ? `${bridge.input.trim()}\n\n${prompt}` : prompt)
  return true
}
