import type { TurnItem } from '../contracts/items.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'
import { normalizeRoleReasoningEffort } from './reasoning-effort.js'
import { userMessageTextWithComposerContexts } from '../domain/composer-context.js'

export const DEFAULT_SESSION_SUMMARY_TIMEOUT_MS = 20_000
export const DEFAULT_SESSION_SUMMARY_MAX_TOKENS = 400
export const DEFAULT_SESSION_SUMMARY_INPUT_MAX_BYTES = 96 * 1024

const SESSION_SUMMARY_SYSTEM_PROMPT = [
  'You write a short, neutral summary of an entire chat conversation.',
  'Output rules:',
  '- Output ONE paragraph (roughly 2-4 sentences). No headings, no bullet lists, no markdown.',
  "- Describe what the user wanted and what was accomplished or concluded.",
  '- Do not invent facts. Do not include tool names or raw code.',
  "- Write in the same language as the conversation."
].join('\n')

/**
 * One-shot internal LLM call producing a ~1-paragraph whole-conversation
 * summary from the full transcript. Mirrors the compaction-summary one-shot
 * pattern. Returns undefined on any failure / empty output.
 */
export async function generateSessionSummary(input: {
  threadId: string
  modelClient: ModelClient
  /** Resolved model id for the summary role (see resolveRoleModel). */
  model: string
  /** Optional per-provider routing id. */
  providerId?: string
  accountId?: string
  systemPrompt?: string
  /** Full conversation transcript items, oldest first. */
  items: readonly TurnItem[]
  /** Reasoning depth for the summary call. Invalid/missing => 'off'. */
  reasoningEffort?: string
  timeoutMs?: number
  maxTokens?: number
  inputMaxBytes?: number
  abortSignal?: AbortSignal
}): Promise<string | undefined> {
  if (input.abortSignal?.aborted) return undefined
  const transcript = buildSessionTranscript(input.items, input.inputMaxBytes ?? DEFAULT_SESSION_SUMMARY_INPUT_MAX_BYTES)
  if (!transcript.trim()) return undefined

  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs ?? DEFAULT_SESSION_SUMMARY_TIMEOUT_MS))
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  input.abortSignal?.addEventListener('abort', onAbort, { once: true })

  try {
    const turnId = `${input.threadId}_session_summary`
    const requestItem: TurnItem = {
      id: `item_${turnId}_request`,
      turnId,
      threadId: input.threadId,
      role: 'user',
      status: 'completed',
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      kind: 'user_message',
      text: ['Conversation transcript:', transcript, '', 'Write the one-paragraph summary now.'].join('\n')
    }
    const request: ModelRequest = {
      threadId: input.threadId,
      turnId,
      model: input.model,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      contextInstructions: [SESSION_SUMMARY_SYSTEM_PROMPT],
      prefix: [],
      history: [requestItem],
      tools: [],
      stream: true,
      maxTokens: Math.max(1, Math.floor(input.maxTokens ?? DEFAULT_SESSION_SUMMARY_MAX_TOKENS)),
      temperature: 0,
      reasoningEffort: normalizeRoleReasoningEffort(input.reasoningEffort),
      abortSignal: controller.signal
    }
    let text = ''
    for await (const chunk of input.modelClient.stream(request)) {
      if (input.abortSignal?.aborted || controller.signal.aborted) return undefined
      if (chunk.kind === 'assistant_text_delta') text += chunk.text
      if (chunk.kind === 'error') return undefined
    }
    const summary = text.replace(/\s+/g, ' ').trim()
    return summary || undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
    input.abortSignal?.removeEventListener('abort', onAbort)
  }
}

export function buildSessionTranscript(items: readonly TurnItem[], maxBytes: number): string {
  const text = items
    .map(transcriptLine)
    .filter((line) => line.length > 0)
    .join('\n')
  return fitTextToBytes(text, Math.max(1_024, maxBytes))
}

function transcriptLine(item: TurnItem): string {
  switch (item.kind) {
    case 'user_message':
      return `[user] ${clip(userMessageTextWithComposerContexts(item), 2_000)}`
    case 'assistant_text':
      return `[assistant] ${clip(item.text, 2_000)}`
    case 'tool_call':
      return `[tool_call:${item.toolName}] ${clip(item.summary || stringify(item.arguments), 600)}`
    case 'tool_result':
      return `[tool_result:${item.toolName}${item.isError ? ':error' : ''}] ${clip(stringify(item.output), 800)}`
    case 'compaction':
      return item.replacedTokens > 0 ? `[earlier summary] ${clip(item.summary, 2_000)}` : ''
    case 'review':
      return `[review:${item.title}] ${clip(item.reviewText || stringify(item.output), 1_200)}`
    case 'error':
      return `[error${item.code ? `:${item.code}` : ''}] ${clip(item.message, 600)}`
    default:
      return ''
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function clip(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length <= maxChars ? compact : `${compact.slice(0, Math.max(0, maxChars - 3)).trim()}...`
}

function fitTextToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let used = 0
  let out = ''
  for (const char of text) {
    const bytes = Buffer.byteLength(char, 'utf8')
    if (used + bytes > maxBytes) break
    out += char
    used += bytes
  }
  return `${out.trimEnd()}\n...[truncated]`
}
