import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import type { ToolCallProviderMetadata } from '../../contracts/items.js'
import type { ModelRequest, ModelToolSpec } from '../../ports/model-client.js'
import { promptCacheKey } from '../../cache/prompt-cache-partition.js'
import { isFixedSamplingModel } from './fixed-sampling.js'
import { projectAnthropicToolInputSchema } from './anthropic-tool-schema-projection.js'
import { isDeepSeekHost, isGeminiOpenAiHost } from './model-error-probe.js'

export const COMPAT_HISTORY_CONTEXT = Symbol('compat-history-context')
export const COMPAT_ANTHROPIC_THINKING = Symbol('compat-anthropic-thinking')
export const COMPAT_TOOL_RESULT_ERROR = Symbol('compat-tool-result-error')

export type CompatChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | CompatChatMessageContentPart[] | null
  [COMPAT_HISTORY_CONTEXT]?: true
  [COMPAT_ANTHROPIC_THINKING]?: NonNullable<
    NonNullable<ToolCallProviderMetadata['anthropic']>['thinkingBlocks']
  >
  [COMPAT_TOOL_RESULT_ERROR]?: boolean
  name?: string
  tool_call_id?: string
  reasoning_content?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export type CompatChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type ReasoningCapability = ModelCapabilityMetadata['reasoning']

export type CompatRequestCodecInput = {
  request: ModelRequest
  model: string
  messages: CompatChatMessage[]
  tools: ModelToolSpec[]
  stream: boolean
  endpointFormat: ModelEndpointFormat
  includeStreamUsage?: boolean
  baseUrl: string
  reasoning?: ReasoningCapability
  maxTokens?: number
  isCodex: boolean
  isCodexLite: boolean
  serviceTiers?: readonly ('priority' | 'flex')[]
  codexNativeImageGeneration: boolean
}

export type CompatRequestCodecDeps = {
  splitOpenAiMessages: (messages: CompatChatMessage[]) => CompatChatMessage[]
  responsesInput: (messages: CompatChatMessage[]) => Array<Record<string, unknown>>
  toAnthropic: (
    messages: CompatChatMessage[],
    thinkingMode: boolean
  ) => { system: string; messages: Array<{ content: unknown }> }
  applyAnthropicCacheControl: (messages: Array<{ content: unknown }>) => void
  plainText: (content: CompatChatMessage['content']) => string
  applyChatReasoning: (
    body: Record<string, unknown>,
    effort: string | undefined,
    input: {
      includeThinking: boolean
      nativeDeepSeekHost: boolean
      geminiOpenAiHost: boolean
      reasoning?: ReasoningCapability
    }
  ) => void
  responsesReasoning: (
    effort: string | undefined,
    reasoning: ReasoningCapability,
    options: { maxEffort: 'high' | 'xhigh'; includeSummary: boolean }
  ) => Record<string, unknown> | null
  applyAnthropicReasoning: (
    body: Record<string, unknown>,
    effort: string | undefined,
    reasoning: ReasoningCapability
  ) => void
  resolveReasoning: (
    effort: string | undefined,
    reasoning: NonNullable<ReasoningCapability>
  ) => string | undefined
}

const DEFAULT_MESSAGES_MAX_TOKENS = 8_192
const DEFAULT_MESSAGES_REASONING_MAX_TOKENS = 32_768

function isGpt56FamilyModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  const basename = normalized.split('/').at(-1) ?? normalized
  return /^gpt-5\.6(?:-|$)/.test(basename)
}

export class CompatRequestCodecs {
  constructor(private readonly deps: CompatRequestCodecDeps) {}

  build(input: CompatRequestCodecInput): Record<string, unknown> {
    switch (input.endpointFormat) {
      case 'responses':
        return this.responses(input)
      case 'messages':
        return this.messages(input)
      default:
        return this.chatCompletions(input)
    }
  }

  private chatCompletions(input: CompatRequestCodecInput): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: input.model,
      stream: input.stream,
      messages: this.deps.splitOpenAiMessages(input.messages)
    }
    if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens
    applySamplingParams(body, input)
    if (input.request.responseFormat === 'json_object') body.response_format = { type: 'json_object' }
    if (input.stream && input.includeStreamUsage !== false) body.stream_options = { include_usage: true }
    const nativeDeepSeekHost = isDeepSeekHost(input.baseUrl)
    const geminiOpenAiHost = isGeminiOpenAiHost(input.baseUrl)
    const includeThinking = !isAzureOpenAiEndpoint(input.baseUrl) && !geminiOpenAiHost
    const requiredToolChoice = namedToolChoice(input)
    // DeepSeek V4 can call tools while thinking, but its Chat Completions API
    // rejects any tool_choice parameter in thinking mode. Keep the hard named
    // tool gate and disable thinking only for this constrained request.
    const reasoningEffort = nativeDeepSeekHost && requiredToolChoice
      ? 'off'
      : input.request.reasoningEffort
    this.deps.applyChatReasoning(body, reasoningEffort, {
      includeThinking,
      nativeDeepSeekHost,
      geminiOpenAiHost,
      reasoning: input.reasoning
    })
    if (
      includeThinking && nativeDeepSeekHost &&
      !Object.prototype.hasOwnProperty.call(body, 'thinking') &&
      isThinkingProducerModel(input.model)
    ) {
      body.thinking = { type: 'enabled' }
    }
    if (input.tools.length) {
      body.tools = input.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }))
    }
    if (requiredToolChoice) body.tool_choice = {
      type: 'function',
      function: { name: requiredToolChoice }
    }
    return body
  }

  private responses(input: CompatRequestCodecInput): Record<string, unknown> {
    const system = input.isCodex
      ? input.messages.filter(
          (message) => message.role === 'system' && message[COMPAT_HISTORY_CONTEXT] !== true
        )
      : []
    const nonSystem = input.isCodex
      ? input.messages.filter(
          (message) => message.role !== 'system' || message[COMPAT_HISTORY_CONTEXT] === true
        )
      : input.messages
    let instructions = system
      .map((message) => this.deps.plainText(message.content).trim())
      .filter(Boolean)
      .join('\n\n')
    const responseTools = input.tools.map((tool) => ({
      type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema
    }))
    let responseInput = this.deps.responsesInput(this.deps.splitOpenAiMessages(nonSystem))
    if (input.isCodex && !input.isCodexLite && responseInput.length === 0 && instructions) {
      // The Responses endpoint requires input even when the request has only
      // system context. Move (rather than duplicate) that context into a
      // supported system-role input item so the wire request remains valid.
      responseInput = [{ role: 'system', content: instructions }]
      instructions = ''
    }
    const litePrefix: Array<Record<string, unknown>> = input.isCodexLite
      ? [
          { type: 'additional_tools', role: 'developer', tools: responseTools },
          ...(instructions ? [{
            type: 'message', role: 'developer',
            content: [{ type: 'input_text', text: instructions }]
          }] : [])
        ]
      : []
    const requiredToolChoice = namedToolChoice(input)
    const useThreadPromptCacheKey = input.isCodex || isGpt56FamilyModel(input.model)
    const body: Record<string, unknown> = {
      model: input.model,
      stream: input.stream,
      input: input.isCodexLite ? [...litePrefix, ...responseInput] : responseInput,
      ...(input.isCodexLite
        ? {
            store: false,
            tool_choice: requiredToolChoice
              ? { type: 'function', name: requiredToolChoice }
              : 'auto',
            parallel_tool_calls: false
          }
        : input.isCodex ? { instructions: instructions || ' ', store: false } : {}),
      ...(useThreadPromptCacheKey
        ? {
            prompt_cache_key: promptCacheKey(
              input.request.threadId,
              input.request.promptCachePartition
            )
          }
        : {})
    }
    if (input.maxTokens !== undefined && !input.isCodex) body.max_output_tokens = input.maxTokens
    if (
      input.isCodex &&
      input.request.serviceTier === 'priority' &&
      input.serviceTiers?.includes('priority')
    ) {
      body.service_tier = 'priority'
    }
    applySamplingParams(body, input)
    if (input.request.responseFormat === 'json_object') body.text = { format: { type: 'json_object' } }
    const reasoning = this.deps.responsesReasoning(
      input.request.reasoningEffort,
      input.reasoning,
      { maxEffort: input.isCodex ? 'xhigh' : 'high', includeSummary: input.isCodex }
    )
    if (reasoning || input.isCodexLite) {
      body.reasoning = input.isCodexLite ? { ...(reasoning ?? {}), context: 'all_turns' } : reasoning!
      if (input.isCodex) body.include = ['reasoning.encrypted_content']
    }
    if (!input.isCodexLite && responseTools.length) body.tools = responseTools
    if (!input.isCodexLite && input.isCodex && input.codexNativeImageGeneration) {
      body.tools = [...((body.tools ?? []) as Record<string, unknown>[]), { type: 'image_generation' }]
    }
    if (requiredToolChoice && !input.isCodexLite) {
      body.tool_choice = { type: 'function', name: requiredToolChoice }
      // The server must not emit additional calls beside a hard-gated one.
      body.parallel_tool_calls = false
    }
    return body
  }

  private messages(input: CompatRequestCodecInput): Record<string, unknown> {
    const requiredToolChoice = namedToolChoice(input)
    // Anthropic rejects forced named tool choice together with extended
    // thinking. The gate is an execution-safety invariant, so temporarily
    // disable thinking for this request instead of silently weakening choice.
    const anthropicThinking = !requiredToolChoice && input.reasoning?.requestProtocol === 'anthropic-thinking'
    const converted = this.deps.toAnthropic(input.messages, anthropicThinking)
    this.deps.applyAnthropicCacheControl(converted.messages)
    const resolvedEffort = anthropicThinking && input.reasoning
      ? this.deps.resolveReasoning(input.request.reasoningEffort, input.reasoning)
      : undefined
    const thinkingEnabled = resolvedEffort !== undefined && resolvedEffort !== 'off'
    const body: Record<string, unknown> = {
      model: input.model,
      stream: input.stream,
      max_tokens: input.maxTokens ?? (
        thinkingEnabled ? DEFAULT_MESSAGES_REASONING_MAX_TOKENS : DEFAULT_MESSAGES_MAX_TOKENS
      ),
      messages: converted.messages
    }
    const systemText = input.request.responseFormat === 'json_object'
      ? [converted.system, 'Return a valid JSON object only.'].filter((item) => item.trim()).join('\n\n')
      : converted.system
    if (systemText) {
      body.system = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
    }
    applySamplingParams(body, input)
    if (!requiredToolChoice) {
      this.deps.applyAnthropicReasoning(body, input.request.reasoningEffort, input.reasoning)
    }
    if (input.tools.length) {
      body.tools = input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: projectAnthropicToolInputSchema(tool.inputSchema)
      }))
    }
    if (requiredToolChoice) body.tool_choice = { type: 'tool', name: requiredToolChoice }
    return body
  }
}

function namedToolChoice(input: CompatRequestCodecInput): string | undefined {
  const name = input.request.requiredToolName?.trim()
  if (!name) return undefined
  if (!input.tools.some((tool) => tool.name === name)) {
    throw new Error(`required_tool_unsupported: required tool ${JSON.stringify(name)} is not advertised`)
  }
  return name
}

function applySamplingParams(body: Record<string, unknown>, input: CompatRequestCodecInput): void {
  if (isFixedSamplingModel(input.model, input.request.providerId)) return
  if (input.request.temperature !== undefined) body.temperature = input.request.temperature
  if (input.request.topP !== undefined) body.top_p = input.request.topP
}

function isAzureOpenAiEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host.endsWith('.openai.azure.com') || host.endsWith('.cognitiveservices.azure.com')
  } catch {
    return /\.openai\.azure\.com\b|\.cognitiveservices\.azure\.com\b/i.test(baseUrl)
  }
}

function isThinkingProducerModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized === 'deepseek-v4-pro' || normalized === 'deepseek-v4-flash' ||
    normalized.includes('deepseek-reasoner') || normalized.endsWith('/deepseek-v4-pro') ||
    normalized.endsWith('/deepseek-v4-flash')
}
