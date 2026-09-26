import type { ActivityPatch } from '../contracts/activity.js'

/**
 * Managed-hook event → activity-row mapping (05 §6.3). The ingest route
 * receives payloads already trimmed by `kun worker hook` to event name,
 * sessionId, toolName, and timestamp; nothing else is trusted. Tables are
 * keyed by the harness's `terminal.hooks.kind`; unknown kinds and unknown
 * events are ignored rather than guessed.
 */
export type HookPayload = {
  event: string
  sessionId?: string
  toolName?: string
  timestamp?: string
}

export type HookMapping = {
  patch: ActivityPatch
  /** SessionStart carries the harness's native session id for resume. */
  nativeSessionId?: string
}

export type HookMappingContext = {
  /** A Ctrl+C/Esc hint observed by the host PTY before this Stop arrived. */
  inferredInterrupt?: boolean
}

/**
 * Trim a raw harness hook payload (Claude Code shape: `session_id`,
 * `tool_name`, `timestamp`) to the fields ingest keeps — the argv event
 * name is authoritative over any `hook_event_name` inside the payload.
 * Paths and file contents are dropped, never trusted for writes (05 §6.3).
 */
export function trimHookPayload(raw: unknown, event: string): HookPayload {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const string = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value) return value.slice(0, 256)
    }
    return undefined
  }
  return {
    event,
    sessionId: string('session_id', 'sessionId'),
    toolName: string('tool_name', 'toolName'),
    timestamp: string('timestamp', 'ts', 'time')
  }
}

const WORKING: ActivityPatch = { mainState: 'working', waitingReason: undefined }

const CLAUDE_CODE_EVENTS: Record<
  string,
  (payload: HookPayload, ctx: HookMappingContext) => HookMapping | null
> = {
  SessionStart: (payload) => ({
    patch: { mainState: 'idle', waitingReason: undefined },
    ...(payload.sessionId ? { nativeSessionId: payload.sessionId } : {})
  }),
  UserPromptSubmit: () => ({ patch: { ...WORKING } }),
  PreToolUse: (payload) => ({
    patch: { ...WORKING, ...(payload.toolName ? { currentTool: payload.toolName } : {}) }
  }),
  PostToolUse: (payload) => ({
    patch: { ...WORKING, ...(payload.toolName ? { currentTool: payload.toolName } : {}) }
  }),
  // Permission prompts and idle/attention notifications all resolve inside
  // the terminal — Kun shows "handle it there" (05 §6.3).
  PermissionRequest: () => ({
    patch: { mainState: 'waiting', waitingReason: 'terminal_prompt' }
  }),
  Notification: () => ({
    patch: { mainState: 'waiting', waitingReason: 'terminal_prompt' }
  }),
  Stop: (_payload, ctx) => ({
    patch: ctx.inferredInterrupt
      ? { mainState: 'done', lastOutcome: 'cancelled', waitingReason: undefined, phase: undefined }
      : { mainState: 'done', lastOutcome: 'completed', waitingReason: undefined, phase: undefined }
  }),
  StopFailure: () => ({ patch: { mainState: 'failed', lastOutcome: 'failed' } }),
  // Native subagents are harness-internal; there is no registered child
  // unit to fold in — counted nowhere rather than misreported.
  SubagentStart: () => null,
  SubagentStop: () => null,
  PreCompact: () => ({ patch: { mainState: 'working', phase: 'compacting' } }),
  SessionEnd: () => ({ patch: { mainState: 'closed', waitingReason: undefined } })
}

const TABLES: Record<string, typeof CLAUDE_CODE_EVENTS> = {
  'claude-settings': CLAUDE_CODE_EVENTS
}

export function mapHookEvent(
  hooksKind: string | undefined,
  payload: HookPayload,
  ctx: HookMappingContext = {}
): HookMapping | null {
  const table = hooksKind ? TABLES[hooksKind] : undefined
  if (!table) return null
  const mapper = table[payload.event]
  if (!mapper) return null
  return mapper(payload, ctx)
}
