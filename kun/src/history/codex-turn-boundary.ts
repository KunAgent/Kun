import { DOMParser } from '@xmldom/xmldom'
import { object, string, type JsonObject } from './codex-jsonl.js'

// Match Codex's context_manager/history.rs user-boundary predicate, independently
// of lifecycle grouping: an autonomous output turn does not consume a rollback.
const CONTEXT_MARKERS = [
  ['# agents.md instructions', '</instructions>'],
  ['<environment_context>', '</environment_context>'],
  ['<skill>', '</skill>'],
  ['<user_shell_command>', '</user_shell_command>'],
  ['<turn_aborted>', '</turn_aborted>'],
  ['<subagent_notification>', '</subagent_notification>'],
  ['<recommended_plugins>', '</recommended_plugins>']
]

function hookPrompt(text: string): boolean {
  if (!text.startsWith('<hook_prompt')) return false
  try {
    const document = new DOMParser({ onError: () => { throw new Error('Invalid hook prompt') } })
      .parseFromString(text, 'application/xml')
    const element = document.documentElement
    return element?.tagName === 'hook_prompt' && Boolean(element.getAttribute('hook_run_id')?.trim()) &&
      !Array.from(element.childNodes).some((node) => node.nodeType === 1)
  } catch { return false }
}

function contextualText(value: unknown): boolean {
  const part = object(value)
  if (part.type !== 'input_text' || typeof part.text !== 'string') return false
  const text = part.text.trim()
  const lower = text.toLowerCase()
  if (CONTEXT_MARKERS.some(([start, end]) => lower.startsWith(start) && lower.endsWith(end))) return true
  const external = /^<external_([^>]*)>/.exec(text)
  if (external && text.endsWith(`</external_${external[1]}>`)) return true
  if (/^<codex_internal_context source="[a-z][a-z0-9_]*">/.test(text) && text.endsWith('</codex_internal_context>')) return true
  if (text.startsWith('<goal_context>') && text.endsWith('</goal_context>')) return true
  if (hookPrompt(text)) return true
  return text.startsWith('Warning: The maximum number of unified exec processes you can keep open is') ||
    text.startsWith('Warning: Your account was flagged for potentially high-risk cyber activity') ||
    (text.startsWith('Warning: apply_patch was requested via ') &&
      text.endsWith('Use the apply_patch tool instead of exec_command.'))
}

function interAgentInstruction(content: unknown): boolean {
  if (!Array.isArray(content) || content.length !== 1) return false
  const part = object(content[0])
  if (!['input_text', 'output_text'].includes(string(part.type)) || typeof part.text !== 'string') return false
  try {
    const message = object(JSON.parse(part.text))
    return typeof message.author === 'string' && typeof message.recipient === 'string' &&
      typeof message.content === 'string' && typeof message.trigger_turn === 'boolean' &&
      (message.other_recipients === undefined || (Array.isArray(message.other_recipients) &&
        message.other_recipients.every((recipient) => typeof recipient === 'string')))
  } catch { return false }
}

export function isCodexUserTurnBoundary(record: JsonObject): boolean {
  if (record.type === 'inter_agent_communication') return true
  if (record.type !== 'response_item') return false
  const payload = object(record.payload)
  if (payload.type === 'agent_message') return true
  if (payload.type !== 'message') return false
  if (payload.role === 'user') {
    return !Array.isArray(payload.content) || !payload.content.some(contextualText)
  }
  return payload.role === 'assistant' && interAgentInstruction(payload.content)
}
