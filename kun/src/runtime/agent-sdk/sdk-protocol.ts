/**
 * Minimal, decoupled type surface for `@anthropic-ai/claude-agent-sdk`.
 *
 * We deliberately re-declare the slice of the SDK we consume rather than
 * importing its types directly. Two reasons:
 *
 *  1. **Typecheck without install.** The SDK bundles a large per-platform
 *     Claude Code binary as an optional dependency. Pinning our pure modules
 *     (event mapper, tool bridge, options builder) to these local interfaces
 *     lets them compile and unit-test in CI without the package present. Only
 *     the thin runtime that actually calls `query()` touches the real package,
 *     via a string-specifier dynamic import (see agent-sdk-runtime.ts).
 *
 *  2. **Stable seam.** If the SDK shifts its message shapes, the blast radius
 *     is this one file plus the mapper, not the whole fusion layer.
 *
 * Shapes mirror the SDK's public `SDKMessage` union and `Options` as of the
 * 2026-06 Agent SDK. Fields we don't use are intentionally omitted; the
 * open-ended index signatures keep us forward-compatible with extra fields.
 */

// ---------------------------------------------------------------------------
// Anthropic message content blocks (the subset the SDK surfaces to us)
// ---------------------------------------------------------------------------

export interface SdkTextBlock {
  type: 'text'
  text: string
}

export interface SdkThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface SdkToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface SdkToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content?: string | Array<{ type: string; text?: string; [key: string]: unknown }>
  is_error?: boolean
}

export type SdkContentBlock =
  | SdkTextBlock
  | SdkThinkingBlock
  | SdkToolUseBlock
  | SdkToolResultBlock
  | { type: string; [key: string]: unknown }

export interface SdkUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  [key: string]: unknown
}

export interface SdkApiMessage {
  role: 'assistant' | 'user'
  content: string | SdkContentBlock[]
  model?: string
  usage?: SdkUsage
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Top-level SDK stream messages (yielded by `query()`)
// ---------------------------------------------------------------------------

export interface SdkSystemInitMessage {
  type: 'system'
  subtype: 'init'
  session_id: string
  model?: string
  tools?: string[]
  [key: string]: unknown
}

export interface SdkAssistantMessage {
  type: 'assistant'
  message: SdkApiMessage
  /** Set when this message originates inside a subagent's context. */
  parent_tool_use_id: string | null
  session_id?: string
  [key: string]: unknown
}

export interface SdkUserMessage {
  type: 'user'
  message: SdkApiMessage
  parent_tool_use_id: string | null
  session_id?: string
  [key: string]: unknown
}

export type SdkResultSubtype = 'success' | 'error_max_turns' | 'error_during_execution'

export interface SdkResultMessage {
  type: 'result'
  subtype: SdkResultSubtype
  is_error?: boolean
  /** Final assistant text for a successful run. */
  result?: string
  session_id?: string
  num_turns?: number
  duration_ms?: number
  total_cost_usd?: number
  usage?: SdkUsage
  [key: string]: unknown
}

/** Raw Anthropic streaming event, surfaced when `includePartialMessages` is on. */
export interface SdkStreamRawEvent {
  type: string
  index?: number
  delta?: {
    type?: string
    text?: string
    thinking?: string
    partial_json?: string
    [key: string]: unknown
  }
  content_block?: SdkContentBlock
  message?: { usage?: SdkUsage; [key: string]: unknown }
  [key: string]: unknown
}

export interface SdkStreamEventMessage {
  type: 'stream_event'
  event: SdkStreamRawEvent
  parent_tool_use_id?: string | null
  session_id?: string
  [key: string]: unknown
}

export type SdkMessage =
  | SdkSystemInitMessage
  | SdkAssistantMessage
  | SdkUserMessage
  | SdkResultMessage
  | SdkStreamEventMessage
  | { type: string; [key: string]: unknown }

// ---------------------------------------------------------------------------
// query() options + entry point (the subset the options builder produces)
// ---------------------------------------------------------------------------

export type SdkPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

export type SdkSettingSource = 'user' | 'project' | 'local'

/** Result of a `canUseTool` decision. */
export type SdkPermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message?: string; interrupt?: boolean }

export type SdkCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options?: { signal?: AbortSignal; suggestions?: unknown }
) => Promise<SdkPermissionResult>

/** In-process MCP server instance (built via the SDK's createSdkMcpServer). */
export interface SdkMcpServerInstance {
  type: 'sdk'
  name: string
  instance: unknown
}

/** External MCP server config passed straight through to the SDK. */
export interface SdkExternalMcpServer {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  type?: string
  [key: string]: unknown
}

export type SdkMcpServerConfig = SdkMcpServerInstance | SdkExternalMcpServer

export interface SdkAgentDefinition {
  description: string
  prompt: string
  tools?: string[]
  model?: string
}

/** System-prompt preset with an appended addendum (our persona). */
export interface SdkSystemPromptPreset {
  type: 'preset'
  preset: 'claude_code'
  append?: string
}

export interface SdkHookJSONOutput {
  decision?: 'approve' | 'block'
  /** PreToolUse may return a permission decision. */
  hookSpecificOutput?: Record<string, unknown>
  systemMessage?: string
  continue?: boolean
  stopReason?: string
  [key: string]: unknown
}

export type SdkHookCallback = (
  input: Record<string, unknown>,
  toolUseId: string | undefined,
  options: { signal?: AbortSignal }
) => Promise<SdkHookJSONOutput>

export interface SdkHookMatcher {
  matcher?: string
  hooks: SdkHookCallback[]
}

export interface SdkQueryOptions {
  model?: string
  cwd?: string
  systemPrompt?: string | SdkSystemPromptPreset
  allowedTools?: string[]
  disallowedTools?: string[]
  mcpServers?: Record<string, SdkMcpServerConfig>
  permissionMode?: SdkPermissionMode
  canUseTool?: SdkCanUseTool
  hooks?: Partial<Record<string, SdkHookMatcher[]>>
  agents?: Record<string, SdkAgentDefinition>
  includePartialMessages?: boolean
  /** Resume a prior SDK session for multi-turn continuity. */
  resume?: string
  /** Scoped env for the spawned Claude Code process (we strip API keys here). */
  env?: Record<string, string | undefined>
  settingSources?: SdkSettingSource[]
  pathToClaudeCodeExecutable?: string
  abortController?: AbortController
  maxTurns?: number
  [key: string]: unknown
}

export interface SdkQueryInput {
  prompt: string | AsyncIterable<unknown>
  options?: SdkQueryOptions
}

/** The async generator `query()` returns, with the SDK's control methods. */
export interface SdkQueryResult extends AsyncIterableIterator<SdkMessage> {
  interrupt?: () => Promise<void>
  setPermissionMode?: (mode: SdkPermissionMode) => Promise<void>
}

export type SdkQueryFn = (input: SdkQueryInput) => SdkQueryResult

/** The slice of the SDK module we bind to at runtime. */
export interface SdkApi {
  query: SdkQueryFn
  /** Build an in-process MCP server exposing native (kun) tools to the model. */
  createSdkMcpServer: (config: {
    name: string
    version?: string
    tools: unknown[]
  }) => SdkMcpServerInstance
  /** Define a single in-process MCP tool. */
  tool: (
    name: string,
    description: string,
    inputSchema: unknown,
    handler: (
      args: Record<string, unknown>,
      extra: unknown
    ) => Promise<{ content: Array<{ type: 'text'; text: string } | Record<string, unknown>>; isError?: boolean }>
  ) => unknown
}
