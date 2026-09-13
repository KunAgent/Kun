import type { TurnItem } from '../contracts/items.js'
import { describeCodexAttachments, type SourceAttachmentMetadata } from './codex-attachment-descriptors.js'
import { object, string, type JsonObject } from './codex-jsonl.js'

export const MAX_ITEM_TEXT = 16_384
export type ItemContent = (
  | { kind: 'user_message' | 'assistant_text' | 'assistant_reasoning'; text: string }
  | { kind: 'tool_call'; toolName: string; callId: string; arguments: Record<string, unknown>; summary?: string }
  | { kind: 'tool_result'; toolName: string; callId: string; output: unknown; isError: boolean }
) & { sourceAttachments?: SourceAttachmentMetadata[] }

export function clipped(text: string, max = MAX_ITEM_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}\n[Truncated; read this history record with an offset to continue.]` : text
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map((part) => {
    const item = object(part)
    if (typeof item.text === 'string') return item.text
    if (typeof item.content === 'string') return item.content
    if (String(item.type).includes('image')) {
      const path = string(item.path) || string(item.file_path) || string(item.image_url)
      return `[Codex image attachment: ${path.startsWith('data:') ? 'embedded in source file' : path || 'unavailable'}]`
    }
    if (String(item.type).includes('file') || String(item.type).includes('audio')) {
      return `[Codex attachment: ${string(item.filename) || string(item.path) || 'unavailable'}]`
    }
    return ''
  }).filter(Boolean).join('\n')
}

function argumentsObject(value: unknown, fullContent = false): Record<string, unknown> {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {})
  if (!fullContent && text.length > MAX_ITEM_TEXT) return { sourcePreview: clipped(text) }
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : { input: parsed }
  } catch { return { input: text } }
}

/** Historical content is inert: no approvals, provider state or executable attachment IDs. */
export function projectCodexRecord(record: JsonObject, fullContent = false): ItemContent[] {
  const attachments = describeCodexAttachments(record)
  return projectCodexContent(record, fullContent).map((item) => ({
    ...item, ...(attachments.length ? { sourceAttachments: attachments } : {})
  }))
}

function projectCodexContent(record: JsonObject, fullContent = false): ItemContent[] {
  const payload = object(record.payload)
  if (record.type !== 'response_item') return []
  const type = string(payload.type)
  if (type === 'message') {
    const role = string(payload.role)
    if (role !== 'user' && role !== 'assistant') return []
    const text = contentText(payload.content)
    if (!text) return []
    return [{
      kind: role === 'user' ? 'user_message' : payload.channel === 'analysis'
        ? 'assistant_reasoning' : 'assistant_text', text
    }]
  }
  if (type === 'reasoning') {
    const text = contentText(payload.summary) || contentText(payload.content)
    return [{ kind: 'assistant_reasoning', text: text || '[Encrypted Codex reasoning is unavailable.]' }]
  }
  if (type === 'function_call' || type === 'custom_tool_call' || type === 'local_shell_call') {
    const callId = string(payload.call_id) || string(payload.id) || 'unknown-call'
    return [{ kind: 'tool_call', callId,
      toolName: string(payload.name) || (type === 'local_shell_call' ? 'shell' : 'unknown_tool'),
      arguments: argumentsObject(payload.arguments ?? payload.input ?? payload.action, fullContent),
      summary: 'Read-only Codex tool call'
    }]
  }
  if (type === 'function_call_output' || type === 'custom_tool_call_output') {
    return [{ kind: 'tool_result', callId: string(payload.call_id) || 'unknown-call',
      toolName: string(payload.name) || 'codex_tool',
      output: typeof payload.output === 'string' ? payload.output : Array.isArray(payload.output)
        ? contentText(payload.output) || '[Encrypted or unsupported Codex tool output is unavailable.]'
        : JSON.stringify(payload.output ?? ''),
      isError: payload.is_error === true
    }]
  }
  if (type === 'web_search_call') {
    return [{ kind: 'assistant_text', text: `[Codex web search]\n${JSON.stringify(payload.action ?? {})}` }]
  }
  if (type === 'image_generation_call') {
    return [{ kind: 'assistant_text', text: '[Codex generated image: retained in the original history file.]' }]
  }
  return []
}

export function toTurnItem(
  item: ItemContent,
  base: { id: string; turnId: string; threadId: string; createdAt: string }
): TurnItem {
  const common = { ...base, status: 'completed' as const, finishedAt: base.createdAt }
  if (item.kind === 'tool_call') return {
    ...common, ...item, callId: `${base.turnId}:call:${item.callId}`, role: 'assistant', toolKind: 'tool_call'
  }
  if (item.kind === 'tool_result') return {
    ...common, ...item, callId: `${base.turnId}:call:${item.callId}`, output: typeof item.output === 'string' ? clipped(item.output) : item.output,
    role: 'tool', toolKind: 'tool_call'
  }
  return { ...common, ...item, text: clipped(item.text), role: item.kind === 'user_message' ? 'user' : 'assistant' }
}

export function itemText(item: ItemContent): string {
  if (item.kind === 'tool_call') return `${item.toolName} ${JSON.stringify(item.arguments)}`
  if (item.kind === 'tool_result') return `${item.toolName}: ${typeof item.output === 'string' ? item.output : JSON.stringify(item.output)}`
  return item.text
}
