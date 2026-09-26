/**
 * ACP tool_call / tool_call_update → Kun item drafts (docs/ade/03 §7.2).
 * Pure functions so every mapping is unit-testable without a process; the
 * event mapper owns the per-turn state machine that calls these.
 */
import type { TurnItem } from '../../contracts/items.js'
import {
  makeToolCallItem,
  makeToolResultItem
} from '../../domain/item.js'
import type {
  ToolCall,
  ToolCallContent,
  ToolCallUpdate
} from './acp-schema.js'

/** rawInput is opaque agent data — persist at most 16 KiB serialized. */
const MAX_RAW_INPUT_CHARS = 16 * 1024

export type AcpToolKindString = ToolCall['kind']

/** §7.2: edit/delete/move → file_change; execute → command_execution. */
export function toolItemKind(
  kind: AcpToolKindString
): 'tool_call' | 'command_execution' | 'file_change' {
  switch (kind) {
    case 'edit':
    case 'delete':
    case 'move':
      return 'file_change'
    case 'execute':
      return 'command_execution'
    default:
      return 'tool_call'
  }
}

export function acpToolName(kind: AcpToolKindString): string {
  return `acp:${kind ?? 'other'}`
}

export function truncateRawInput(rawInput: unknown): unknown {
  if (rawInput === undefined) return undefined
  try {
    const serialized = JSON.stringify(rawInput)
    if (serialized.length <= MAX_RAW_INPUT_CHARS) return rawInput
    return {
      _truncated: true,
      bytes: serialized.length,
      preview: serialized.slice(0, MAX_RAW_INPUT_CHARS)
    }
  } catch {
    return undefined
  }
}

export type AcpToolCallWire = ToolCall | ToolCallUpdate

function wireFields(call: AcpToolCallWire) {
  return {
    toolCallId: call.toolCallId,
    title: 'title' in call ? call.title ?? undefined : undefined,
    kind: call.kind ?? undefined,
    status: call.status ?? undefined,
    content: call.content ?? undefined,
    locations: call.locations ?? undefined,
    rawInput: 'rawInput' in call ? call.rawInput : undefined,
    rawOutput: call.rawOutput ?? undefined
  }
}

/** First-seen `tool_call` or placeholder for an out-of-order update. */
export function toKunToolCallItem(input: {
  call: AcpToolCallWire
  itemId: string
  threadId: string
  turnId: string
}): TurnItem {
  const call = wireFields(input.call)
  return makeToolCallItem({
    id: input.itemId,
    turnId: input.turnId,
    threadId: input.threadId,
    callId: call.toolCallId,
    toolName: acpToolName(call.kind),
    toolKind: toolItemKind(call.kind),
    arguments: {
      ...(call.title ? { title: call.title } : {}),
      ...(call.kind ? { kind: call.kind } : {}),
      ...(call.locations?.length ? { locations: call.locations } : {}),
      ...(call.rawInput !== undefined
        ? { rawInput: truncateRawInput(call.rawInput) }
        : {})
    },
    status:
      call.status === 'completed' || call.status === 'failed'
        ? call.status
        : call.status === 'in_progress'
          ? 'running'
          : 'pending'
  })
}

export type AcpToolDiff = {
  path: string
  oldText: string | null
  newText: string
}

function textOf(block: unknown): string {
  if (
    block &&
    typeof block === 'object' &&
    (block as { type?: string }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  ) {
    return (block as { text: string }).text
  }
  return ''
}

function collectOutput(call: AcpToolCallWire): {
  text: string
  diffs: AcpToolDiff[]
  terminalIds: string[]
} {
  const wire = wireFields(call)
  const diffs: AcpToolDiff[] = []
  const terminalIds: string[] = []
  const textParts: string[] = []
  for (const item of wire.content ?? []) {
    const content = item as ToolCallContent & { type?: string }
    if (content.type === 'content') {
      const text = textOf((content as { content?: unknown }).content)
      if (text) textParts.push(text)
    } else if (content.type === 'diff') {
      const diff = content as { path?: string; oldText?: string | null; newText?: string }
      if (typeof diff.path === 'string' && typeof diff.newText === 'string') {
        diffs.push({
          path: diff.path,
          oldText: diff.oldText ?? null,
          newText: diff.newText
        })
      }
    } else if (content.type === 'terminal') {
      const terminalId = (content as { terminalId?: string }).terminalId
      if (terminalId) terminalIds.push(terminalId)
    }
  }
  return { text: textParts.join('\n'), diffs, terminalIds }
}

/**
 * Terminal-state result item: `completed`/`failed`, or 'aborted' when the
 * mapper interrupts a still-open call at turn end.
 */
export function toKunToolResult(input: {
  call: AcpToolCallWire
  itemId: string
  threadId: string
  turnId: string
  outcome: 'completed' | 'failed' | 'interrupted'
}): TurnItem {
  const wire = wireFields(input.call)
  const { text, diffs, terminalIds } = collectOutput(input.call)
  let output: unknown
  if (input.outcome === 'interrupted') {
    output = 'interrupted'
  } else if (diffs.length || terminalIds.length) {
    output = {
      ...(text ? { text } : {}),
      ...(diffs.length ? { diffs } : {}),
      ...(terminalIds.length ? { terminalIds } : {})
    }
  } else {
    output = text || (wire.rawOutput ?? '')
  }
  return makeToolResultItem({
    id: input.itemId,
    turnId: input.turnId,
    threadId: input.threadId,
    callId: wire.toolCallId,
    toolName: acpToolName(wire.kind),
    toolKind: toolItemKind(wire.kind),
    output,
    isError: input.outcome !== 'completed',
    status: input.outcome === 'interrupted' ? 'aborted' : input.outcome
  })
}
