import { randomUUID } from 'node:crypto'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  isCustomModelEndpointFormat,
  modelEndpointPath,
  resolveWriteInlineCompletionEndpointFormat,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  resolveWriteInlineCompletionProviderProfile,
  modelProviderModelProfile,
  resolveModelEndpointFormat,
  type ModelEndpointFormat,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  upstreamDeepSeekFimCompletionsUrl,
  upstreamOpenAiCustomEndpointUrl,
  upstreamOpenAiChatCompletionsUrl
} from '../../shared/openai-compat-url'
import type {
  WriteInlineCompletionAction,
  WriteInlineCompletionMode,
  WriteInlineCompletionDebugEntry,
  WriteInlineCompletionRequest,
  WriteInlineCompletionResult
} from '../../shared/write-inline-completion'
import type { WriteInlineEditRecentEdit } from '../../shared/write-inline-edit'
import {
  retrieveWriteInlineCompletionContext,
  type WriteRetrievalContext,
  type WriteRetrievalSnippet
} from './write-retrieval-service'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import {
  codexResponsesLiteInput,
  resolveCodexResponsesRequestAuth,
  usesCodexResponsesLite,
  withCodexResponsesLiteHeader
} from '../codex-responses-lite'

import {
  AnthropicMessageResponse,
  ChatCompletionMessage,
  ChatCompletionResponse,
  ResponsesApiResponse,
  WriteInlineProviderResponseFormat,
  flattenMessageContent,
  shouldDisableThinkingForInlineCompletion
} from './write-inline-completion-prompt'

export function compatibleModelEndpointUrl(baseUrl: string, endpointFormat: ModelEndpointFormat): string {
  if (isCustomModelEndpointFormat(endpointFormat)) return upstreamOpenAiCustomEndpointUrl(baseUrl)
  if (endpointFormat === 'chat_completions') return upstreamOpenAiChatCompletionsUrl(baseUrl)
  const path = modelEndpointPath(endpointFormat)
  const normalized = trimTrailingSlashes(baseUrl.trim())
  if (!normalized) return `/v1/${path}`
  if (normalized.toLowerCase().endsWith(`/${path}`)) return normalized
  const withoutEndpoint = stripKnownModelEndpointPath(normalized)
  const lastSegment = withoutEndpoint.split('/').pop()?.toLowerCase() ?? ''
  if (lastSegment === 'beta') {
    return `${withoutEndpoint.slice(0, -'/beta'.length)}/v1/${path}`
  }
  if (isVersionSegment(lastSegment)) {
    return `${withoutEndpoint}/${path}`
  }
  return `${withoutEndpoint}/v1/${path}`
}

export function stripKnownModelEndpointPath(baseUrl: string): string {
  const lower = baseUrl.toLowerCase()
  for (const path of ['chat/completions', 'responses', 'messages']) {
    if (lower.endsWith(`/${path}`)) {
      return trimTrailingSlashes(baseUrl.slice(0, -path.length))
    }
  }
  return baseUrl
}

export function isDeepSeekInlineCompletionBaseUrl(baseUrl: string): boolean {
  const hostname = baseUrlHostname(baseUrl)
  return hostname === 'deepseek.com' || hostname.endsWith('.deepseek.com')
}

export function baseUrlHostname(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      return new URL(candidate).hostname.toLowerCase()
    } catch {
      // Try the next normalized form.
    }
  }
  return ''
}

export function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1
  return end === value.length ? value : value.slice(0, end)
}

export function isVersionSegment(value: string): boolean {
  if (value.length < 2 || value[0] !== 'v') return false
  for (let index = 1; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 48 || code > 57) return false
  }
  return true
}

export function buildProviderHeaders(
  apiKey: string,
  responseFormat: WriteInlineProviderResponseFormat,
  extraHeaders: Record<string, string> = {},
  responsesLite = false
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
  if (responseFormat === 'messages') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  }
  return withCodexResponsesLiteHeader({ ...headers, ...extraHeaders }, responsesLite)
}

export function buildAnthropicMessages(messages: ChatCompletionMessage[]): {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
} {
  const system: string[] = []
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content)
      continue
    }
    out.push({ role: 'user', content: message.content })
  }
  return { system: system.join('\n\n'), messages: out }
}

export function buildProviderRequestBody(input: {
  responseFormat: WriteInlineProviderResponseFormat
  model: string
  messages: ChatCompletionMessage[] | null
  prompt: string
  suffix: string
  maxTokens: number
  responsesLite?: boolean
}): Record<string, unknown> {
  if (input.responseFormat === 'fim_completions') {
    return {
      model: input.model,
      prompt: input.prompt,
      suffix: input.suffix,
      max_tokens: input.maxTokens
    }
  }
  const messages = input.messages ?? [
    { role: 'user' as const, content: input.prompt }
  ]
  if (input.responseFormat === 'messages') {
    const converted = buildAnthropicMessages(messages)
    return {
      model: input.model,
      messages: converted.messages,
      max_tokens: input.maxTokens,
      ...(converted.system ? { system: converted.system } : {})
    }
  }
  if (input.responseFormat === 'responses') {
    const responseInput = messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
    if (input.responsesLite) {
      const systemPrompt = messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n')
      return {
        model: input.model,
        input: codexResponsesLiteInput(
          systemPrompt,
          responseInput.filter((message) => message.role !== 'system')
        ),
        store: false,
        tool_choice: 'auto',
        parallel_tool_calls: false,
        reasoning: { context: 'all_turns' }
      }
    }
    return {
      model: input.model,
      input: responseInput,
      max_output_tokens: input.maxTokens
    }
  }
  return {
    model: input.model,
    messages,
    max_tokens: input.maxTokens,
    ...(shouldDisableThinkingForInlineCompletion(input.model)
      ? { thinking: { type: 'disabled' } }
      : {})
  }
}

export function providerTextFromResponse(
  responseText: string,
  format: WriteInlineProviderResponseFormat = 'chat_completions'
): string {
  let parsed: ChatCompletionResponse | ResponsesApiResponse | AnthropicMessageResponse
  try {
    parsed = JSON.parse(responseText) as ChatCompletionResponse | ResponsesApiResponse | AnthropicMessageResponse
  } catch {
    throw new Error('Inline completion provider returned non-JSON data.')
  }
  if (format === 'responses') {
    return textFromResponsesPayload(parsed as ResponsesApiResponse)
  }
  if (format === 'messages') {
    return textFromAnthropicPayload(parsed as AnthropicMessageResponse)
  }
  const chatPayload = parsed as ChatCompletionResponse
  const firstChoice = chatPayload.choices?.[0]
  if (typeof firstChoice?.text === 'string') return firstChoice.text
  const first = firstChoice?.message?.content
  return flattenMessageContent(first)
}

export function textFromResponsesPayload(payload: ResponsesApiResponse): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  const parts: string[] = []
  for (const item of payload.output ?? []) {
    const content = item.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      const text = record.text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('')
}

export function textFromAnthropicPayload(payload: AnthropicMessageResponse): string {
  const parts: string[] = []
  for (const block of payload.content ?? []) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('')
}
