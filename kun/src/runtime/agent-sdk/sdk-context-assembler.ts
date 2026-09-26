/**
 * Pure assembly of the per-turn context that kun injects into a subscription
 * (Claude Agent SDK) turn. The SDK owns the loop, but — unlike kun's native
 * loop — it does NOT see kun's conversation history, skill catalog, memories, or
 * mode instructions unless we feed them in. This module builds those pieces as
 * plain text so the runtime can splice them into the SDK prompt.
 *
 * Kun owns the canonical portable history. A provider-native session may carry
 * the ordinary next turn, while this bounded handoff is used to seed a new
 * native generation after a switch, compaction, import, or missing checkpoint.
 */
import type { TurnItem } from '../../contracts/items.js'
import { effectiveHistoryAfterLatestCompaction } from '../../loop/compaction-history.js'
import { buildSessionTranscript } from '../../loop/session-summary.js'
import { fitUtf8, utf8Bytes } from '../../handoff/utf8-budget.js'

export { fitUtf8, utf8Bytes } from '../../handoff/utf8-budget.js'

/** Default cap for the replayed history transcript (bytes). */
export const DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES = 48 * 1024
export const SDK_HISTORY_OMISSION_MARKER =
  '...[older history omitted to fit delegated context]'

type HistoryChunk = {
  text: string
  truncationSource?: string
}

/**
 * Render the prior conversation (everything BEFORE the current turn) as a
 * compact transcript. The current turn's own items are excluded — except its
 * durable internal goal context, which is model history rather than live user
 * input. The live user text is sent separately as the request. Returns '' when
 * there is no history.
 */
export function buildHistoryTranscript(
  items: readonly TurnItem[],
  currentTurnId: string,
  maxBytes: number = DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
): string {
  const priorItems = items.filter((item) =>
    item.turnId !== currentTurnId || item.kind === 'goal_context'
  )
  const effective = effectiveHistoryAfterLatestCompaction(priorItems)
  if (effective.length === 0) return ''

  const limit = Math.max(1_024, Math.floor(maxBytes))
  const summary = effective[0]?.kind === 'compaction' && effective[0].replacedTokens > 0
    ? effective[0]
    : undefined
  const chunks = completeHistoryChunks(summary ? effective.slice(1) : effective)
  const renderedSummary = summary ? renderChunk([summary]) : ''
  const markerReserve = utf8Bytes(SDK_HISTORY_OMISSION_MARKER) + 1
  const summaryWasTruncated = utf8Bytes(renderedSummary) > limit - markerReserve
  const summaryText = summaryWasTruncated
    ? fitUtf8(renderedSummary, Math.max(1, limit - markerReserve))
    : renderedSummary
  const selected: string[] = []
  let used = utf8Bytes(summaryText)
  let omitted = summaryWasTruncated

  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index]
    const separatorBytes = selected.length > 0 || summaryText ? 1 : 0
    if (used + separatorBytes + utf8Bytes(chunk.text) > limit) {
      omitted = true
      // Keep a contiguous newest-first tail. Skipping an oversized recent
      // exchange and then admitting older small messages would recreate the
      // long-session bug this handoff is meant to prevent.
      if (selected.length === 0 && chunk.truncationSource) {
        const available = limit - used - separatorBytes - markerReserve
        const recentTail = truncateRecentChunk(
          chunk.truncationSource,
          Math.max(0, available)
        )
        if (recentTail) {
          selected.unshift(recentTail)
          used += separatorBytes + utf8Bytes(recentTail)
        }
      }
      break
    }
    selected.unshift(chunk.text)
    used += separatorBytes + utf8Bytes(chunk.text)
  }

  const sections = [
    ...(summaryText ? [summaryText] : []),
    ...selected
  ]
  if (omitted) {
    const markerBytes = utf8Bytes(SDK_HISTORY_OMISSION_MARKER)
    const markerSeparator = sections.length > 0 ? 1 : 0
    while (
      sections.length > (summaryText ? 1 : 0) &&
      utf8Bytes(sections.join('\n')) + markerSeparator + markerBytes > limit
    ) {
      sections.splice(summaryText ? 1 : 0, 1)
    }
    const markerIndex = summaryText ? 1 : 0
    sections.splice(markerIndex, 0, SDK_HISTORY_OMISSION_MARKER)
  }
  return fitUtf8(sections.join('\n'), limit).trim()
}

function completeHistoryChunks(items: readonly TurnItem[]): HistoryChunk[] {
  const turnOrder: string[] = []
  const byTurn = new Map<string, TurnItem[]>()
  for (const item of items) {
    let turnItems = byTurn.get(item.turnId)
    if (!turnItems) {
      turnItems = []
      byTurn.set(item.turnId, turnItems)
      turnOrder.push(item.turnId)
    }
    turnItems.push(item)
  }
  const chunks: HistoryChunk[] = []
  for (const turnId of turnOrder) {
    const turnItems = byTurn.get(turnId) ?? []
    const resultByCall = new Map<string, Extract<TurnItem, { kind: 'tool_result' }>>()
    for (const item of turnItems) {
      if (item.kind === 'tool_result' && isTerminal(item)) resultByCall.set(item.callId, item)
    }
    const included: TurnItem[] = []
    let containsToolInteraction = false
    for (const item of turnItems) {
      if (!isTerminal(item) || item.kind === 'tool_result') continue
      if (item.kind === 'tool_call') {
        const result = resultByCall.get(item.callId)
        if (!result) continue
        containsToolInteraction = true
        included.push(item, result)
        continue
      }
      included.push(item)
    }
    const text = renderChunk(included)
    if (!text) continue
    const lastItem = included.at(-1)
    const truncationSource = !containsToolInteraction && lastItem
      ? renderChunk([lastItem])
      : ''
    chunks.push({
      text,
      ...(truncationSource ? { truncationSource } : {})
    })
  }
  return chunks
}

function isTerminal(item: TurnItem): boolean {
  return item.status === 'completed' || item.status === 'failed'
}

function renderChunk(items: readonly TurnItem[]): string {
  // Internal records are intentionally model-only. Keep them in the delegated
  // provider transcript without making generic session summaries expose them
  // to public clients.
  return items
    .map((item) => item.kind === 'goal_context'
      ? `[active goal] ${item.text.trim()}`
      : item.kind === 'interruption_note'
        ? `[interrupted task note] ${item.text.trim()}`
        : buildSessionTranscript([item], 16 * 1024 * 1024).trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim()
}

function truncateRecentChunk(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (utf8Bytes(text) <= maxBytes) return text
  const labelEnd = text.indexOf(']')
  const label = labelEnd >= 0 ? text.slice(0, labelEnd + 1) : '[recent history]'
  const separator = ' … '
  const contentBytes = maxBytes - utf8Bytes(label) - utf8Bytes(separator)
  if (contentBytes <= 0) return ''
  let out = ''
  let used = 0
  for (const char of [...text].reverse()) {
    const bytes = utf8Bytes(char)
    if (used + bytes > contentBytes) break
    out = char + out
    used += bytes
  }
  return `${label}${separator}${out}`
}

export interface SdkPromptParts {
  /** Prior-conversation transcript ('' when none). */
  historyTranscript?: string
  /**
   * Deterministic handoff brief (docs/ade/08). When set it replaces
   * `historyTranscript` — the brief already carries the prior-conversation
   * digest plus the recent originals.
   */
  handoffBrief?: string
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
  const handoff = parts.handoffBrief?.trim()
  const transcript = handoff ? undefined : parts.historyTranscript?.trim()
  if (handoff) {
    sections.push(handoff)
  } else if (transcript) {
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
    sections.push(handoff || transcript || blocks.length > 0 ? `Current request:\n${userText}` : userText)
  }
  return sections.join('\n\n')
}
