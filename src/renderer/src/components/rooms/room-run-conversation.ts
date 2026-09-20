import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { groupRoomRunItems } from './room-run-groups'

/**
 * Kinds that carry private runtime context rather than user-visible activity.
 * These stay excluded from the read-only transcript and from the visible
 * conversation stream, matching the Code timeline's disclosure rules.
 */
export const HIDDEN_RUN_KINDS = new Set([
  'model_context',
  'runtime_context_source',
  'goal_context',
  'interruption_note'
])

/** A tool call/result pair folded into a single chronological row. */
export type RoomRunToolEntry = {
  kind: 'tool'
  callId: string
  call?: CoreTurnItemJson
  result?: CoreTurnItemJson
}

export type RoomRunProcessEntry =
  | { kind: 'user'; item: CoreTurnItemJson }
  | { kind: 'reasoning'; item: CoreTurnItemJson }
  | RoomRunToolEntry
  | { kind: 'assistant'; item: CoreTurnItemJson }
  | { kind: 'error'; item: CoreTurnItemJson }
  | { kind: 'record'; item: CoreTurnItemJson }

export interface RoomRunConversation {
  /** Chronological activity shown inside the expandable process section. */
  process: RoomRunProcessEntry[]
  /** The trailing assistant reply rendered outside the folded process. */
  finalAnswer: CoreTurnItemJson | null
}

function isErrorItem(item: CoreTurnItemJson): boolean {
  return item.kind === 'error' || item.isError === true || item.status === 'failed'
}

/**
 * Projects a recorded run's items into a Code-style conversation: the final
 * assistant reply is split out, intermediate assistant text stays inside the
 * process timeline, and each tool call/result is one row. Hidden runtime
 * context kinds are dropped from both the view and any copyable transcript.
 */
export function buildRoomRunConversation(items: CoreTurnItemJson[]): RoomRunConversation {
  const visible = items.filter((item) => !HIDDEN_RUN_KINDS.has(item.kind))

  let finalAnswerId: string | null = null
  for (const item of visible) {
    if (item.kind === 'assistant_text' && item.text?.trim()) finalAnswerId = item.id
  }

  const process: RoomRunProcessEntry[] = []
  for (const entry of groupRoomRunItems(visible)) {
    if (entry.kind === 'tool') {
      process.push({ kind: 'tool', callId: entry.callId, call: entry.call, result: entry.result })
      continue
    }
    const item = entry.item
    if (item.id === finalAnswerId) continue
    if (item.kind === 'assistant_reasoning') process.push({ kind: 'reasoning', item })
    else if (item.kind === 'assistant_text') process.push({ kind: 'assistant', item })
    else if (item.kind === 'user_message') process.push({ kind: 'user', item })
    else if (isErrorItem(item)) process.push({ kind: 'error', item })
    else process.push({ kind: 'record', item })
  }

  const finalAnswer = finalAnswerId ? visible.find((item) => item.id === finalAnswerId) ?? null : null
  return { process, finalAnswer }
}

export function runItemText(item: CoreTurnItemJson): string {
  if (item.kind === 'user_message') return item.displayText ?? item.text ?? ''
  if (item.kind === 'approval') return [item.summary, item.reason].filter(Boolean).join('\n')
  if (item.kind === 'user_input') {
    return [
      item.prompt,
      ...(item.questions ?? []).map((question) => question.question ?? question.prompt ?? ''),
      ...(item.answers ?? []).map((answer) => `${answer.label}: ${answer.value ?? ''}`)
    ]
      .filter(Boolean)
      .join('\n')
  }
  if (item.kind === 'error') return item.message ?? item.summary ?? item.text ?? ''
  return item.text ?? item.summary ?? ''
}

function toolEntryText(entry: RoomRunToolEntry): string {
  const name = entry.call?.toolName ?? entry.result?.toolName ?? entry.callId
  const detail =
    entry.result?.isError || entry.result?.status === 'failed'
      ? ' (failed)'
      : entry.call?.summary?.trim()
        ? ` ${entry.call.summary.trim()}`
        : ''
  return `${name}${detail}`
}

/**
 * Builds a clipboard-safe transcript containing only the user request, visible
 * reasoning, tool summaries, errors and the final reply. Hidden context and raw
 * internal JSON are deliberately omitted.
 */
export function buildRoomRunTranscript(
  conversation: RoomRunConversation,
  input?: string
): string {
  const lines: string[] = []
  if (input?.trim()) lines.push(input.trim())
  for (const entry of conversation.process) {
    if (entry.kind === 'tool') lines.push(toolEntryText(entry))
    else {
      const text = runItemText(entry.item).trim()
      if (text) lines.push(text)
    }
  }
  if (conversation.finalAnswer) {
    const text = runItemText(conversation.finalAnswer).trim()
    if (text) lines.push(text)
  }
  return lines.join('\n\n')
}
