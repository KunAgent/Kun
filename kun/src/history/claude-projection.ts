import { object, string, type JsonObject } from './codex-jsonl.js'
import { codexAttachmentDescriptors } from './codex-attachment-descriptors.js'
import type { ItemContent } from './codex-projection.js'

/** Adapts declared attachment blocks only; never treat tool prose as paths. */
export function claudeAttachmentDescriptors(record: JsonObject) {
  const message = object(record.message)
  const parts = Array.isArray(message.content) ? message.content : []
  const content = parts.flatMap((part) => {
    const value = object(part)
    return value.type === 'tool_result' && Array.isArray(value.content) ? value.content : [part]
  }).map((part) => object(part).type === 'document' ? { ...object(part), type: 'file' } : part)
  return codexAttachmentDescriptors({ payload: { content } }).map((part) => ({
    ...part, name: part.name.replace(/^Codex/, 'Claude Code')
  }))
}

export function projectClaudeRecord(record: JsonObject): ItemContent[] {
  if (record.isSidechain === true) return []
  const message = object(record.message)
  if (!['user', 'assistant'].includes(string(record.type))) {
    if (record.type === 'system' && record.subtype === 'compact_boundary') return [{
      kind: 'assistant_text', text: '[Claude Code context compaction boundary]'
    }]
    return []
  }
  const role = record.type === 'user' ? 'user_message' : 'assistant_text'
  const parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }]
    : Array.isArray(message.content) ? message.content : []
  const attachments = claudeAttachmentDescriptors(record).map(({ index, name, mimeType }) => ({ index, name, mimeType }))
  const items: ItemContent[] = []
  for (const raw of parts) {
    const part = object(raw)
    if (part.type === 'text') items.push({ kind: role, text: string(part.text) })
    else if (part.type === 'thinking') items.push({ kind: 'assistant_reasoning', text: string(part.thinking) })
    else if (part.type === 'redacted_thinking') items.push({ kind: 'assistant_reasoning', text: '[Claude Code reasoning is unavailable.]' })
    else if (part.type === 'tool_use') items.push({ kind: 'tool_call', callId: string(part.id),
      toolName: string(part.name) || 'unknown_tool', arguments: object(part.input), summary: 'Read-only Claude Code tool call' })
    else if (part.type === 'tool_result') items.push({ kind: 'tool_result', callId: string(part.tool_use_id),
      toolName: 'claude_tool', output: typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? ''),
      isError: part.is_error === true })
    else items.push({ kind: role, text: ['image', 'document'].includes(string(part.type))
      ? '[Claude Code attachment: available from the original source.]'
      : `[Unsupported Claude Code content: ${string(part.type) || 'unknown'}]` })
  }
  // Attachment indexes identify declarations in this whole source record.
  if (items[0] && attachments.length) items[0].sourceAttachments = attachments
  return items
}

export function isClaudeInput(record: JsonObject): boolean {
  if (record.type !== 'user' || record.isSidechain === true || record.isMeta === true || record.isCompactSummary === true) return false
  const content = object(record.message).content
  return typeof content === 'string' || (Array.isArray(content) && content.some((part) => object(part).type !== 'tool_result'))
}
