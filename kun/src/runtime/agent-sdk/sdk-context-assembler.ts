/**
 * Pure assembly of the per-turn context that kun injects into a subscription
 * (Claude Agent SDK) turn. The SDK owns the loop, but — unlike kun's native
 * loop — it does NOT see kun's conversation history, skill catalog, memories, or
 * mode instructions unless we feed them in. This module builds those pieces as
 * plain text so the runtime can splice them into the SDK prompt.
 *
 * Design: kun owns the canonical history, so every SDK turn is stateless from
 * kun's side — we replay the prior conversation as a transcript preamble each
 * turn instead of relying on the SDK's in-memory `resume` (which is lost on a
 * provider switch or runtime restart). All functions here are pure and
 * unit-tested; the runtime/factory do the impure data-loading and call these.
 */
import type { TurnItem } from '../../contracts/items.js'
import { buildSessionTranscript } from '../../loop/session-summary.js'

/** Default cap for the replayed history transcript (bytes). */
export const DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES = 48 * 1024

/**
 * Render the prior conversation (everything BEFORE the current turn) as a
 * compact transcript. The current turn's own items are excluded — the live user
 * text is sent separately as the request. Returns '' when there is no history.
 */
export function buildHistoryTranscript(
  items: readonly TurnItem[],
  currentTurnId: string,
  maxBytes: number = DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
): string {
  const priorItems = items.filter((item) => item.turnId !== currentTurnId)
  if (priorItems.length === 0) return ''
  return buildSessionTranscript(priorItems, maxBytes).trim()
}

export interface SdkPromptParts {
  /** Prior-conversation transcript ('' when none). */
  historyTranscript?: string
  /** The live user request text for this turn. */
  userText: string
  /** Trailing per-turn instruction blocks (skill catalog, memories, plan, ...). */
  instructionBlocks?: readonly string[]
}

/**
 * Compose the final SDK prompt text: prior conversation (as context) → operating
 * instructions → the live request last (most salient). Sections are omitted when
 * empty so a fresh, instruction-free turn collapses to just the user text (and
 * keeps the SDK prompt-cache friendly for the common case).
 */
export function composeSdkPromptText(parts: SdkPromptParts): string {
  const sections: string[] = []
  const transcript = parts.historyTranscript?.trim()
  if (transcript) {
    sections.push(
      [
        'Earlier conversation in this thread (context — continue it; do not restart):',
        '<prior_conversation>',
        transcript,
        '</prior_conversation>'
      ].join('\n')
    )
  }
  const blocks = (parts.instructionBlocks ?? []).map((b) => b.trim()).filter((b) => b.length > 0)
  if (blocks.length > 0) sections.push(blocks.join('\n\n'))
  const userText = parts.userText.trim()
  if (userText) {
    sections.push(transcript || blocks.length > 0 ? `Current request:\n${userText}` : userText)
  }
  return sections.join('\n\n')
}
