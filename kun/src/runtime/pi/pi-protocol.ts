/**
 * Pi `--mode rpc` protocol constants (P6-09), verified against
 * `@earendil-works/pi-coding-agent@0.99.0` (live probe + bundled docs) — see
 * docs/ade/impl/pi-protocol-notes.md. Bare semver `pi --version` ("0.99.0").
 * Hand-curated surface only; no schema snapshot exists upstream.
 *
 * Wire facts:
 * - Command ids are STRINGS (`{"id":"req-1","type":"get_state"}`); responses
 *   repeat the id with `type:"response"`, `command`, `success`, `data|error`.
 * - `prompt`/`steer`/`follow_up` return `data.disposition`:
 *   'started' | 'queued' | 'handled' — 'handled' means no agent run started,
 *   so no `agent_settled` will arrive.
 * - `switch_session`/`fork`/`clone`/`new_session` may return
 *   `success:true` with `data.cancelled:true` when an extension vetoed it.
 * - `extension_ui_response` reuses the `extension_ui_request` id and produces
 *   no `response` record of its own.
 * - Turn completion = `agent_settled` (NOT `agent_end`, which can precede
 *   retries/compaction/queued follow-ups).
 * - Orderly shutdown: close stdin.
 */

export const PI_MIN_VERSION = '0.99.0'

export const PI_COMMANDS = {
  prompt: 'prompt',
  steer: 'steer',
  followUp: 'follow_up',
  abort: 'abort',
  newSession: 'new_session',
  getState: 'get_state',
  getMessages: 'get_messages',
  getSessionStats: 'get_session_stats',
  getLastAssistantText: 'get_last_assistant_text',
  switchSession: 'switch_session',
  setModel: 'set_model',
  getAvailableModels: 'get_available_models',
  setThinkingLevel: 'set_thinking_level',
  getAvailableThinkingLevels: 'get_available_thinking_levels',
  setAutoCompaction: 'set_auto_compaction',
  compact: 'compact',
  fork: 'fork',
  getForkMessages: 'get_fork_messages'
} as const
export type PiCommandName = (typeof PI_COMMANDS)[keyof typeof PI_COMMANDS]

/** Events pi emits on the rpc channel; the session consumes a subset. */
export const PI_EVENTS = {
  agentStart: 'agent_start',
  /** Turn completion boundary (NOT agent_end — that fires mid-run). */
  agentSettled: 'agent_settled',
  agentEnd: 'agent_end',
  turnStart: 'turn_start',
  turnEnd: 'turn_end',
  messageStart: 'message_start',
  messageUpdate: 'message_update',
  messageEnd: 'message_end',
  toolExecutionStart: 'tool_execution_start',
  toolExecutionUpdate: 'tool_execution_update',
  toolExecutionEnd: 'tool_execution_end',
  extensionUiRequest: 'extension_ui_request',
  extensionUiResponse: 'extension_ui_response',
  compactionStart: 'compaction_start',
  compactionEnd: 'compaction_end',
  autoCompactionStart: 'auto_compaction_start',
  autoCompactionEnd: 'auto_compaction_end',
  queueUpdate: 'queue_update'
} as const

export type PiEvent = Record<string, unknown> & { type: string }

export type PiResponse = {
  id?: string
  type: 'response'
  command?: string
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

/** `prompt`/`steer`/`follow_up` response.data. */
export type PiPromptDisposition = 'started' | 'queued' | 'handled'

/** `get_state` response.data (0.99.0 docs + probe). */
export type PiSessionState = {
  model?: { provider?: string; id?: string; name?: string }
  thinkingLevel?: string
  isStreaming?: boolean
  isCompacting?: boolean
  steeringMode?: string
  followUpMode?: string
  sessionFile?: string
  sessionId?: string
  sessionName?: string
  autoCompactionEnabled?: boolean
  messageCount?: number
  pendingMessageCount?: number
}

/** `get_session_stats` response.data. */
export type PiSessionStats = {
  sessionFile?: string
  sessionId?: string
  tokens?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
  cost?: number
  contextUsage?: {
    tokens?: number | null
    contextWindow?: number
    percent?: number | null
  }
}

/**
 * `extension_ui_request` event fields. Dialog methods (select/confirm/input/
 * editor) block until an `extension_ui_response` with the same id; notify/
 * setStatus/setWidget/setTitle/set_editor_text are fire-and-forget.
 */
export type PiExtensionUiRequest = {
  type: 'extension_ui_request'
  id?: string
  method?: string
  title?: string
  message?: string
  /** select options are plain string arrays on the wire. */
  options?: readonly string[]
  placeholder?: string
  prefill?: string
  timeout?: number
  notifyType?: 'info' | 'warning' | 'error'
  /** setStatus fire-and-forget fields. */
  statusKey?: string
  statusText?: string
  widgetKey?: string
  widgetLines?: readonly string[]
}

/** tool_execution_* event fields. */
export type PiToolExecutionEvent = {
  type: string
  toolCallId?: string
  toolName?: string
  args?: Record<string, unknown>
  partialResult?: unknown
  result?: unknown
  isError?: boolean
}

/**
 * `message_update.assistantMessageEvent` — delta-only on the wire; `text_end`/
 * `thinking_end` carry authoritative block content.
 */
export type PiAssistantMessageEvent = {
  type: string
  contentIndex?: number
  delta?: string
  content?: string
  id?: string
  toolName?: string
  toolCall?: unknown
  reason?: string
  error?: string
}

/** Assistant message on `message_end`; usage is the provider's final report. */
export type PiAssistantMessage = {
  role?: string
  model?: string
  stopReason?: string
  errorMessage?: string
  duration?: number
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    totalTokens?: number
  }
  content?: readonly { type?: string; text?: string }[]
}

/**
 * Pi parses `/...` input as slash commands; user text must not be routed there.
 * Escape = leading space (pi trims before the model but not before slash parse).
 */
export function escapePiSlashCommand(text: string): string {
  return text.trimStart().startsWith('/') ? ` ${text}` : text
}
