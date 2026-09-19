import { fileURLToPath } from 'node:url'
import { object, string, type JsonObject } from './codex-jsonl.js'
import type { CodexAttachmentDescriptor } from './codex-attachment-descriptors.js'
import type { ItemContent } from './codex-projection.js'

export function openCodeAttachmentDescriptors(record: JsonObject): CodexAttachmentDescriptor[] {
  const part = object(record.part)
  const declared = part.type === 'file' ? [part] : Array.isArray(object(part.state).attachments) ? object(part.state).attachments as JsonObject[] : []
  return declared.slice(0, 32).map((p, index) => {
    const url = string(p.url)
    let path = string(object(p.source).path)
    if (!path && url.startsWith('file:')) { try { path = fileURLToPath(url) } catch { /* Invalid URL is unavailable. */ } }
    return { index, name: string(p.filename) || 'OpenCode attachment', mimeType: string(p.mime),
      ...(url.startsWith('data:') ? { dataUrl: url } : {}), ...(path ? { path } : {}),
      ...(!path && !url.startsWith('data:') ? { unavailable: true } : {}) }
  })
}
export function projectOpenCodeRecord(record: JsonObject): ItemContent[] {
  const part = object(record.part), message = object(record.message)
  const role = message.role === 'user' ? 'user_message' : 'assistant_text'
  const state = object(part.state)
  let items: ItemContent[] = []
  switch (part.type) {
    case 'text': items = [{ kind: role, text: string(part.text) }]; break
    case 'reasoning': items = [{ kind: 'assistant_reasoning', text: string(part.text) || '[OpenCode reasoning is unavailable.]' }]; break
    case 'tool':
      items = [{ kind: 'tool_call', callId: string(part.callID) || string(part.id), toolName: string(part.tool),
        arguments: object(state.input), summary: 'Read-only OpenCode tool call' }]
      if (state.status === 'completed' || state.status === 'error') items.push({ kind: 'tool_result',
        callId: string(part.callID) || string(part.id), toolName: string(part.tool), isError: state.status === 'error',
        output: string(state.output) || string(state.error) || (object(state.time).compacted ? '[OpenCode compacted this tool output.]' : '') })
      break
    case 'file': items = [{ kind: role, text: `[OpenCode attachment: ${string(part.filename) || 'source file'}]` }]; break
    case 'compaction': items = [{ kind: 'assistant_text', text: '[OpenCode context compaction boundary]' }]; break
    case 'subtask': items = [{ kind: 'assistant_text', text: `[OpenCode subagent task]\n${string(part.description)}` }]; break
    case 'patch': items = [{ kind: 'assistant_text', text: `[OpenCode file changes]\n${JSON.stringify(part.files ?? [])}` }]; break
    case 'step-start': case 'step-finish': case 'snapshot': case 'agent': case 'retry': break
    default: items = [{ kind: 'assistant_text', text: `[Unsupported OpenCode content: ${string(part.type) || 'unknown'}]` }]
  }
  const attachments = openCodeAttachmentDescriptors(record).map(({ index, name, mimeType }) => ({ index, name, mimeType }))
  if (items.length && attachments.length) items[items.length - 1].sourceAttachments = attachments
  return items
}
