import { shellSpawnEnv } from '../../adapters/tool/builtin-tool-utils.js'
import type {
  ModelClient,
  ModelRequest,
  ModelStreamChunk
} from '../../ports/model-client.js'
import { mapSdkUsage } from './sdk-event-mapper.js'
import { buildScopedEnv } from './sdk-options-builder.js'
import type {
  SdkApi,
  SdkApiMessage,
  SdkContentBlock,
  SdkQueryResult,
  SdkToolUseBlock,
  SdkUsage
} from './sdk-protocol.js'

export type AgentSdkApprovalReviewModelClientOptions = {
  providerId: string
  oauthToken?: string
  defaultModel?: string
  cwd: string
  baseEnv?: () => Record<string, string | undefined>
  pathToClaudeCodeExecutable?: string
  loadSdk?: () => Promise<SdkApi>
}

let reviewSdkPromise: Promise<SdkApi> | undefined

function loadAgentSdkForReview(): Promise<SdkApi> {
  if (!reviewSdkPromise) {
    const specifier = '@anthropic-ai/claude-agent-sdk'
    reviewSdkPromise = import(specifier as string).then((module) => module as unknown as SdkApi)
  }
  return reviewSdkPromise
}

/**
 * Exact-route, one-shot Claude Agent SDK adapter used only by automatic
 * approval review. It deliberately does not resume an agent session or expose
 * native/MCP tools, hooks, skills, subagents, or ambient settings.
 */
export class AgentSdkApprovalReviewModelClient implements ModelClient {
  readonly provider: string
  readonly model: string

  constructor(private readonly options: AgentSdkApprovalReviewModelClientOptions) {
    this.provider = `agent-sdk-review:${options.providerId}`
    this.model = options.defaultModel?.trim() || 'claude-default'
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    if (request.tools.length > 0 || request.requiredToolName) {
      throw new Error('Agent SDK approval review refuses requests that expose tools')
    }
    const prompt = approvalReviewUserPrompt(request)
    if (!prompt) throw new Error('Agent SDK approval review input is unavailable')
    if (request.abortSignal.aborted) {
      throw request.abortSignal.reason ?? new Error('Agent SDK approval review aborted')
    }

    const abortController = new AbortController()
    const onAbort = (): void => abortController.abort(request.abortSignal.reason)
    request.abortSignal.addEventListener('abort', onAbort, { once: true })
    let activeQuery: SdkQueryResult | undefined
    let queryFinished = false
    try {
      const sdk = await (this.options.loadSdk ?? loadAgentSdkForReview)()
      if (request.abortSignal.aborted) onAbort()
      const requestedModel = request.model.trim()
      activeQuery = sdk.query({
        prompt,
        options: {
          spawnClaudeCodeProcess: spawnOwnedSdkProcess,
          cwd: this.options.cwd,
          ...(request.systemPrompt?.trim()
            ? { systemPrompt: request.systemPrompt.trim() }
            : {}),
          // These are the load-bearing isolation settings. `allowedTools` is
          // an auto-approval list in this SDK, while `tools` is availability.
          tools: [],
          allowedTools: [],
          strictMcpConfig: true,
          permissionMode: 'default',
          settingSources: [],
          includePartialMessages: false,
          maxTurns: 1,
          env: buildScopedEnv(
            this.options.baseEnv?.() ?? shellSpawnEnv(),
            this.options.oauthToken
          ),
          canUseTool: async () => ({
            behavior: 'deny',
            message: 'Tools are unavailable in isolated approval review.'
          }),
          abortController,
          ...(requestedModel && requestedModel !== 'claude-default'
            ? { model: requestedModel }
            : {}),
          ...(this.options.pathToClaudeCodeExecutable
            ? { pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable }
            : {})
        }
      })

      let assistantText = ''
      let resultText = ''
      let usage: SdkUsage | undefined
      let turns = 0
      let costUsd: number | undefined
      let resultError: string | undefined
      for await (const message of activeQuery) {
        if (request.abortSignal.aborted || abortController.signal.aborted) {
          throw request.abortSignal.reason ?? new Error('Agent SDK approval review aborted')
        }
        if (message.type === 'assistant') {
          const apiMessage = (message as { message: SdkApiMessage }).message
          assistantText += textOfSdkMessage(apiMessage)
          usage = apiMessage.usage ?? usage
          for (const block of blocksOfSdkMessage(apiMessage)) {
            if (block.type !== 'tool_use') continue
            const toolUse = block as SdkToolUseBlock
            yield {
              kind: 'tool_call_complete',
              callId: typeof toolUse.id === 'string' ? toolUse.id : 'review_tool_call',
              toolName: typeof toolUse.name === 'string' ? toolUse.name : 'unknown',
              arguments: isRecord(toolUse.input) ? toolUse.input : {}
            }
          }
          continue
        }
        if (message.type !== 'result') continue
        const result = message as Record<string, unknown>
        resultText = typeof result.result === 'string' ? result.result : ''
        usage = isRecord(result.usage) ? result.usage as SdkUsage : usage
        turns = finiteNonNegativeInt(result.num_turns)
        costUsd = finiteNonNegativeNumber(result.total_cost_usd)
        if (result.is_error === true || result.subtype !== 'success') {
          resultError = resultText || String(result.subtype || 'Agent SDK approval review failed')
        }
        queryFinished = true
      }
      queryFinished = true

      if (resultError) {
        yield { kind: 'error', message: resultError }
        yield { kind: 'completed', stopReason: 'error' }
        return
      }
      const output = resultText || assistantText
      if (output) yield { kind: 'assistant_text_delta', text: output }
      if (usage) {
        yield {
          kind: 'usage',
          usage: mapSdkUsage(usage, turns || 1, costUsd)
        }
      }
      yield { kind: 'completed', stopReason: 'stop' }
    } finally {
      request.abortSignal.removeEventListener('abort', onAbort)
      if (!queryFinished) {
        abortController.abort(new Error('Agent SDK approval review stream closed'))
        try {
          await activeQuery?.interrupt?.()
        } catch {
          // The abort controller remains authoritative; cleanup is best effort.
        }
      }
    }
  }
}

function approvalReviewUserPrompt(request: ModelRequest): string {
  for (let index = request.history.length - 1; index >= 0; index -= 1) {
    const item = request.history[index]
    if (item?.kind === 'user_message' && typeof item.text === 'string') return item.text
  }
  return ''
}

function blocksOfSdkMessage(message: SdkApiMessage): SdkContentBlock[] {
  return typeof message.content === 'string'
    ? message.content
      ? [{ type: 'text', text: message.content }]
      : []
    : message.content
}

function textOfSdkMessage(message: SdkApiMessage): string {
  return blocksOfSdkMessage(message)
    .filter((block) =>
      block.type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    )
    .map((block) => (block as { text: string }).text)
    .join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0
}

function finiteNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}
import { spawnOwnedSdkProcess } from './owned-sdk-process.js'
